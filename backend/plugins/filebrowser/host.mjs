import { rm } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { replaceJson } from "../../atomic-file.mjs"
import { readSavedJson } from "../../loopback-host.mjs"
import { redactSensitive } from "../../redact.mjs"
import { createFileBrowserClient, normalizeRootPrefix } from "./client.mjs"
import { filebrowserOperations } from "./contract.mjs"

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

const bool = (description) => ({ type: "boolean", description })

const int = (description, minimum, maximum) => ({
  type: "integer",
  description,
  minimum,
  ...(maximum !== undefined ? { maximum } : {}),
})

export const READ_ONLY_TOOLS = new Set([
  "list_dir",
  "get_info",
  "tree",
  "read_text_file",
  "search_files",
  "list_shares",
])

const DESTRUCTIVE_TOOLS = new Set(["delete_path", "delete_share"])

function resolveLocalFilePath(rawPath, context) {
  const input = String(rawPath || "").trim()
  if (!input) throw new Error("localPath 不能为空。")
  if (isAbsolute(input)) return resolve(input)
  const baseDir = context?.workspace || context?.cwd
  if (baseDir && typeof baseDir === "string") return resolve(baseDir, input)
  throw new Error("外部调用请提供本机文件的绝对路径。")
}

function formatToolResult(payload) {
  const raw = JSON.stringify(payload, null, 2)
  const sanitized = redactSensitive(raw)
  const truncated = sanitized.length > MAX_TEXT_CHARS
  const text = truncated
    ? `${sanitized.slice(0, MAX_TEXT_CHARS)}\n\n[结果超过 128 KiB 已截断，请缩小目录深度或分页范围]`
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
    error instanceof Error
      ? error.message
      : String(error || "FileBrowser 调用失败。")
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
    rootPrefix: normalizeRootPrefix(host.configuration?.rootPrefix || "/"),
    defaultShareExpires: Number(host.configuration?.defaultShareExpires) || 24,
    defaultShareUnit: host.configuration?.defaultShareUnit || "hours",
    timeoutSeconds: Number(host.configuration?.timeoutSeconds) || 60,
    readOnly: Boolean(host.configuration?.readOnly),
  }

  const saved = await readSavedJson(
    credentialsFile,
    { username: "", password: "" },
    "FileBrowser 凭据"
  )
  let credentials = {
    username:
      typeof saved?.username === "string" ? saved.username.trim() : "",
    password: typeof saved?.password === "string" ? saved.password : "",
  }
  const hasCredentials = () =>
    Boolean(credentials.username && credentials.password)

  let closed = false
  let frozen = false
  const lifecycle = new AbortController()
  let connection = {
    state: config.instanceUrl && hasCredentials() ? "unknown" : "unconfigured",
    user: null,
    checkedAt: null,
    error: "",
  }

  const client = createFileBrowserClient({
    getConfig: () => config,
    getCredentials: () => credentials,
  })

  const ensureAvailable = () => {
    if (closed) throw new Error("FileBrowser 插件已停用。")
    if (frozen) throw new Error("Moon 正在维护，FileBrowser 插件暂不接受新请求。")
  }

  const toolSpecs = [
    {
      name: "list_dir",
      description: "列出 FileBrowser 远程目录中的文件与子目录。",
      inputSchema: object({
        path: str("远程目录路径，默认 /"),
      }),
      run: (input, _ctx, signal) => client.listDir(input.path || "/", signal),
    },
    {
      name: "get_info",
      description: "获取 FileBrowser 远程文件或目录的元数据与 SHA-256 校验值。",
      inputSchema: object(
        {
          path: str("远程文件或目录路径", { minLength: 1 }),
        },
        ["path"]
      ),
      run: (input, _ctx, signal) => client.getInfo(input.path, signal),
    },
    {
      name: "tree",
      description: "递归列出 FileBrowser 远程目录树结构（带深度与条目上限）。",
      inputSchema: object({
        path: str("起始远程目录路径，默认 /"),
        maxDepth: int("最大递归深度（1-6，默认 3）", 1, 6),
        maxEntries: int("最多返回条目数（1-1000，默认 200）", 1, 1000),
      }),
      run: (input, _ctx, signal) => client.tree(input, signal),
    },
    {
      name: "read_text_file",
      description:
        "直接读取 FileBrowser 上不超过 256 KiB 的远程纯文本文件内容，免去先下载到本地。",
      inputSchema: object(
        {
          path: str("远程文本文件路径", { minLength: 1 }),
        },
        ["path"]
      ),
      run: (input, _ctx, signal) => client.readTextFile(input.path, signal),
    },
    {
      name: "search_files",
      description: "在指定远程目录下按关键词搜索文件与目录。",
      inputSchema: object(
        {
          query: str("搜索关键词", { minLength: 1, maxLength: 500 }),
          path: str("起始搜索目录，默认 /"),
          limit: int("最多返回结果数（1-200，默认 50）", 1, 200),
        },
        ["query"]
      ),
      run: (input, _ctx, signal) => client.searchFiles(input, signal),
    },
    {
      name: "list_shares",
      description: "列出 FileBrowser 当前所有分享链接，或指定路径的分享记录。",
      inputSchema: object({
        path: str("可选：按远程路径过滤分享"),
      }),
      run: (input, _ctx, signal) => client.listShares(input.path, signal),
    },
    {
      name: "mkdir",
      description: "在 FileBrowser 上创建新的远程目录。",
      inputSchema: object(
        {
          path: str("要创建的远程目录路径", { minLength: 1 }),
        },
        ["path"]
      ),
      run: (input, _ctx, signal) => client.mkdir(input.path, signal),
    },
    {
      name: "upload_file",
      description: "将本机文件上传到 FileBrowser 指定远程路径。",
      inputSchema: object(
        {
          localPath: str("本机源文件路径（会话内可相对工作区，外部调用需绝对路径）", {
            minLength: 1,
          }),
          remotePath: str("目标远程文件路径", { minLength: 1 }),
          override: bool("目标已存在时是否覆盖，默认 false"),
        },
        ["localPath", "remotePath"]
      ),
      run: (input, ctx, signal) =>
        client.uploadFile(
          {
            localPath: resolveLocalFilePath(input.localPath, ctx),
            remotePath: input.remotePath,
            override: Boolean(input.override),
          },
          signal
        ),
    },
    {
      name: "download_file",
      description: "将 FileBrowser 远程文件下载到本机指定路径，传输完成后才覆盖可写的常规文件。",
      inputSchema: object(
        {
          remotePath: str("远程源文件路径", { minLength: 1 }),
          localPath: str("本机保存路径（会话内可相对工作区，外部调用需绝对路径）", {
            minLength: 1,
          }),
        },
        ["remotePath", "localPath"]
      ),
      run: (input, ctx, signal) =>
        client.downloadFile(
          {
            remotePath: input.remotePath,
            localPath: resolveLocalFilePath(input.localPath, ctx),
          },
          signal
        ),
    },
    {
      name: "move_path",
      description: "移动或重命名 FileBrowser 远程文件/目录。",
      inputSchema: object(
        {
          src: str("源远程路径", { minLength: 1 }),
          dst: str("目标远程路径", { minLength: 1 }),
        },
        ["src", "dst"]
      ),
      run: (input, _ctx, signal) => client.movePath(input, signal),
    },
    {
      name: "copy_path",
      description: "复制 FileBrowser 远程文件/目录到新路径。",
      inputSchema: object(
        {
          src: str("源远程路径", { minLength: 1 }),
          dst: str("目标远程路径", { minLength: 1 }),
        },
        ["src", "dst"]
      ),
      run: (input, _ctx, signal) => client.copyPath(input, signal),
    },
    {
      name: "delete_path",
      description: "永久删除 FileBrowser 远程文件或目录（不可恢复，禁止删除根目录）。",
      inputSchema: object(
        {
          path: str("要删除的远程路径", { minLength: 1 }),
        },
        ["path"]
      ),
      run: (input, _ctx, signal) => client.deletePath(input.path, signal),
    },
    {
      name: "create_share",
      description: "为 FileBrowser 远程文件或目录创建外链分享。",
      inputSchema: object(
        {
          path: str("要分享的远程路径", { minLength: 1 }),
          expires: int("有效期数值（默认使用插件配置）", 1, 3650),
          unit: str("有效期单位", {
            enum: ["seconds", "minutes", "hours", "days"],
          }),
          password: str("可选：分享提取密码"),
        },
        ["path"]
      ),
      run: (input, _ctx, signal) => client.createShare(input, signal),
    },
    {
      name: "delete_share",
      description: "撤销并删除指定的 FileBrowser 分享链接。",
      inputSchema: object(
        {
          hash: str("分享链接 hash", { minLength: 1 }),
        },
        ["hash"]
      ),
      run: (input, _ctx, signal) => client.deleteShare(input.hash, signal),
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
              new Error("FileBrowser 插件当前处于只读模式，已拒绝写入操作。")
            )
          }
          const combined = signal
            ? AbortSignal.any([lifecycle.signal, signal])
            : lifecycle.signal
          const data = await spec.run(input || {}, context || {}, combined)
          return formatToolResult(data)
        } catch (error) {
          return formatToolError(error)
        }
      },
    }
  })

  const buildStatus = () => ({
    configured: Boolean(config.instanceUrl && hasCredentials()),
    hasCredentials: hasCredentials(),
    username: credentials.username,
    password: credentials.password,
    credentialSummary: hasCredentials()
      ? `${credentials.username}（密码已安全保存）`
      : "",
    instanceUrl: config.instanceUrl,
    rootPrefix: config.rootPrefix,
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
    if (!config.instanceUrl) return "未配置 FileBrowser 服务地址"
    if (!hasCredentials()) return "未配置登录凭据"
    if (connection.state === "connected") {
      const suffix = config.readOnly ? "（只读）" : ""
      return `已连接 ${config.instanceUrl}${connection.user ? ` · ${connection.user}` : ""}${suffix}`
    }
    if (connection.state === "error")
      return `连接异常：${connection.error.slice(0, 60)}`
    return `已配置 ${config.instanceUrl}${config.readOnly ? "（只读）" : ""}`
  }

  const operation = (name, action) => ({
    ...filebrowserOperations[name],
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
        const username = String(input.username || "").trim()
        const password = String(input.password || "")
        if (!username || !password)
          throw new Error("用户名和密码均不能为空。")
        await replaceJson(credentialsFile, { username, password }, { signal })
        credentials = { username, password }
        client.clearToken()
        connection = {
          state: config.instanceUrl ? "unknown" : "unconfigured",
          user: null,
          checkedAt: null,
          error: "",
        }
        host.emit?.("status-changed", { reason: "credentials-updated" })
        return buildStatus()
      }),
      clearCredentials: operation("clearCredentials", async () => {
        await rm(credentialsFile, { force: true })
        credentials = { username: "", password: "" }
        client.clearToken()
        connection = {
          state: "unconfigured",
          user: null,
          checkedAt: null,
          error: "",
        }
        host.emit?.("status-changed", { reason: "credentials-cleared" })
        return buildStatus()
      }),
      testConnection: operation("testConnection", async (_input, signal) => {
        const started = Date.now()
        try {
          const user = await client.testLogin(signal)
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
      client.clearToken()
      lifecycle.abort()
    },
  }
}
