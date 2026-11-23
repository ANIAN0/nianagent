import { rm } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { replaceJson } from "../../atomic-file.mjs"
import { readSavedJson } from "../../loopback-host.mjs"
import { redactSensitive } from "../../redact.mjs"
import { createMemosClient, normalizeBaseUrl } from "./client.mjs"
import { memosOperations } from "./contract.mjs"

const MAX_TEXT_CHARS = 128 * 1024

const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})

const int = (description, minimum, maximum) => ({
  type: "integer",
  description,
  minimum,
  ...(maximum !== undefined ? { maximum } : {}),
})

export const READ_ONLY_TOOLS = new Set([
  "list_memos",
  "search_memos",
  "get_memo",
  "list_comments",
  "list_attachments",
])

const DESTRUCTIVE_TOOLS = new Set(["delete_memo", "delete_attachment"])

function maskToken(token) {
  if (!token) return ""
  if (token.length <= 8) return "已配置（长度较短）"
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

function resolveLocalFilePath(rawPath, context) {
  const input = String(rawPath || "").trim()
  if (!input) throw new Error("localPath 不能为空。")
  if (isAbsolute(input)) return resolve(input)
  const baseDir = context?.workspace || context?.cwd
  if (baseDir && typeof baseDir === "string") return resolve(baseDir, input)
  throw new Error("外部调用请提供本机文件的绝对路径。")
}

function formatToolResult(payload, oversizedPageError) {
  const raw = JSON.stringify(payload, null, 2)
  const sanitized = redactSensitive(raw)
  const truncated = sanitized.length > MAX_TEXT_CHARS
  if (oversizedPageError && (truncated || raw.length > MAX_TEXT_CHARS))
    throw new Error(oversizedPageError)
  const text = truncated
    ? `${sanitized.slice(0, MAX_TEXT_CHARS)}\n\n[结果超过 128 KiB 已截断，请缩小分页或过滤条件]`
    : sanitized
  return {
    content: [{ type: "text", text }],
    ...(truncated
      ? {}
      : {
          structuredContent:
            payload && typeof payload === "object" && !Array.isArray(payload)
              ? payload
              : { value: payload },
        }),
  }
}

function formatToolError(error) {
  const message = redactSensitive(
    error instanceof Error ? error.message : String(error || "Memos 调用失败。")
  )
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  }
}

export async function activate(host) {
  const credentialsFile = join(host.directory, "credentials.json")
  const config = {
    instanceUrl: String(host.configuration?.instanceUrl || "").trim(),
    defaultVisibility: host.configuration?.defaultVisibility || "PRIVATE",
    defaultPageSize: Number(host.configuration?.defaultPageSize) || 20,
    timeoutSeconds: Number(host.configuration?.timeoutSeconds) || 30,
    readOnly: Boolean(host.configuration?.readOnly),
  }

  const saved = await readSavedJson(
    credentialsFile,
    { accessToken: "" },
    "Memos 凭据"
  )
  let instanceKey = ""
  try {
    instanceKey = normalizeBaseUrl(config.instanceUrl)
  } catch {
    // Allow the management page to open and correct invalid saved configuration.
  }
  let accessToken =
    typeof saved?.accessToken === "string" &&
    (saved.instanceUrl === undefined || saved.instanceUrl === instanceKey)
      ? saved.accessToken.trim()
      : ""

  // Existing credentials predate instance binding. Associate them with the
  // activation's current address before a later configuration can reuse them.
  if (accessToken && instanceKey && saved.instanceUrl === undefined)
    await replaceJson(credentialsFile, {
      accessToken,
      instanceUrl: instanceKey,
    })

  let closed = false
  let frozen = false
  const lifecycle = new AbortController()
  let credentialLifetime = new AbortController()
  let credentialWrites = Promise.resolve()

  const resetConnection = () => ({
    state: config.instanceUrl && accessToken ? "unknown" : "unconfigured",
    user: null,
    checkedAt: null,
    error: "",
  })
  let connection = resetConnection()

  const client = createMemosClient({ config, getToken: () => accessToken })

  const changeCredentials = (signal, change) => {
    const pending = credentialWrites.then(async () => {
      signal.throwIfAborted()
      const nextToken = await change()
      credentialLifetime.abort(new Error("Memos 凭据已变更，请重新发起请求。"))
      credentialLifetime = new AbortController()
      accessToken = nextToken
      connection = resetConnection()
      return buildStatus()
    })
    credentialWrites = pending.catch(() => {})
    return pending
  }

  const ensureAvailable = () => {
    if (closed) throw new Error("Memos 插件已停用。")
    if (frozen) throw new Error("Moon 正在维护，Memos 插件暂不接受新请求。")
  }

  const toolSpecs = [
    {
      name: "list_memos",
      description: "列出 Memos 备忘录，支持分页、过滤表达式与排序。",
      inputSchema: object({
        pageSize: int("每页条数（1-100）", 1, 100),
        pageToken: str("分页游标"),
        filter: str("Memos CEL 过滤表达式"),
        sort: str("排序方式"),
      }),
      run: (input, _ctx, signal) => client.listMemos(input, signal),
    },
    {
      name: "search_memos",
      description: "按关键词全文搜索 Memos 备忘录内容。",
      inputSchema: object(
        {
          query: str("搜索关键词", { minLength: 1, maxLength: 500 }),
          pageSize: int("最多返回条数（1-100）", 1, 100),
        },
        ["query"]
      ),
      run: (input, _ctx, signal) => client.searchMemos(input, signal),
    },
    {
      name: "get_memo",
      description: "按 ID 读取单条 Memos 备忘录详情。",
      inputSchema: object(
        {
          memoId: str("备忘录 ID，如 123 或 memos/123", { minLength: 1 }),
        },
        ["memoId"]
      ),
      run: (input, _ctx, signal) => client.getMemo(input.memoId, signal),
    },
    {
      name: "list_comments",
      description:
        "按页列出指定备忘录的直接评论。若有 nextPageToken，使用同一 memoId 并将其原样作为 pageToken 继续读取。",
      inputSchema: object(
        {
          memoId: str("备忘录 ID，如 123 或 memos/123", { minLength: 1 }),
          pageSize: int("首次请求设置每页条数（1-100）", 1, 100),
          pageToken: str("上一页返回的 nextPageToken"),
        },
        ["memoId"]
      ),
      oversizedPageError:
        "评论结果超过工具输出上限。请保留 memoId、减小 pageSize 并省略 pageToken，从首页重读。",
      run: (input, _ctx, signal) => client.listComments(input, signal),
    },
    {
      name: "list_attachments",
      description:
        "按页列出当前凭据可见的 Memos 附件。若有 nextPageToken，将其作为 pageToken 继续读取。",
      inputSchema: object({
        pageSize: int("首次请求设置每页条数（1-100）", 1, 100),
        pageToken: str("上一页返回的 nextPageToken"),
      }),
      oversizedPageError:
        "附件结果超过工具输出上限。请减小 pageSize 并省略 pageToken，从首页重读。",
      run: (input, _ctx, signal) => client.listAttachments(input, signal),
    },
    {
      name: "create_memo",
      description: "创建一条新的 Memos 备忘录。",
      inputSchema: object(
        {
          content: str("Markdown 备忘录正文", { minLength: 1 }),
          visibility: str("可见性", {
            enum: ["PRIVATE", "PROTECTED", "PUBLIC"],
          }),
          tags: {
            type: "array",
            items: str(
              "标签名。Memos 从 Markdown 正文中的 #标签 提取标签，请使用 content。"
            ),
            maxItems: 32,
          },
        },
        ["content"]
      ),
      run: (input, _ctx, signal) => client.createMemo(input, signal),
    },
    {
      name: "update_memo",
      description:
        "更新已有 Memos 备忘录的正文或可见性。标签由正文中的 #标签 生成。",
      inputSchema: object(
        {
          memoId: str("备忘录 ID", { minLength: 1 }),
          content: str("更新后的正文"),
          visibility: str("更新后的可见性", {
            enum: ["PRIVATE", "PROTECTED", "PUBLIC"],
          }),
          tags: {
            type: "array",
            items: str(
              "标签名。Memos 从 Markdown 正文中的 #标签 提取标签，请使用 content。"
            ),
            maxItems: 32,
          },
        },
        ["memoId"]
      ),
      run: (input, _ctx, signal) => client.updateMemo(input, signal),
    },
    {
      name: "delete_memo",
      description: "永久删除指定的 Memos 备忘录（不可恢复）。",
      inputSchema: object(
        {
          memoId: str("备忘录 ID", { minLength: 1 }),
        },
        ["memoId"]
      ),
      run: (input, _ctx, signal) => client.deleteMemo(input.memoId, signal),
    },
    {
      name: "create_comment",
      description: "在指定 Memos 备忘录下发表一条评论。",
      inputSchema: object(
        {
          memoId: str("备忘录 ID", { minLength: 1 }),
          content: str("评论内容", { minLength: 1 }),
        },
        ["memoId", "content"]
      ),
      run: (input, _ctx, signal) => client.createComment(input, signal),
    },
    {
      name: "upload_attachment",
      description: "从本机路径上传文件为 Memos 附件。",
      inputSchema: object(
        {
          localPath: str(
            "本机文件路径（会话内可相对工作区，外部调用需绝对路径）",
            {
              minLength: 1,
            }
          ),
        },
        ["localPath"]
      ),
      run: (input, ctx, signal) =>
        client.uploadAttachment(
          resolveLocalFilePath(input.localPath, ctx),
          signal
        ),
    },
    {
      name: "download_attachment",
      description: "下载指定 Memos 附件到本机文件路径。",
      inputSchema: object(
        {
          attachmentId: str("附件 ID，如 123 或 attachments/123", {
            minLength: 1,
          }),
          localPath: str(
            "本机保存路径（会话内可相对工作区，外部调用需绝对路径）",
            {
              minLength: 1,
            }
          ),
        },
        ["attachmentId", "localPath"]
      ),
      run: (input, ctx, signal) =>
        client.downloadAttachment(
          input.attachmentId,
          resolveLocalFilePath(input.localPath, ctx),
          signal
        ),
    },
    {
      name: "delete_attachment",
      description: "永久删除指定的 Memos 附件（不可恢复）。",
      inputSchema: object(
        {
          attachmentId: str("附件 ID", { minLength: 1 }),
        },
        ["attachmentId"]
      ),
      run: (input, _ctx, signal) =>
        client.deleteAttachment(input.attachmentId, signal),
    },
  ]

  const sharedTools = toolSpecs.map((spec) => {
    const readOnly = READ_ONLY_TOOLS.has(spec.name)
    const destructive = DESTRUCTIVE_TOOLS.has(spec.name)
    return {
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
      shareable: true,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        idempotentHint: readOnly,
        openWorldHint: true,
      },
      async execute(input, context, signal) {
        try {
          ensureAvailable()
          if (!readOnly && config.readOnly) {
            return formatToolError(
              new Error("Memos 插件当前处于只读模式，已拒绝写入操作。")
            )
          }
          const combined = AbortSignal.any([
            lifecycle.signal,
            credentialLifetime.signal,
            ...(signal ? [signal] : []),
          ])
          const data = await spec.run(input || {}, context || {}, combined)
          return formatToolResult(data, spec.oversizedPageError)
        } catch (error) {
          return formatToolError(error)
        }
      },
    }
  })

  const buildStatus = () => ({
    configured: Boolean(config.instanceUrl && accessToken),
    hasCredentials: Boolean(accessToken),
    accessToken,
    credentialSummary: maskToken(accessToken),
    instanceUrl: config.instanceUrl,
    readOnly: config.readOnly,
    connection: { ...connection },
    tools: toolSpecs.map((spec) => {
      const readOnly = READ_ONLY_TOOLS.has(spec.name)
      return {
        name: spec.name,
        description: spec.description,
        effect: readOnly ? "read" : "write",
        destructive: DESTRUCTIVE_TOOLS.has(spec.name),
        enabled: readOnly || !config.readOnly,
      }
    }),
  })

  const businessState = () => {
    if (!config.instanceUrl) return "未配置 Memos 服务地址"
    if (!accessToken) return "未配置 Access Token"
    if (connection.state === "connected") {
      const suffix = config.readOnly ? "（只读）" : ""
      return `已连接 ${config.instanceUrl}${connection.user ? ` · ${connection.user}` : ""}${suffix}`
    }
    if (connection.state === "error")
      return `连接异常：${connection.error.slice(0, 60)}`
    return `已配置 ${config.instanceUrl}${config.readOnly ? "（只读）" : ""}`
  }

  const operation = (name, action) => ({
    ...memosOperations[name],
    execute: async (input, _context, signal) => {
      ensureAvailable()
      const combined = signal
        ? AbortSignal.any([lifecycle.signal, signal])
        : lifecycle.signal
      return { value: await action(input || {}, combined) }
    },
  })

  return {
    sharedTools,
    operations: {
      status: operation("status", () => buildStatus()),
      setCredentials: operation("setCredentials", async (input, signal) => {
        const nextToken = String(input.accessToken || "").trim()
        if (!nextToken) throw new Error("Access Token 不能为空。")
        const result = await changeCredentials(signal, async () => {
          const instanceUrl = normalizeBaseUrl(config.instanceUrl)
          await replaceJson(
            credentialsFile,
            { accessToken: nextToken, instanceUrl },
            { signal }
          )
          return nextToken
        })
        host.emit?.("status-changed", { reason: "credentials-updated" })
        return result
      }),
      clearCredentials: operation(
        "clearCredentials",
        async (_input, signal) => {
          const result = await changeCredentials(signal, async () => {
            await rm(credentialsFile, { force: true })
            return ""
          })
          host.emit?.("status-changed", { reason: "credentials-cleared" })
          return result
        }
      ),
      testConnection: operation("testConnection", async (_input, signal) => {
        const started = Date.now()
        const active = AbortSignal.any([signal, credentialLifetime.signal])
        try {
          const user = await client.whoami(active)
          active.throwIfAborted()
          const latencyMs = Math.max(0, Date.now() - started)
          connection = {
            state: "connected",
            user,
            checkedAt: new Date().toISOString(),
            error: "",
          }
          host.emit?.("status-changed", { reason: "connection-tested" })
          return { ok: true, user, latencyMs, error: "" }
        } catch (error) {
          active.throwIfAborted()
          const message = redactSensitive(
            error instanceof Error ? error.message : String(error)
          )
          const latencyMs = Math.max(0, Date.now() - started)
          connection = {
            state: "error",
            user: null,
            checkedAt: new Date().toISOString(),
            error: message,
          }
          host.emit?.("status-changed", { reason: "connection-tested" })
          return { ok: false, user: null, latencyMs, error: message }
        }
      }),
    },
    status: businessState,
    quiesce() {
      frozen = true
    },
    resume() {
      frozen = false
    },
    close() {
      closed = true
      frozen = true
      lifecycle.abort()
    },
  }
}
