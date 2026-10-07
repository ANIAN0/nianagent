import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  realpath,
  stat,
} from "node:fs/promises"
import { join, resolve, isAbsolute } from "node:path"
import { homedir } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  McpAuthRequiredError,
} from "@earendil-works/pi-mcp"
import { MemoryOAuthStateStore } from "@earendil-works/pi-mcp/oauth"
import { assertSchema, schemas } from "./schema.mjs"
import { operationError, publicFailure } from "./operation-issue.mjs"
import { recordedWrite, validateWriteReceipts } from "./write-receipts.mjs"

const check = (value, message) => {
  if (!value) throw new Error(message)
}
const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
const identity = (name) => name.replaceAll("-", "_")
function values(entries) {
  const result = Object.create(null)
  for (const { name, value } of entries) {
    check(
      name.trim() === name && name && !Object.hasOwn(result, name),
      "环境变量或请求头名称为空、重复或有首尾空格。"
    )
    check(
      !value.startsWith("!"),
      "环境变量和请求头支持字面值或 ${变量名}，不支持命令表达式。"
    )
    result[name] = value
  }
  return result
}
function expand(value) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => {
    check(process.env[key] !== undefined, `缺少环境变量 ${key}。`)
    return process.env[key]
  })
}
const home = (value) =>
  value.startsWith("~/") || value.startsWith("~\\")
    ? join(homedir(), value.slice(2))
    : value
export function mcpToolNames(server, tools) {
  const plain = tools.map((tool) =>
    `mcp__${server}__${tool.name}`.replace(/[^A-Za-z0-9_]/g, "_")
  )
  return tools.map((tool, index) => {
    const name = plain[index]
    const collision = plain.some((other, i) => i !== index && other === name)
    const hash = createHash("sha256")
      .update(`${server}\0${tool.name}`)
      .digest("hex")
      .slice(0, 8)
    return name.length <= 64 && !collision
      ? name
      : `${name.slice(0, 55)}_${hash}`
  })
}
export function configurationToPi(configuration) {
  assertSchema(schemas.McpConfiguration, configuration)
  check(
    !["__proto__", "constructor", "prototype"].includes(configuration.name),
    "此服务名称不可用，请更换名称。"
  )
  check(configuration.timeout <= 120, "请求超时必须在 1–120 秒之间。")
  const env = values(configuration.env)
  const headers = values(configuration.headers)
  check(
    Object.keys(env).every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),
    "环境变量名称格式无效。"
  )
  check(
    Object.keys(headers).every((name) =>
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    ) && Object.values(headers).every((value) => !/[\r\n]/.test(value)),
    "请求头名称或值无效。"
  )
  const common = {
    enabled: configuration.enabled,
    exposure: configuration.exposure,
    description: configuration.description,
    timeout: configuration.timeout,
  }
  if (configuration.transport === "stdio") {
    check(
      configuration.command.trim().length > 0 &&
        !/[\r\n]/.test(configuration.command),
      "请填写单一可执行文件，参数另行填写。"
    )
    return {
      ...common,
      command: configuration.command,
      args: configuration.args,
      ...(configuration.cwd ? { cwd: configuration.cwd } : {}),
      ...(configuration.env.length ? { env } : {}),
    }
  }
  let url
  try {
    url = new URL(configuration.url)
  } catch {
    throw new Error("请输入有效的 Streamable HTTP 地址。")
  }
  check(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash,
    "服务地址仅支持 HTTP/HTTPS，不包含账号、密码或片段。"
  )
  return {
    ...common,
    url: configuration.url,
    ...(configuration.headers.length ? { headers } : {}),
  }
}
function fromPi(name, config) {
  const configuration = {
    name,
    transport: config.url ? "http" : "stdio",
    command: config.command || "",
    args: config.args || [],
    cwd: config.cwd || "",
    env: Object.entries(config.env || {}).map(([name, value]) => ({
      name,
      value,
    })),
    url: config.url || "",
    headers: Object.entries(config.headers || {}).map(([name, value]) => ({
      name,
      value,
    })),
    description: config.description || "",
    enabled: config.enabled !== false,
    exposure: config.exposure || "codemode",
    timeout: config.timeout || 60,
  }
  configurationToPi(configuration)
  check(
    !config.type || ["stdio", "http", "streamable-http"].includes(config.type),
    "不支持旧 SSE 传输。"
  )
  return configuration
}
// SDK close detaches its resource before awaiting physical cleanup. Concurrent
// callers must await the same owned close rather than a later early return.
function ownClose(resource) {
  const close = resource.close.bind(resource)
  let closing
  resource.close = () => (closing ??= Promise.resolve().then(close))
  return resource
}
export function createMcpTransport(
  entry,
  cwd,
  authProvider,
  onStatus = () => {}
) {
  const config = entry.config
  let transport
  if (config.url)
    transport = new StreamableHttpTransport({
      url: config.url,
      headers: Object.fromEntries(
        Object.entries(config.headers || {}).map(([key, value]) => [
          key,
          expand(value),
        ])
      ),
      authProvider,
    })
  else
    transport = new StdioTransport({
      command: home(config.command),
      args: (config.args || []).map(home),
      cwd: config.cwd ? resolve(cwd, home(config.cwd)) : cwd,
      env: Object.fromEntries(
        Object.entries(config.env || {}).map(([key, value]) => [
          key,
          expand(value),
        ])
      ),
      stderr: "pipe",
    })
  ownClose(transport)
  const requests = new Map()
  let lastStatus
  const publish = (status) => {
    lastStatus = status
    onStatus(status)
  }
  const send = transport.send.bind(transport)
  transport.send = (message) => {
    if (message.id !== undefined && message.method)
      requests.set(message.id, message.method)
    return Promise.resolve()
      .then(() => send(message))
      .catch((error) => {
        publish({
          state: isAuthError(error) ? "needs-auth" : "failed",
          error: safeMcpError(error, config),
        })
        throw error
      })
  }
  transport.onMessage((message) => {
    if (message.id === undefined || !requests.has(message.id)) return
    const method = requests.get(message.id)
    requests.delete(message.id)
    if (message.error)
      publish({
        state: "failed",
        error: "服务返回协议错误，请检查服务器日志。",
      })
    else if (method === "tools/list") publish({ state: "connected", error: "" })
  })
  transport.onError((error) =>
    publish({
      state: isAuthError(error) ? "needs-auth" : "failed",
      error: safeMcpError(error, config),
    })
  )
  transport.onClose(() => {
    if (!["failed", "needs-auth"].includes(lastStatus?.state))
      publish({
        state: "disconnected",
        error: "连接已关闭；下一次调用会由 Pi 重连。",
      })
  })
  return transport
}
const isAuthError = (error) =>
  error instanceof McpAuthRequiredError ||
  error?.name === "McpOAuthAuthorizationRequiredError" ||
  [401, 403].includes(error?.status)
export function safeMcpError(error, config) {
  if (isAuthError(error)) return "服务需要授权，请配置有效凭据后重新测试。"
  if (error?.code === "ENOENT")
    return "找不到可执行文件，请检查命令路径及运行依赖。"
  if (error?.code === "EACCES") return "无法访问可执行文件或目录，请检查权限。"
  if (error?.name === "McpTimeoutError" || error?.name === "TimeoutError")
    return "连接或协议请求超时，请检查服务是否响应。"
  if (typeof error?.status === "number")
    return `服务返回 HTTP ${error.status}，请检查服务地址和凭据。`
  if (error instanceof TypeError)
    return "无法连接服务，请检查地址、网络和服务器状态。"
  if (error?.message?.includes("缺少环境变量")) return error.message
  return config?.url
    ? "HTTP 服务连接或协议初始化失败，请检查服务地址、凭据及服务器日志。"
    : "本地服务启动或协议初始化失败，请检查命令、参数、环境和服务器日志。"
}

export class McpService {
  constructor(directory) {
    this.directory = join(directory, "agent")
    this.file = join(this.directory, "mcp.json")
    this.tests = new Map()
    this.clients = new Set()
    this.runtime = new Map()
    this.toolSources = new Map()
    // OAuth account management is outside this module. An explicit isolated
    // store prevents the native extension from reading another Pi CLI's tokens.
    const oauth = new Map()
    const key = (name, url) => `${identity(name)}|${new URL(url).href}`
    this.credentials = {
      forServer: (name, url) => {
        const id = key(name, url)
        if (!oauth.has(id)) oauth.set(id, new MemoryOAuthStateStore())
        const store = oauth.get(id)
        return {
          load: () => store.load(),
          save: (state) => store.save(state),
          withRefreshLock: (action) => action(),
        }
      },
      tokens: (name, url) => oauth.get(key(name, url))?.load()?.tokens,
      remove: (name, url) => oauth.delete(key(name, url)),
    }
    this.closed = false
  }
  async document() {
    let document
    try {
      document = JSON.parse(await readFile(this.file, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT")
        return { mcpServers: {}, moonRevisions: {}, moonDiscovery: {} }
      throw new Error("MCP 配置文件损坏或不可读取，原文件未覆盖。", {
        cause: error,
      })
    }
    check(
      document &&
        document.mcpServers &&
        typeof document.mcpServers === "object" &&
        !Array.isArray(document.mcpServers),
      "MCP 配置文件结构损坏，原文件未覆盖。"
    )
    document.moonRevisions ??= {}
    document.moonDiscovery ??= {}
    validateWriteReceipts(document.writeReceipts)
    return document
  }
  record(name, config, document) {
    const configuration = fromPi(name, config)
    const stamp = document.moonRevisions[name]
    const hash = fingerprint(config)
    const revision =
      stamp?.hash === hash ? stamp.revision : (stamp?.revision || 0) + 1
    const test = [this.tests.get(name), document.moonDiscovery[name]].find(
      (value) => value?.hash === hash
    )
    const states = [...this.runtime.values()]
      .map((owner) => owner.get(name))
      .filter(Boolean)
    const connections = states.filter(
      (state) => state.state === "connected"
    ).length
    const current =
      states.find(
        (state) => state.state === "failed" || state.state === "needs-auth"
      ) ||
      states.find((state) => state.state === "connecting") ||
      states.find((state) => state.state === "connected") ||
      states[0]
    return {
      configuration,
      revision,
      source: this.file,
      ...(test?.hash === hash ? { test: test.result } : {}),
      ...(current ? { runtime: { ...current, connections } } : {}),
    }
  }
  async list(signal) {
    signal?.throwIfAborted()
    const document = await this.document()
    signal?.throwIfAborted()
    const records = Object.entries(document.mcpServers).map(([name, config]) =>
      this.record(name, config, document)
    )
    for (const record of records)
      for (const tool of record.test?.tools || [])
        this.toolSources.set(tool.id, `MCP · ${record.configuration.name}`)
    return records
  }
  toolSource(name) {
    return (
      this.toolSources.get(name) ||
      (name.startsWith("mcp__")
        ? `MCP · ${name.slice(5).split("__")[0]}`
        : undefined)
    )
  }
  async mutate(action, signal) {
    check(!this.closed, "MCP 服务已关闭。")
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const unlock = await lockfile.lock(this.directory, {
      realpath: false,
      retries: { retries: 30, minTimeout: 30, maxTimeout: 300 },
    })
    const temporary = join(this.directory, `.mcp-${randomUUID()}.tmp`)
    let committed = false
    try {
      signal?.throwIfAborted()
      const document = await this.document()
      const result = action(document)
      await writeFile(temporary, JSON.stringify(document, null, 2), {
        flag: "wx",
        mode: 0o600,
      })
      signal?.throwIfAborted()
      check(!this.closed, "MCP 服务已关闭。")
      await rename(temporary, this.file)
      committed = true
      return result
    } finally {
      try {
        try {
          if (!committed) await rm(temporary, { force: true })
        } finally {
          await unlock()
        }
      } catch (error) {
        if (committed)
          throw operationError(
            "result_unknown",
            "配置已提交，但本次请求的收尾未完成。请先核对服务目录。",
            "check",
            publicFailure(error, "mcpSave").issue.details
          )
        throw error
      }
    }
  }
  receiptStore() { return { read: () => this.document(), update: (change, signal) => this.mutate(change, signal) } }
  async save(configuration, revision, signal, operationRequestId) {
    return recordedWrite({ store: this.receiptStore(), operation: "mcpSave", targetId: configuration.name, input: { configuration, revision }, requestId: operationRequestId, signal,
      action: (commit) => this.saveConfiguration(configuration, revision, signal, commit),
      replay: async () => {
        const current = (await this.list(signal)).find((record) => record.configuration.name === configuration.name)
        if (!current) throw operationError("write_already_committed", "原保存已完成，但服务后来已删除，请重新读取目录。", "reload")
        return current
      },
    })
  }
  async saveConfiguration(configuration, revision, signal, commit) {
    const config = configurationToPi(configuration)
    const saved = await this.mutate((document) => {
      const old = document.mcpServers[configuration.name]
      if (
        !(!old
          ? revision === undefined
          : revision ===
            this.record(configuration.name, old, document).revision)
      )
        throw operationError(
          "mcp_revision_conflict",
          "MCP 配置已变化，请重新读取后保存。",
          "reload"
        )
      check(
        !Object.keys(document.mcpServers).some(
          (name) =>
            name !== configuration.name &&
            identity(name) === identity(configuration.name)
        ),
        "服务名称与现有服务冲突，横线和下划线视为相同名称。"
      )
      const next = (revision || 0) + 1
      document.mcpServers[configuration.name] = config
      document.moonRevisions[configuration.name] = {
        revision: next,
        hash: fingerprint(config),
      }
      const tested = this.tests.get(configuration.name)
      if (tested?.hash === fingerprint(config))
        document.moonDiscovery[configuration.name] = tested
      else if (
        document.moonDiscovery[configuration.name]?.hash !== fingerprint(config)
      )
        delete document.moonDiscovery[configuration.name]
      commit?.(document, next)
      return this.record(configuration.name, config, document)
    }, signal)
    return saved
  }
  async remove(name, revision, signal, operationRequestId) {
    return recordedWrite({ store: this.receiptStore(), operation: "mcpRemove", targetId: name, input: { name, revision }, requestId: operationRequestId, signal,
      action: (commit) => this.removeConfiguration(name, revision, signal, commit), replay: () => null,
    })
  }
  async removeConfiguration(name, revision, signal, commit) {
    await this.mutate((document) => {
      if (!(
        document.mcpServers[name] &&
        revision ===
          this.record(name, document.mcpServers[name], document).revision
      ))
        throw operationError(
          "mcp_revision_conflict",
          "MCP 服务不存在或版本已变化，请重新读取。",
          "reload"
        )
      delete document.mcpServers[name]
      delete document.moonRevisions[name]
      delete document.moonDiscovery[name]
      commit?.(document, revision)
    }, signal)
    this.tests.delete(name)
    return null
  }
  async test(configuration, cwd, signal) {
    check(!this.closed, "MCP 服务已关闭。")
    signal?.throwIfAborted()
    const config = configurationToPi(configuration)
    try {
      cwd = await realpath(cwd || process.cwd())
      check((await stat(cwd)).isDirectory(), "测试工作目录不是目录。")
    } catch {
      throw new Error("测试工作目录不存在或不可访问。")
    }
    signal?.throwIfAborted()
    const client = ownClose(
      new McpClient({
        name: "moon-validation",
        version: "1.0.0",
        requestTimeoutMs: configuration.timeout * 1000,
      })
    )
    this.clients.add(client)
    const abort = () => {
      void client.close()
    }
    signal?.addEventListener("abort", abort, { once: true })
    let result
    try {
      const transport = createMcpTransport(
        { name: configuration.name, config },
        cwd
      )
      await client.connect(transport)
      signal?.throwIfAborted()
      const tools = await client.listTools({
        signal,
        timeoutMs: configuration.timeout * 1000,
      })
      const ids = mcpToolNames(configuration.name, tools)
      result = {
        state: "connected",
        error: "",
        tools: tools.map((tool, index) => ({
          name: tool.name,
          id: ids[index],
          description: tool.description || "",
          inputSchema: JSON.stringify(tool.inputSchema),
        })),
        testedAt: new Date().toISOString(),
      }
    } catch (error) {
      signal?.throwIfAborted()
      result = {
        state: isAuthError(error) ? "needs-auth" : "failed",
        error: safeMcpError(error, config),
        tools: [],
        testedAt: new Date().toISOString(),
      }
    } finally {
      signal?.removeEventListener("abort", abort)
      await client.close()
      this.clients.delete(client)
    }
    signal?.throwIfAborted()
    check(!this.closed, "MCP 服务已关闭。")
    this.tests.set(configuration.name, { hash: fingerprint(config), result })
    await this.rememberDiscovery(configuration.name, config, result, signal)
    return result
  }
  async rememberDiscovery(name, config, result, signal) {
    // Persist only metadata for an exact saved configuration. Draft tests do not
    // create a server entry; a later save carries their verified tool catalog.
    const document = await this.document()
    if (fingerprint(document.mcpServers[name]) !== fingerprint(config)) return
    await this.mutate((current) => {
      if (fingerprint(current.mcpServers[name]) === fingerprint(config))
        current.moonDiscovery[name] = { hash: fingerprint(config), result }
    }, signal)
  }
  async sessionEntries(toolIds) {
    const records = await this.list()
    const selected = new Set(toolIds || [])
    const entries = records.map((record) => {
      const config = configurationToPi(record.configuration)
      const exposure = config.exposure
      // Deny by default, including unknown or newly announced tools. Pi's exact
      // toolExposure lookup keeps unselected tools unreachable in every path.
      const toolExposure = Object.fromEntries(
        (record.test?.tools || [])
          .filter((tool) => selected.has(tool.id))
          .map((tool) => [tool.name, exposure])
      )
      return {
        name: record.configuration.name,
        source: record.source,
        scope: "global",
        config: {
          ...config,
          enabled: config.enabled && Object.keys(toolExposure).length > 0,
          exposure: "hidden",
          toolExposure,
        },
      }
    })
    return {
      servers: entries,
      errors: [],
      autoEnableCodemode: true,
      fingerprint: fingerprint(entries),
    }
  }
  async catalog() {
    const records = await this.list()
    return records.flatMap((record) =>
      (record.test?.tools || []).map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        group: `MCP · ${record.configuration.name}`,
        detail: `${tool.description}\n\n参数\n${tool.inputSchema}\n\n来源：${record.source}\n最近验证：${record.test.testedAt}`,
        available:
          record.configuration.enabled &&
          record.test.state === "connected" &&
          record.configuration.exposure !== "hidden",
        unavailableReason: !record.configuration.enabled
          ? "服务已停用。"
          : record.configuration.exposure === "hidden"
            ? "服务暴露方式为隐藏。"
            : record.test.state !== "connected"
              ? record.test.error
              : "",
      }))
    )
  }
  async close() {
    this.closed = true
    await Promise.allSettled([...this.clients].map((client) => client.close()))
    this.clients.clear()
  }
}

// Pi nestedCalls owns call identity, input and status but omits successful result
// content. Store only that missing view data through its public custom entries.
export function recordNestedMcpResult(pi, event, ctx, source) {
  if (!event.parentToolCallId || !event.toolName.startsWith("mcp__")) return
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue
    const index = (entry.message.content || []).findIndex(
      (part) =>
        part.type === "toolCall" && event.toolCallId.startsWith(`${part.id}/`)
    )
    if (index < 0) continue
    const text =
      (event.content || [])
        .map((part) =>
          part.type === "text"
            ? part.text
            : part.type === "image"
              ? "[工具返回图片，由 Pi 传入模型。]"
              : ""
        )
        .filter(Boolean)
        .join("\n") ||
      (event.structuredContent !== undefined
        ? JSON.stringify(event.structuredContent, null, 2)
        : "")
    pi.appendEntry("moon-mcp-result", {
      parentEntryId: entry.id,
      parentIndex: index,
      toolCallId: event.toolCallId,
      name: event.toolName,
      source,
      isError: event.isError,
      result:
        text.length > 100000
          ? `${text.slice(0, 100000)}\n[展示结果超出 100000 字符，已截断]`
          : text,
    })
    return
  }
}
export function mcpResultsIndex(branch) {
  return new Map(
    branch
      .filter(
        (entry) =>
          entry.type === "custom" && entry.customType === "moon-mcp-result"
      )
      .map((entry) => [
        JSON.stringify([
          entry.data?.parentEntryId,
          entry.data?.parentIndex,
          entry.data?.toolCallId,
        ]),
        entry.data,
      ])
  )
}
export function nestedMcpTools(result, data, call, sourceOf) {
  if (!result?.nestedCalls || !call) return []
  return (result.nestedCalls.calls || [])
    .filter((nested) => nested.name?.startsWith("mcp__"))
    .map((nested) => {
      const detail = data.get(
        JSON.stringify([call.entryId, call.index, nested.id])
      )
      return {
        id: nested.id,
        name: nested.name,
        source: detail?.source || sourceOf(nested.name) || "MCP",
        status:
          typeof detail?.isError === "boolean"
            ? detail.isError
              ? "failed"
              : "success"
            : nested.status === "ok"
              ? "success"
              : nested.status === "error"
                ? "failed"
                : "unknown",
        input:
          nested.arguments !== undefined
            ? JSON.stringify(nested.arguments, null, 2)
            : "Pi 未记录完整输入（超出记录限制）。",
        // An end verdict and its displayed result are independent facts. The
        // SDK's unfinished record was already started; it is not a not-run fact.
        result: typeof detail?.result === "string" ? detail.result : "",
        resultAvailability: typeof detail?.result === "string" ? "available" : "missing",
        ...(Number.isFinite(nested.durationMs)
          ? { durationMs: nested.durationMs }
          : {}),
      }
    })
}
