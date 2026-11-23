import { createServer } from "node:http"
import { stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { replaceJson } from "../../atomic-file.mjs"
import { WorkbenchStore } from "./v2/storage.mjs"
import { createV2Service } from "./v2/service.mjs"
import { PreviewInventory } from "./v2/preview-inventory.mjs"
import {
  PreviewSessions,
  assetContentType,
  bridgeScript,
  injectBridge,
  isPreviewHost,
  previewHeaders as uiPreviewHeaders,
} from "./v2/preview.mjs"
import {
  pageHeaders,
  readSavedJson,
  sendJson,
} from "../../loopback-host.mjs"
import { notesWorkbenchOperations } from "./contract.mjs"
import { validatePluginValue } from "../../plugin-helpers.mjs"
import { redactSensitive } from "../../redact.mjs"
import { newTraceId } from "../../request-context.mjs"
import { operationError } from "../../operation-issue.mjs"

const maxBody = 8 * 1024 * 1024
const htmlHeaders = pageHeaders()
// 外壳既可独立打开，也被 moon 宿主内嵌：放行桌面壳（tauri.localhost）与
// vite 开发服务器（devUrl 钉在 5173），其余来源保持禁帧。
const shellCsp = htmlHeaders["content-security-policy"].replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self' http://tauri.localhost https://tauri.localhost http://localhost:5173 http://127.0.0.1:5173"
)
export async function activate(host) {
  if (
    process.env.MOON_DESKTOP_PACKAGED === "1" ||
    process.env.MOON_NOTES_DEV !== "1" ||
    process.env.MOON_WORKBENCH_DEV?.trim()
  ) {
    const { activate } = await import("./standalone-host.mjs")
    return activate(host)
  }
  const devMode = process.env.MOON_NOTES_DEV === "1"
  let devResources
  const shellHeaders = () =>
    pageHeaders({
      "content-security-policy": shellCsp
        .replace(
          "frame-src 'self'",
          `frame-src http://*.localhost:${settings.port}`
        )
        .replace(
          "script-src 'unsafe-inline'",
          `script-src ${devMode ? "'self' " : ""}'unsafe-inline'`
        )
        .replace(
          "style-src 'unsafe-inline'",
          `style-src ${devMode ? "'self' " : ""}'unsafe-inline'`
        ),
    })
  const settingsFile = join(host.directory, "settings.json")
  let settings = await readSavedJson(
    settingsFile,
    { revision: 0, port: 19830 },
    "笔记工作台"
  )
  if (
    !Number.isSafeInteger(settings.revision) ||
    !Number.isInteger(settings.port) ||
    settings.port < 1024 ||
    settings.port > 65535
  )
    throw new Error("笔记工作台配置无效，原文件保留。")
  // S2a v2 核心域：独立数据根 <host.directory>/v2/
  const v2Store = new WorkbenchStore(join(host.directory, "v2"))
  await v2Store.open()
  // G11：有界 JSONL 域日志（一次终态一条；脱敏白名单字段；写入失败不影响业务回执）
  if (!host.diagnostics?.append) throw new Error("工作台诊断端口未装配。")
  const domainLogger = host.diagnostics
  // AC22-二轮：运行时元素清单缓存（versionId → page → {capturedAt, elements}）；
  // 由 UiReader 加载后经 preview_inventory 上报（归属 sid+versionId），list_targets 合并消费
  const previewInventories = new PreviewInventory()
  const v2 = createV2Service(v2Store, {
    event: (status, error = "") => event(status, error),
    baseUrl: `http://127.0.0.1:${settings.port}/`,
    logger: domainLogger,
    changed: () => notify(),
    openVersionUrl: (draftId, versionId, compareVersionId) => {
      const params = new URLSearchParams({ draft: draftId, version: versionId })
      if (compareVersionId) params.set("compare", compareVersionId)
      return `http://127.0.0.1:${settings.port}/#v2?${params}`
    },
    inventory: {
      forVersion: (versionId) => previewInventories.get(versionId),
    },
  })
  for (const [key, definition] of Object.entries(v2.operations))
    if (definition.owner !== "workbench")
      throw new Error(`工作台操作 ${key} 缺少 owner 登记，拒绝激活。`)

  // UI 产物预览会话（T13）：随机会话子域 → 版本封存包；进程生命周期内有效，上限固定
  const previewSessions = new PreviewSessions()
  const servePreview = async (req, res, session, url) => {
    const pathname = url.pathname
    if (pathname.startsWith("/api")) {
      // 预览 origin 不可达管理 API（A14）：直接 404，不暴露存在性
      res.writeHead(404).end()
      return
    }
    try {
      if (pathname === "/__moon-bridge.js") {
        res.writeHead(200, {
          ...uiPreviewHeaders(settings.port),
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        })
        res.end(
          bridgeScript([
            `http://127.0.0.1:${settings.port}`,
            `http://localhost:${settings.port}`,
          ])
        )
        return
      }
      const content = await v2Store.readVersionContent(session.versionId)
      if (content.kind !== "ui") {
        res.writeHead(404).end()
        return
      }
      const routes = content.reading.manifest.routes
      const file = routes[pathname]
      if (file !== undefined) {
        const bytes = await v2Store.readAsset(session.versionId, file)
        if (/\.html?$/i.test(file)) {
          const injected = injectBridge(
            bytes.toString("utf8"),
            "/__moon-bridge.js",
            settings.port
          )
          res.writeHead(200, {
            ...uiPreviewHeaders(settings.port),
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          })
          res.end(injected)
        } else {
          res.writeHead(200, {
            ...uiPreviewHeaders(settings.port),
            "content-type": assetContentType(file),
            "cache-control": "immutable",
          })
          res.end(bytes)
        }
        return
      }
      // 未声明路由：包内静态资源直读（路径越界由 readAsset 边界拒绝）；缺失 404 不回退入口
      const relative = decodeURIComponent(pathname.slice(1))
      if (!relative) {
        res.writeHead(404).end()
        return
      }
      const bytes = await v2Store.readAsset(session.versionId, relative)
      res.writeHead(200, {
        ...uiPreviewHeaders(settings.port),
        "content-type": assetContentType(relative),
        "cache-control": "immutable",
      })
      res.end(bytes)
    } catch (error) {
      const status = error?.code === "not_found" ? 404 : 400
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
      })
      res.end(
        JSON.stringify({
          error: error?.message || "预览资源读取失败。",
          code: error?.code,
        })
      )
    }
  }

  let listener,
    workbenchHtml = "",
    resourceVersion = 0,
    issue = "",
    resourceIssue = "",
    closed = false,
    frozen = false,
    changing,
    closing
  const lifecycle = new AbortController()
  const sockets = new Set()
  const httpRequests = new Set()
  const event = (status, error = "") =>
    host.logs.append({
      source: "notes",
      plugin: "notes-workbench",
      status,
      error,
    })

  // 变更通知：全部写路径经此包装；工作台以长轮询获取版本变化，替代固定间隔轮询。
  // 通知游标只属于宿主生命周期；重启后也需让仍打开的页面重新读取导航。
  let dataVersion = Date.now()
  const waiters = new Set()
  const notify = () => {
    dataVersion += 1
    for (const wake of [...waiters]) wake()
  }
  // 页面资源是构建产物，按文件版本载入；重载操作读取新版本，监听与数据不受影响。
  const loadBundle = async () => {
    if (devMode) {
      devResources ??= await (
        await import("./dev-resources.mjs")
      ).createDevResources()
      workbenchHtml = await devResources.html()
      resourceVersion = Date.now()
      return resourceVersion
    }
    const bundleFile = join(
      dirname(fileURLToPath(import.meta.url)),
      "workbench.bundle.mjs"
    )
    const { mtimeMs } = await stat(bundleFile)
    const bundle = await import(
      `./workbench.bundle.mjs?v=${Math.floor(mtimeMs)}`
    )
    const html = String(bundle.workbenchHtml || "")
    if (!html) throw new Error("工作台页面资源为空。")
    workbenchHtml = html
    resourceVersion = Math.floor(mtimeMs)
    return resourceVersion
  }
  try {
    await loadBundle()
  } catch (error) {
    resourceIssue = devMode
      ? `工作台开发资源加载失败：${redactSensitive(String(error.message || error))}`
      : "工作台页面资源未构建：运行 pnpm notes:build 后重载页面资源。"
    await event("error", resourceIssue)
    void error
  }

  const gate = () => !closed && !frozen && !changing && host.isActive()
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      let done = false
      const chunks = []
      const fail = (error) => {
        if (done) return
        done = true
        chunks.length = 0
        reject(error)
      }
      const oversized = () => {
        // 先送达错误并排空在途正文，不存正文；未读数据立即关闭会产生 RST。
        // 完整排空后维持正常 keep-alive；持续发送者受绝对期限约束。
        const deadline = setTimeout(() => req.destroy(), 5000)
        deadline.unref()
        req.once("end", () => clearTimeout(deadline))
        req.once("close", () => clearTimeout(deadline))
        fail(
          Object.assign(new Error("请求体超过 8MiB。"), {
            status: 413,
            code: "limit_exceeded",
          })
        )
        req.resume()
      }
      if (Number(req.headers["content-length"]) > maxBody) {
        oversized()
        return
      }
      req.on("data", (chunk) => {
        if (done) return
        size += chunk.length
        if (size > maxBody) {
          oversized()
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => {
        if (done) return
        try {
          const text = Buffer.concat(chunks).toString("utf8")
          const value = text ? JSON.parse(text) : {}
          done = true
          resolve(value)
        } catch {
          fail(
            Object.assign(new Error("请求体不是有效 JSON。"), { status: 400 })
          )
        }
      })
      req.on("error", fail)
      req.on("aborted", () =>
        fail(Object.assign(new Error("请求已取消。"), { status: 400 }))
      )
    })

  const routes = {
    // 长轮询：持有至数据版本变化或 25 秒超时。
    "GET /api/sync": (_body, url, res) => {
      const since = Number(url.searchParams.get("version") ?? "")
      if (!Number.isSafeInteger(since))
        throw Object.assign(new Error("version 需为整数。"), { status: 400 })
      if (since !== dataVersion) return { version: dataVersion }
      if (waiters.size >= 64)
        throw Object.assign(
          new Error("同步连接已达上限，请关闭多余页面后重试。"),
          { status: 503 }
        )
      return new Promise((resolve) => {
        const wake = (timeout = false) => {
          clearTimeout(timer)
          waiters.delete(wake)
          res.off("close", wake)
          resolve({ version: dataVersion, timeout })
        }
        const timer = setTimeout(() => wake(true), 25000)
        waiters.add(wake)
        res.once("close", wake)
      })
    },
  }
  const route = async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const hostHeader = req.headers.host || ""
    // 预览会话子域：<sid>.localhost 与管理端不同 origin（T13）；Host 校验先于会话校验
    const previewSid = isPreviewHost(hostHeader, settings.port)
    if (previewSid !== null) {
      if (req.method !== "GET") {
        res.writeHead(405).end()
        return
      }
      const session = previewSessions.resolve(previewSid)
      if (!session) {
        res.writeHead(404).end()
        return
      }
      await servePreview(req, res, session, url)
      return
    }
    if (
      hostHeader !== `127.0.0.1:${settings.port}` &&
      hostHeader !== `localhost:${settings.port}`
    ) {
      void event("rejected", "Host 不允许。")
      sendJson(res, 403, { error: "仅本机可访问。" })
      return
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      if (!workbenchHtml) {
        sendJson(res, 503, {
          error: issue || resourceIssue || "工作台页面资源未构建。",
        })
        return
      }
      const html = devResources ? await devResources.html() : workbenchHtml
      res.writeHead(200, shellHeaders())
      res.end(html)
      return
    }
    if (devResources && !url.pathname.startsWith("/api/")) {
      if (await devResources.serve(req, res)) return
      sendJson(res, 404, { error: "开发资源不存在。" })
      return
    }
    const originHeader = req.headers.origin
    if (
      originHeader !== undefined &&
      originHeader !== `http://127.0.0.1:${settings.port}` &&
      originHeader !== `http://localhost:${settings.port}`
    ) {
      void event("rejected", "Origin 不允许。")
      sendJson(res, 403, { error: "仅允许工作台同源访问。" })
      return
    }
    if (!gate()) {
      sendJson(res, 503, { error: "服务已暂停。" })
      return
    }
    // v2 版本资源（图片等）：缺失 404，不回退
    if (req.method === "GET" && url.pathname === "/api/v2/asset") {
      const versionId = url.searchParams.get("versionId") ?? ""
      const relative = url.searchParams.get("path") ?? ""
      try {
        const bytes = await v2Store.readAsset(versionId, relative)
        const types = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".webp": "image/webp",
        }
        const dot = relative.lastIndexOf(".")
        res.writeHead(200, {
          "content-type":
            types[relative.slice(dot).toLowerCase()] ??
            "application/octet-stream",
          "cache-control": "immutable",
        })
        res.end(bytes)
      } catch (error) {
        sendJson(
          res,
          error?.status ?? (error?.code === "not_found" ? 404 : 400),
          {
            error: error?.message || "资源读取失败。",
          }
        )
      }
      return
    }
    // AC04：preview_open/preview_close 为专用操作，置于通用路由之前并做同等严格校验；
    // 否则通用 POST /api/v2/* 路由会按未知操作抢先 404，预览无法打开
    if (req.method === "POST" && url.pathname === "/api/v2/preview_open") {
      try {
        const body = await readBody(req)
        const versionId =
          typeof body?.versionId === "string" ? body.versionId : ""
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(versionId)) {
          sendJson(res, 400, {
            error: "版本标识无效。",
            code: "validation_failed",
          })
          return
        }
        const content = await v2Store.readVersionContent(versionId)
        if (content.kind !== "ui")
          throw Object.assign(new Error("仅界面产物版本可打开预览。"), {
            code: "unsupported_artifact",
          })
        const sid = previewSessions.open(versionId)
        sendJson(res, 200, {
          sessionUrl: `http://${sid}.localhost:${settings.port}/`,
          sid,
        })
      } catch (error) {
        sendJson(
          res,
          error?.status ??
            (error?.code === "limit_exceeded"
              ? 503
              : error?.code === "not_found"
                ? 404
                : 400),
          {
            error: error?.message || "预览会话打开失败。",
            code: error?.code,
          }
        )
      }
      return
    }
    // AC22-二轮：运行时元素清单上报（归属 sid+versionId；每版本每页保留最新一份，有界）
    if (req.method === "POST" && url.pathname === "/api/v2/preview_inventory") {
      try {
        const body = await readBody(req)
        const sid = typeof body?.sid === "string" ? body.sid : ""
        const versionId =
          typeof body?.versionId === "string" ? body.versionId : ""
        const page = body?.page
        const elements = body?.elements
        const session = previewSessions.resolve(sid)
        if (!session || session.versionId !== versionId) {
          sendJson(res, 403, {
            error: "预览会话无效或归属不符。",
            code: "validation_failed",
          })
          return
        }
        const content = await v2Store.readVersionContent(versionId)
        if (content.kind !== "ui") throw new Error("元素清单仅适用于UI版本。")
        const count = previewInventories.capture(
          versionId,
          content.reading.manifest,
          page,
          elements
        )
        sendJson(res, 200, { captured: true, page, elements: count })
      } catch (error) {
        sendJson(res, error?.status ?? 400, {
          error: error?.message || "清单上报失败。",
          code: error?.code,
        })
      }
      return
    }
    // AC09：预览会话释放——归属校验（提供 versionId 时须匹配），未知 sid 幂等
    if (req.method === "POST" && url.pathname === "/api/v2/preview_close") {
      try {
        const body = await readBody(req)
        const sid = typeof body?.sid === "string" ? body.sid : ""
        const versionId =
          typeof body?.versionId === "string" ? body.versionId : undefined
        if (!/^[a-z0-9]{6}$/.test(sid)) {
          sendJson(res, 400, {
            error: "预览会话标识无效。",
            code: "validation_failed",
          })
          return
        }
        const released = previewSessions.release(sid, versionId)
        sendJson(res, 200, { sid, released })
      } catch (error) {
        sendJson(res, error?.status ?? 400, {
          error: error?.message || "预览会话释放失败。",
          code: error?.code,
        })
      }
      return
    }
    // v2 通用操作路由：POST /api/v2/<name> → v2_<name> 操作；UI 来源即用户（local-user）
    if (req.method === "POST" && url.pathname.startsWith("/api/v2/")) {
      const operationKey = `v2_${url.pathname.slice("/api/v2/".length)}`
      const definition = v2.operations[operationKey]
      if (!definition) {
        sendJson(res, 404, { error: "未知操作。" })
        return
      }
      const controller = new AbortController()
      // 取消接线：客户端断开即中止（与 MCP transport 的 signal 语义一致）
      res.on("close", () => controller.abort())
      try {
        const body = await readBody(req)
        // readBody 已返回解析后的对象；字符串时兼容解析
        const parsed =
          typeof body === "string" ? JSON.parse(body) : (body ?? {})
        // AC10：HTTP 与 MCP/Pi 走同一输入 schema 校验，非法字段给一致明确结果
        validatePluginValue(definition.input, parsed)
        const { value } = await host.lease(() =>
          definition.execute(
            parsed,
            { source: "local", traceId: newTraceId() },
            controller.signal
          )
        )
        sendJson(res, 200, value ?? {})
      } catch (error) {
        void event(
          "error",
          `v2 操作未完成：${error?.code ?? "error"}${error?.errorId ? ` [${error.errorId}]` : ""}`
        )
        // G20：领域回执 outcome 优先（wrap 已按 internal_error/取消记 unknown）；
        // 其余（请求体解析等未进入领域的失败）保持 rejected；事件流与回执只带安全摘要
        sendJson(
          res,
          error?.status ??
            (error?.code === "not_found" || error?.code === "invalid_anchor"
              ? 404
              : 400),
          {
            error: redactSensitive(
              error?.issue?.safeMessage || error?.message || "操作未完成。"
            ),
            code: error?.code,
            errorId: error?.errorId,
            outcome: error?.issue?.outcome ?? "rejected",
          }
        )
      }
      return
    }
    const handler = routes[`${req.method} ${url.pathname}`]
    if (!handler) {
      sendJson(res, 404, { error: "未知路径。" })
      return
    }
    try {
      const body = req.method === "POST" ? await readBody(req) : undefined
      const value = await handler(body, url, res)
      if (!res.destroyed) sendJson(res, 200, value ?? {})
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 400
      void event("error", `工作台请求未完成；未保存原始内容。`)
      sendJson(res, status, { error: error?.message || "请求未完成。" })
    }
  }

  const open = async (port) => {
    const server = createServer((req, res) => {
      const request = route(req, res).catch((error) => {
        void event("error", redactSensitive(String(error.message || error)))
        if (!res.headersSent)
          sendJson(res, 500, { error: "工作台请求失败，请重试。" })
        else res.destroy()
      })
      httpRequests.add(request)
      void request.then(
        () => httpRequests.delete(request),
        () => httpRequests.delete(request)
      )
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
      const failure = operationError(
        error.code === "EADDRINUSE" ? "port_in_use" : "listener_failed",
        error.code === "EADDRINUSE"
          ? "端口已占用，请选择其他固定端口。"
          : "笔记工作台监听失败，请检查端口。",
        "settings"
      )
      failure.cause = error
      throw failure
    }
    server.on("error", () => {
      issue = "笔记工作台监听发生错误，请重新保存端口或重启插件。"
      void event("error", issue)
    })
    return server
  }
  const stopListener = async (server) => {
    if (!server) return
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

  const status = () => ({
    running: !!listener?.listening && !frozen,
    port: settings.port,
    url: `http://127.0.0.1:${settings.port}/`,
    revision: settings.revision,
    issue: issue || resourceIssue,
    logIssue: host.logs.issue,
  })
  const change = (action) => {
    if (changing || closed || frozen)
      throw new Error("笔记工作台正在变更或停止。")
    changing = Promise.resolve()
      .then(action)
      .finally(() => {
        changing = undefined
      })
    return changing
  }
  const operation = (name, action) => ({
    ...notesWorkbenchOperations[name],
    execute: async (input, _context, signal) => ({
      value: await action(input, signal),
    }),
  })
  return {
    sharedTools: v2.sharedTools,
    operations: {
      ...v2.operations,
      status: operation("status", status),
      reload: operation("reload", async () => {
        const version = await loadBundle()
        await event("reloaded")
        return { version }
      }),
      save: operation("save", (input, signal) =>
        change(async () => {
          signal = AbortSignal.any([
            lifecycle.signal,
            ...(signal ? [signal] : []),
          ])
          if (input.revision !== settings.revision)
            throw new Error("配置已变化，请重新读取。")
          signal?.throwIfAborted()
          const next = { port: input.port, revision: settings.revision + 1 }
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
          return status()
        })
      ),
    },
    status: () =>
      issue ||
      resourceIssue ||
      (listener?.listening && !frozen
        ? `本机工作台 ${settings.port}`
        : "服务已暂停"),
    async quiesce() {
      frozen = true
    },
    resume() {
      frozen = false
    },
    close() {
      if (closing) return closing
      closed = true
      frozen = true
      lifecycle.abort()
      // 唤醒挂起的长轮询，让客户端在关闭前拿到最终版本。
      notify()
      const domainClosing = v2.close()
      closing = (async () => {
        await changing?.catch(() => {})
        await devResources?.close()
        await stopListener(listener)
        for (const socket of sockets) socket.destroy()
        await Promise.allSettled([...httpRequests])
        await domainClosing
        v2Store.close()
        await event("stopped")
      })()
      return closing
    },
  }
}
