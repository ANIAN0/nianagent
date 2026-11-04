import { createServer } from "node:http"
import { join } from "node:path"
import { randomBytes, randomUUID } from "node:crypto"
import {
  createMcpHandler,
  Server,
  isLegacyRequest,
  isInitializeRequest,
  CLIENT_INFO_META_KEY,
} from "@modelcontextprotocol/server"
import {
  NodeStreamableHTTPServerTransport,
  toWebRequest,
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from "@modelcontextprotocol/node"
import { replaceJson } from "../../atomic-file.mjs"
import {
  bearerAuthorized as authenticate,
  loadTokenIdentity,
  readSavedJson,
} from "../../loopback-host.mjs"
import { mcpServiceOperations } from "./contract.mjs"

const clientName = (name) =>
  typeof name === "string" && /^[\p{L}\p{N}_. -]{1,64}$/u.test(name)
    ? name
    : "未提供"
export async function activate(host) {
  const settingsFile = join(host.directory, "settings.json"),
    tokenFile = join(host.directory, "token.json")
  let settings = await readSavedJson(settingsFile, {
    revision: 0,
    port: 19826,
    selected: [],
  }, "MCP 服务")
  if (
    !Number.isSafeInteger(settings.revision) ||
    !Number.isInteger(settings.port) ||
    settings.port < 1024 ||
    settings.port > 65535 ||
    !Array.isArray(settings.selected) ||
    settings.selected.length > 128 ||
    settings.selected.some((item) => typeof item !== "string")
  )
    throw new Error("MCP 服务配置无效，原文件保留。")
  let identity = await loadTokenIdentity(tokenFile, "MCP")
  let listener,
    issue = "",
    closed = false,
    frozen = false,
    changing,
    protocolClosing,
    closing
  const lifecycle = new AbortController()
  const sessions = new Map(),
    pending = new Set(),
    controllers = new Set(),
    sockets = new Set()
  const event = (status, error = "") =>
    host.logs.append({ source: "mcp", plugin: "mcp-service", status, error })
  const allowed = (name) =>
    !closed &&
    !frozen &&
    !changing &&
    host.isActive() &&
    settings.selected.includes(name)
  const catalog = () =>
    host.sharedTools
      .list()
      .filter((tool) => settings.selected.includes(tool.name))
  const execute = async (request, ctx, server) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    ctx.mcpReq.signal.addEventListener("abort", abort, { once: true })
    if (ctx.mcpReq.signal.aborted) abort()
    controllers.add(controller)
    const task = host.sharedTools.call(
      request.params.name,
      request.params.arguments || {},
      {
        allowed,
        generation: catalog().find((tool) => tool.name === request.params.name)
          ?.generation,
        client: clientName(
          server.getClientVersion()?.name ||
            ctx.mcpReq.envelope?.[CLIENT_INFO_META_KEY]?.name
        ),
        signal: controller.signal,
      }
    )
    pending.add(task)
    try {
      return await task
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] }
    } finally {
      pending.delete(task)
      controllers.delete(controller)
      ctx.mcpReq.signal.removeEventListener("abort", abort)
    }
  }
  const build = () => {
    const server = new Server(
      { name: "Moon", version: "0.1.0" },
      {
        capabilities: { tools: { listChanged: true } },
        instructions:
          "Moon 共享插件工具。工具可能写入网站或文件；审批由客户端负责。OpenCLI 使用原生 argv/session/--tab，Moon 不创建业务上下文。",
      }
    )
    server.setRequestHandler("tools/list", async () => ({
      tools: catalog().map(
        ({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations,
        })
      ),
    }))
    server.setRequestHandler("tools/call", (request, ctx) =>
      execute(request, ctx, server)
    )
    server.onerror = () =>
      void event("error", "MCP 协议连接发生错误；未保存原始载荷。")
    return server
  }
  const makeModern = () =>
    createMcpHandler(build, {
      legacy: "reject",
      maxSubscriptions: 64,
      onerror: () => void event("error", "MCP 协议请求失败；未保存原始载荷。"),
    })
  let modern = makeModern()
  const notify = () => {
    modern.notify.toolsChanged()
    for (const item of sessions.values())
      void item.server.sendToolListChanged().catch(() => {})
  }
  const unsubscribe = host.sharedTools.subscribe(notify)
  const cancelCalls = async () => {
    for (const controller of controllers) controller.abort()
    await Promise.allSettled([...pending])
  }
  const closeProtocols = () => {
    if (protocolClosing) return protocolClosing
    protocolClosing = (async () => {
      await cancelCalls()
      await Promise.all([
        modern.close(),
        ...[...sessions.values()].map((item) => item.server.close()),
      ])
      sessions.clear()
      if (!closed) modern = makeModern()
    })().finally(() => {
      protocolClosing = undefined
    })
    return protocolClosing
  }
  const validateHost = localhostHostValidation(),
    validateOrigin = localhostOriginValidation()
  const route = async (req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) {
      void event("rejected", "Host 或 Origin 不允许。")
      return
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end()
      return
    }
    if (!authenticate(req.headers.authorization, identity.token)) {
      void event("rejected", "缺少或无效的 MCP bearer token。")
      res.writeHead(401, { "WWW-Authenticate": "Bearer realm=Moon" }).end()
      return
    }
    if (closed || frozen || changing || !host.isActive()) {
      res.writeHead(503).end()
      return
    }
    const controller = new AbortController()
    const disconnected = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.on("close", disconnected)
    try {
      const web = await toWebRequest(req, undefined, {
        signal: controller.signal,
      })
      // The SDK owns era classification, framing, initialization and cancellation.
      if (!(await isLegacyRequest(web.clone()))) {
        await toNodeHandler({ fetch: () => modern.fetch(web) })(req, res, {})
        return
      }
      const id = req.headers["mcp-session-id"]
      let item = typeof id === "string" ? sessions.get(id) : undefined
      let body
      if (req.method === "POST") body = await web.json()
      if (!item && !id && req.method === "POST" && isInitializeRequest(body)) {
        if (sessions.size >= 64) {
          res.writeHead(503).end()
          return
        }
        const server = build()
        const transport = new NodeStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => sessions.set(sessionId, item),
        })
        item = { server, transport, open: 0, lastActive: Date.now() }
        await server.connect(transport)
        server.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId)
        }
        void event("connected")
      }
      if (!item) {
        res.writeHead(id ? 404 : 400).end()
        return
      }
      item.open++
      res.once("close", () => {
        item.open--
        item.lastActive = Date.now()
      })
      await item.transport.handleRequest(req, res, body)
    } catch (error) {
      void event("error", "MCP 请求未完成；未保存原始错误内容。")
      if (!res.headersSent)
        res.writeHead(error.status === 413 ? 413 : 400).end()
      else res.end()
    } finally {
      res.off("close", disconnected)
    }
  }
  const open = async (port) => {
    const server = createServer((req, res) => {
      void route(req, res)
    })
    server.on("connection", (socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    })
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, "127.0.0.1", resolve)
      })
    } catch (error) {
      server.close()
      throw new Error(
        error.code === "EADDRINUSE"
          ? "端口已占用，请选择其他固定端口。"
          : "MCP 服务监听失败，请检查端口。",
        { cause: error }
      )
    }
    server.on("error", () => {
      issue = "MCP 监听发生错误，请重新保存端口或重启插件。"
      void event("error", issue)
    })
    return server
  }
  const stopListener = async (server) => {
    if (!server) return
    await closeProtocols()
    server.closeAllConnections()
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
  try {
    listener = await open(settings.port)
    await event("started")
  } catch (error) {
    issue = error.message
    await event("error", issue)
  }
  const timer = setInterval(() => {
    for (const item of sessions.values())
      if (!item.open && item.lastActive < Date.now() - 30 * 60000)
        void item.server.close()
  }, 60000)
  timer.unref()
  const status = () => ({
    running: !!listener?.listening && !frozen,
    port: settings.port,
    url: `http://127.0.0.1:${settings.port}/mcp`,
    revision: settings.revision,
    selected: settings.selected,
    tools: host.sharedTools.list(),
    issue,
    logIssue: host.logs.issue,
    protocol:
      "2026-07-28 + SDK 原生 2025 Streamable HTTP；协议连接不关联浏览器 session。",
  })
  const change = (action) => {
    if (changing || closed || frozen)
      throw new Error("MCP 服务正在变更或停止。")
    changing = Promise.resolve()
      .then(action)
      .finally(() => {
        changing = undefined
      })
    return changing
  }
  const operation = (name, action) => ({
    ...mcpServiceOperations[name],
    execute: async (input, _context, signal) => ({
      value: await action(input, signal),
    }),
  })
  return {
    operations: {
      status: operation("status", status),
      reveal: operation("reveal", () => ({ token: identity.token })),
      save: operation("save", (input, signal) =>
        change(async () => {
          signal = AbortSignal.any([
            lifecycle.signal,
            ...(signal ? [signal] : []),
          ])
          if (input.revision !== settings.revision)
            throw new Error("MCP 配置已变化，请重新读取。")
          const names = host.sharedTools.list().map((tool) => tool.name)
          if (
            input.selected.some(
              (name) =>
                !settings.selected.includes(name) && !names.includes(name)
            )
          )
            throw new Error("只能选择当前启用且作者允许共享的工具。")
          signal?.throwIfAborted()
          const next = {
            port: input.port,
            selected: [...new Set(input.selected)],
            revision: settings.revision + 1,
          }
          const replacement =
            input.port !== settings.port || !listener?.listening
              ? await open(input.port)
              : undefined
          try {
            signal.throwIfAborted()
            await replaceJson(settingsFile, next, { signal })
          } catch (error) {
            if (replacement)
              await new Promise((resolve) => replacement.close(resolve))
            throw error
          }
          settings = next
          await cancelCalls()
          if (replacement) {
            const previous = listener
            listener = replacement
            await stopListener(previous)
          }
          issue = ""
          notify()
          return status()
        })
      ),
      reset: operation("reset", (input, signal) =>
        change(async () => {
          signal = AbortSignal.any([
            lifecycle.signal,
            ...(signal ? [signal] : []),
          ])
          if (input.revision !== settings.revision)
            throw new Error("MCP 配置已变化，请重新读取。")
          const next = { token: randomBytes(32).toString("base64url") }
          await replaceJson(tokenFile, next, { signal })
          identity = next
          await closeProtocols()
          await event("token-reset")
          return status()
        })
      ),
    },
    status: () =>
      issue ||
      (listener?.listening && !frozen
        ? `本机服务 ${settings.port}；共享 ${catalog().length} 个工具`
        : "服务已暂停"),
    async quiesce() {
      frozen = true
      await cancelCalls()
      await closeProtocols()
    },
    resume() {
      frozen = false
    },
    close() {
      if (closing) return closing
      closed = true
      frozen = true
      lifecycle.abort()
      clearInterval(timer)
      unsubscribe()
      closing = (async () => {
        await changing?.catch(() => {})
        await stopListener(listener)
        await closeProtocols()
        for (const socket of sockets) socket.destroy()
        await event("stopped")
      })()
      return closing
    },
  }
}
