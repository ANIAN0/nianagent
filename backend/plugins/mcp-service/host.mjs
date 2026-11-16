import { createServer } from "node:http"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import {
  createMcpHandler,
  Server,
  isLegacyRequest,
  isInitializeRequest,
  CLIENT_INFO_META_KEY,
} from "@modelcontextprotocol/server"
import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from "@modelcontextprotocol/node"
import { replaceJson } from "../../atomic-file.mjs"
import { redactSensitive } from "../../redact.mjs"
import { readSavedJson } from "../../loopback-host.mjs"
import {
  authenticate,
  loadRegistry,
  registerAgent,
  revokeCredential,
  rotateActor,
  summarize,
  LEGACY_ACTOR_ID,
} from "./identity.mjs"
import { mcpServiceOperations } from "./contract.mjs"

const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const MAX_SESSIONS_PER_CREDENTIAL = 8

const clientName = (name) =>
  typeof name === "string" && /^[\p{L}\p{N}_. -]{1,64}$/u.test(name)
    ? name
    : "未提供"
export async function activate(host) {
  const settingsFile = join(host.directory, "settings.json")
  let settings = await readSavedJson(
    settingsFile,
    {
      revision: 0,
      port: 19826,
      selected: [],
    },
    "MCP 服务"
  )
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
  const registry = await loadRegistry(host.directory)
  const principalContext = new AsyncLocalStorage()
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
  const event = (status, error = "", extra = {}) =>
    host.logs.append({
      source: "mcp",
      plugin: "mcp-service",
      status,
      error,
      ...extra,
    })
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
    const principal = principalContext.getStore()
    const descriptor = catalog().find(
      (tool) => tool.name === request.params.name
    )
    if (!principal) {
      void event("rejected", "工具调用缺少身份上下文。")
      return {
        isError: true,
        content: [
          { type: "text", text: "身份上下文缺失（identity_denied）。" },
        ],
      }
    }
    // 撤销接受边界（Q10）：执行前以登记表现值复核凭据有效性；
    // 撤销已持久化后不再有新的领域接受；已在途调用按原生命周期收尾，不伪造回滚。
    const current = registry.credentials.find(
      (item) => item.credentialId === principal.credentialId
    )
    if (!current || current.revokedAt) {
      void event("rejected", "凭据已撤销，拒绝接受新工具调用。", {
        credentialId: principal.credentialId,
      })
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "凭据已撤销，不能接受新调用（identity_denied）。",
          },
        ],
      }
    }
    if (
      principal.actorId === LEGACY_ACTOR_ID &&
      descriptor?.plugin === "notes-workbench"
    ) {
      void event("rejected", "旧共享凭据不能调用笔记工作台工具。", {
        credentialId: principal.credentialId,
      })
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "旧共享凭据不能调用笔记工作台工具（identity_denied）；请为该 Agent 登记专属凭据。",
          },
        ],
      }
    }
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
        generation: descriptor?.generation,
        client: clientName(
          server.getClientVersion()?.name ||
            ctx.mcpReq.envelope?.[CLIENT_INFO_META_KEY]?.name
        ),
        actorId: principal.actorId,
        credentialId: principal.credentialId,
        signal: controller.signal,
      }
    )
    pending.add(task)
    try {
      return await task
    } catch (error) {
      // AC13：MCP 工具错误文本出口统一脱敏——令牌/授权头/密钥形态不回传给客户端
      return {
        isError: true,
        content: [{ type: "text", text: redactSensitive(error.message) }],
      }
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
  /** 关闭已撤销凭据名下的有状态 session；在途已接受操作按各自生命周期收尾。 */
  const closeRevokedSessions = () => {
    const revokedIds = new Set(
      registry.credentials
        .filter((credential) => credential.revokedAt)
        .map((credential) => credential.credentialId)
    )
    for (const item of sessions.values())
      if (revokedIds.has(item.credentialId)) void item.server.close()
  }
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
  /** 按原始字节计的请求体上限读取（含无 content-length 的分块请求）；超限返回 null（Q10）。 */
  const readCapped = (req, cap) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      req.on("data", (chunk) => {
        size += chunk.length
        if (size > cap) {
          // AC21-二轮：不在此处 destroy——抢先关闭让 413 响应无法完成；
          // 暂停流入，由 route 发送协议可识别拒绝后在 res finish 时断开。
          finish(null)
          req.pause()
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => finish(Buffer.concat(chunks)))
      req.on("error", (error) => {
        settled = true
        reject(error)
      })
      req.on("close", () => finish(null))
    })
  const route = async (req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) {
      void event("rejected", "Host 或 Origin 不允许。")
      return
    }
    if (req.url !== "/mcp") {
      res.writeHead(404).end()
      return
    }
    const principal = authenticate(registry, req.headers.authorization)
    if (!principal) {
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
      await principalContext.run(principal, async () => {
        // 两条协议路径统一在分发前按原始字节限流；超限 413，不进入协议处理（Q10）
        let bodyBytes
        if (req.method === "POST") {
          // AC21-二轮：content-length 已知超限直接拒绝（不消耗 body）
          const declared = Number(req.headers["content-length"] ?? 0)
          if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
            res.writeHead(413, {
              "content-type": "application/json; charset=utf-8",
            })
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32600,
                  message: `请求体超过 ${Math.round(MAX_REQUEST_BYTES / 1048576)}MiB 上限。`,
                },
                id: null,
              })
            )
            return
          }
          bodyBytes = await readCapped(req, MAX_REQUEST_BYTES)
          if (bodyBytes === null) {
            // AC21：协议可识别拒绝——先发送 413+JSON 说明，再在响应结束后断开；
            // 客户端得到明确错误而非 UND_ERR_SOCKET 网络断裂。
            if (!res.headersSent) {
              res.writeHead(413, {
                "content-type": "application/json; charset=utf-8",
              })
              res.end(
                JSON.stringify({
                  jsonrpc: "2.0",
                  error: {
                    code: -32600,
                    message: `请求体超过 ${Math.round(MAX_REQUEST_BYTES / 1048576)}MiB 上限。`,
                  },
                  id: null,
                })
              )
            }
            res.on("finish", () => req.destroy())
            return
          }
        }
        const web = new Request(
          `http://${req.headers.host || "127.0.0.1"}${req.url}`,
          {
            method: req.method,
            headers: req.headers,
            body: req.method === "POST" ? bodyBytes : undefined,
            duplex: "half",
            signal: controller.signal,
          }
        )
        // The SDK owns era classification, framing, initialization and cancellation.
        if (!(await isLegacyRequest(web.clone()))) {
          await toNodeHandler({ fetch: () => modern.fetch(web) })(req, res, {})
          return
        }
        const id = req.headers["mcp-session-id"]
        let item = typeof id === "string" ? sessions.get(id) : undefined
        if (item && item.credentialId !== principal.credentialId) {
          res.writeHead(404).end()
          return
        }
        let body
        if (req.method === "POST") {
          try {
            body = JSON.parse(bodyBytes.toString("utf8"))
          } catch {
            res.writeHead(400).end()
            return
          }
        }
        if (
          !item &&
          !id &&
          req.method === "POST" &&
          isInitializeRequest(body)
        ) {
          const perCredential = [...sessions.values()].filter(
            (entry) => entry.credentialId === principal.credentialId
          ).length
          if (
            perCredential >= MAX_SESSIONS_PER_CREDENTIAL ||
            sessions.size >= 64
          ) {
            res.writeHead(503).end()
            return
          }
          const server = build()
          const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => sessions.set(sessionId, item),
          })
          item = {
            server,
            transport,
            open: 0,
            lastActive: Date.now(),
            credentialId: principal.credentialId,
          }
          await server.connect(transport)
          server.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId)
          }
          void event("connected", "", { credentialId: principal.credentialId })
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
      })
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
    identity: summarize(registry),
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
      reveal: operation("reveal", () => {
        const legacy = registry.credentials.find(
          (credential) =>
            credential.actorId === LEGACY_ACTOR_ID && !credential.revokedAt
        )
        return { token: legacy?.token || "" }
      }),
      register: operation("register", (input) =>
        change(async () => {
          const { actor, credential, token } = await registerAgent(
            host.directory,
            registry,
            input.displayName
          )
          return {
            actorId: actor.actorId,
            displayName: actor.displayName,
            credentialId: credential.credentialId,
            token,
            revision: registry.revision,
          }
        })
      ),
      rotate: operation("rotate", (input) =>
        change(async () => {
          const { actor, credential, token } = await rotateActor(
            host.directory,
            registry,
            input.actorId
          )
          closeRevokedSessions()
          return {
            actorId: actor.actorId,
            displayName: actor.displayName,
            credentialId: credential.credentialId,
            token,
            revision: registry.revision,
          }
        })
      ),
      revoke: operation("revoke", (input) =>
        change(async () => {
          await revokeCredential(host.directory, registry, input.credentialId)
          closeRevokedSessions()
          return status()
        })
      ),
      credentials: operation("credentials", () => ({
        credentials: registry.credentials.map((credential) => {
          const actor = registry.actors.find(
            (item) => item.actorId === credential.actorId
          )
          return {
            actorId: credential.actorId,
            displayName: actor?.displayName || "",
            kind: actor?.kind || "agent",
            credentialId: credential.credentialId,
            createdAt: credential.createdAt,
            revokedAt: credential.revokedAt || "",
            valid: !credential.revokedAt,
          }
        }),
      })),
      reset: operation("reset", (input, signal) =>
        change(async () => {
          signal = AbortSignal.any([
            lifecycle.signal,
            ...(signal ? [signal] : []),
          ])
          if (input.revision !== settings.revision)
            throw new Error("MCP 配置已变化，请重新读取。")
          signal?.throwIfAborted()
          if (
            !registry.actors.some((actor) => actor.actorId === LEGACY_ACTOR_ID)
          )
            throw new Error("旧共享凭据不存在。")
          await rotateActor(host.directory, registry, LEGACY_ACTOR_ID)
          closeRevokedSessions()
          await event("token-reset")
          return status()
        })
      ),
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
            try {
              await stopListener(previous)
              issue = ""
            } catch (error) {
              // 配置已生效；仅旧监听释放未确认，如实提示而非抛错造成状态视图分叉。
              issue = `原端口监听释放未确认：${
                error instanceof Error ? error.message : "未知原因"
              }`
            }
          } else issue = ""
          notify()
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
