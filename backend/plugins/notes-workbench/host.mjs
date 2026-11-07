import { createServer } from "node:http"
import { readdirSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { replaceJson } from "../../atomic-file.mjs"
import {
  bearerAuthorized,
  createTickets,
  loadTokenIdentity,
  moduleHeaders,
  pageHeaders,
  readSavedJson,
  sendJson,
} from "../../loopback-host.mjs"
import { operations as coreOperations } from "../../contract.mjs"
import { notesWorkbenchOperations } from "./contract.mjs"
import { workbenchFingerprint } from "./fingerprint.mjs"
import { openStore, starterPageCode } from "./store.mjs"

const maxBody = 4 * 1024 * 1024
const htmlHeaders = pageHeaders()
// 外壳既可独立打开，也被 moon 宿主内嵌：放行桌面壳（tauri.localhost）与
// vite 开发服务器（devUrl 钉在 5173），其余来源保持禁帧。
const shellCsp = htmlHeaders["content-security-policy"].replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self' http://tauri.localhost https://tauri.localhost http://localhost:5173 http://127.0.0.1:5173"
)
const shellHeaders = pageHeaders({ "content-security-policy": shellCsp })
// 预览文档只被同源工作台页面内嵌；并加载同源 vendor 与预览 bundle 模块。
const previewCsp = htmlHeaders["content-security-policy"]
  .replace("frame-ancestors 'none'", "frame-ancestors 'self'")
  .replace(
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  )
const previewHeaders = pageHeaders({ "content-security-policy": previewCsp })
export async function activate(host) {
  // 接口参考索引：核心契约 + 内置插件契约（<plugin>.<operation>，与接口文档投影同名）。
  const operationsIndex = {}
  const indexOperations = (operations) => {
    for (const [id, operation] of Object.entries(operations ?? {}))
      if (
        operation &&
        typeof operation.module === "string" &&
        typeof operation.method === "string"
      )
        operationsIndex[id] = {
          module: operation.module,
          method: operation.method,
          title: operation.title ?? "",
        }
  }
  indexOperations(coreOperations)
  const here = dirname(fileURLToPath(import.meta.url))
  for (const name of readdirSync(join(here, ".."), { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    try {
      const module = await import(`../${name.name}/contract.mjs`)
      for (const value of Object.values(module)) {
        if (!value || typeof value !== "object") continue
        for (const [operationId, operation] of Object.entries(value))
          if (
            operation &&
            typeof operation.module === "string" &&
            typeof operation.method === "string"
          )
            operationsIndex[`${name.name}.${operationId}`] = {
              module: operation.module,
              method: operation.method,
              title: operation.title ?? "",
            }
      }
    } catch {
      // 无契约或契约不可加载的插件跳过；接口参考块按未找到呈现。
    }
  }
  const settingsFile = join(host.directory, "settings.json"),
    tokenFile = join(host.directory, "token.json")
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
  const identity = await loadTokenIdentity(tokenFile, "笔记工作台")

  const baseStore = await openStore(host.directory)
  let seed = null
  try {
    seed = JSON.parse(
      await readFile(
        join(dirname(fileURLToPath(import.meta.url)), "seed.json"),
        "utf8"
      )
    )
  } catch {
    seed = null
  }
  let listener,
    workbenchHtml = "",
    previewHtml = "",
    vendorCode = "",
    previewCode = "",
    resourceVersion = 0,
    issue = "",
    resourceIssue = "",
    closed = false,
    frozen = false,
    changing,
    closing
  const lifecycle = new AbortController()
  const sockets = new Set()
  const event = (status, error = "") =>
    host.logs.append({
      source: "notes",
      plugin: "notes-workbench",
      status,
      error,
    })
  if (baseStore.health?.reason) await event("error", baseStore.health.reason)

  // 变更通知：全部写路径经此包装；工作台以长轮询获取版本变化，替代固定间隔轮询。
  let dataVersion = 1
  const waiters = new Set()
  const notify = () => {
    dataVersion += 1
    for (const wake of [...waiters]) wake()
  }
  const store = { ...baseStore }
  for (const name of [
    "createDirectory",
    "createPage",
    "writePage",
    "setStateArgs",
    "setPageStatus",
    "addComment",
    "setCommentResolved",
    "deletePage",
    "deleteDirectory",
    "importSeed",
  ])
    store[name] = async (input) => {
      const result = await baseStore[name](input)
      notify()
      return result
    }

  // 页面资源是构建产物，按文件版本载入；重载操作读取新版本，监听与数据不受影响。
  const loadBundle = async () => {
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
    previewHtml = String(bundle.previewHtml || "")
    try {
      const preview = await import(
        `./preview.bundle.mjs?v=${Math.floor(mtimeMs)}`
      )
      vendorCode = String(preview.vendorCode || "")
      previewCode = String(preview.previewCode || "")
    } catch {
      // 预览模块未构建：页面可用，条目渲染时提示重建。
      vendorCode = ""
      previewCode = ""
    }
    resourceVersion = Math.floor(mtimeMs)
    // 指纹不一致说明改了源码没重建；打包安装不含源码目录时跳过核对。
    const actual = await workbenchFingerprint()
    resourceIssue =
      actual && bundle.sourceFingerprint && actual !== bundle.sourceFingerprint
        ? "工作台源码已更新而产物未重建：运行 pnpm notes:build 后重载页面资源。"
        : ""
    return resourceVersion
  }
  try {
    await loadBundle()
  } catch (error) {
    resourceIssue =
      "工作台页面资源未构建：运行 pnpm notes:build 后重载页面资源。"
    await event("error", resourceIssue)
    void error
  }

  // 打开地址只携带一次性票据：长期 token 由页面资源注入内存，不进入浏览器历史。
  const tickets = createTickets()
  const issueTicket = () => tickets.issue()
  const authorize = (header) => bearerAuthorized(header, identity.token)
  const gate = () => !closed && !frozen && !changing && host.isActive()
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on("data", (chunk) => {
        size += chunk.length
        if (size > maxBody) {
          reject(Object.assign(new Error("请求体过大。"), { status: 413 }))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8")
          resolve(text ? JSON.parse(text) : {})
        } catch {
          reject(
            Object.assign(new Error("请求体不是有效 JSON。"), { status: 400 })
          )
        }
      })
      req.on("error", reject)
    })

  const routes = {
    "GET /api/state": () => ({
      ...store.snapshot(),
      resourceVersion,
      dataVersion,
      health: store.health,
    }),
    // 长轮询：持有至数据版本变化或 25 秒超时；token 走 Authorization 头，不进入地址。
    "GET /api/sync": (_body, url) => {
      const since = Number(url.searchParams.get("version") ?? "")
      if (!Number.isSafeInteger(since))
        throw Object.assign(new Error("version 需为整数。"), { status: 400 })
      if (since < dataVersion) return { version: dataVersion }
      return new Promise((resolve) => {
        const wake = (timeout = false) => {
          clearTimeout(timer)
          waiters.delete(wake)
          resolve({ version: dataVersion, timeout })
        }
        const timer = setTimeout(() => wake(true), 25000)
        waiters.add(wake)
      })
    },
    "GET /api/operations": () => ({ operations: operationsIndex }),
    "GET /api/page": async (req, url) => {
      const pageId = url.searchParams.get("id") || ""
      return store.readPage(pageId)
    },
    "POST /api/directory": (body) => store.createDirectory(body),
    "POST /api/directory/delete": (body) => store.deleteDirectory(body),
    "POST /api/page": (body) =>
      store.createPage({
        ...body,
        // 界面「+页面」不传源码；指向预览条目的页面保留空源码。
        code: body?.code || (body?.meta?.preview ? "" : starterPageCode),
      }),
    "POST /api/page/status": (body) => store.setPageStatus(body),
    "POST /api/page/args": (body) => store.setStateArgs(body),
    "POST /api/page/delete": (body) => store.deletePage(body),
    "POST /api/page/write": (body) => store.writePage(body),
    "POST /api/comment": (body) =>
      store.addComment({ ...body, author: "user" }),
    "POST /api/comment/resolve": (body) => store.setCommentResolved(body),
    "POST /api/seed/load": () => {
      if (!seed) throw new Error("种子数据未生成：运行 pnpm notes:build。")
      return store.importSeed({ seed })
    },
  }
  const route = async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const hostHeader = req.headers.host || ""
    if (
      !hostHeader.startsWith("127.0.0.1:") &&
      !hostHeader.startsWith("localhost:")
    ) {
      void event("rejected", "Host 不允许。")
      sendJson(res, 403, { error: "仅本机可访问。" })
      return
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/preview/vendor.mjs" ||
        url.pathname === "/preview/bundle.mjs")
    ) {
      // 预览模块只含代码不含数据，与预览外壳同级别放行；数据仍由带 token 的 API 提供。
      const code = url.pathname.endsWith("vendor.mjs")
        ? vendorCode
        : previewCode
      if (!code) {
        sendJson(res, 503, {
          error: "预览模块未构建：运行 pnpm notes:build 后重载页面资源。",
        })
        return
      }
      res.writeHead(200, moduleHeaders)
      res.end(code)
      return
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/preview.html" || url.pathname === "/preview")
    ) {
      // 预览外壳不含数据；由工作台页面同源内嵌。
      if (!previewHtml) {
        sendJson(res, 503, {
          error: issue || resourceIssue || "预览页面资源未构建。",
        })
        return
      }
      res.writeHead(200, previewHeaders)
      res.end(previewHtml)
      return
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      // 外壳不含数据，始终可载；票据（或已持 token）换取 token 注入。
      // 无 token 的会话由页面自身提示从插件详情打开，刷新不依赖票据。
      if (!workbenchHtml) {
        sendJson(res, 503, {
          error: issue || resourceIssue || "工作台页面资源未构建。",
        })
        return
      }
      const ticket = url.searchParams.get("ticket")
      const admitted =
        tickets.verify(ticket) || authorize(req.headers.authorization)
      if (!admitted) {
        void event("rejected", "打开票据缺失或已使用。")
        res.writeHead(200, shellHeaders)
        res.end(workbenchHtml)
        return
      }
      const opening = workbenchHtml.replace(
        '<script type="module">',
        `<script>window.__moonNotesWorkbenchToken=${JSON.stringify(identity.token)}</script><script type="module">`
      )
      if (!opening.includes("__moonNotesWorkbenchToken")) {
        sendJson(res, 500, { error: "工作台页面资源无效，请重载页面资源。" })
        return
      }
      res.writeHead(200, shellHeaders)
      res.end(opening)
      return
    }
    if (!authorize(req.headers.authorization)) {
      void event("rejected", "缺少或无效的访问 token。")
      sendJson(res, 401, { error: "token 无效。" })
      return
    }
    if (!gate()) {
      sendJson(res, 503, { error: "服务已暂停。" })
      return
    }
    const handler = routes[`${req.method} ${url.pathname}`]
    if (!handler) {
      sendJson(res, 404, { error: "未知路径。" })
      return
    }
    try {
      const body = req.method === "POST" ? await readBody(req) : undefined
      const value = await handler(body, url)
      sendJson(res, 200, value ?? {})
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 400
      void event("error", `工作台请求未完成；未保存原始内容。`)
      sendJson(res, status, { error: error?.message || "请求未完成。" })
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
          : "笔记工作台监听失败，请检查端口。",
        { cause: error }
      )
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

  const status = () => {
    const snapshot = store.snapshot()
    return {
      running: !!listener?.listening && !frozen,
      port: settings.port,
      url: `http://127.0.0.1:${settings.port}/`,
      revision: settings.revision,
      issue: issue || resourceIssue,
      dataIssue: store.health?.reason ?? "",
      logIssue: host.logs.issue,
      directories: snapshot.directories.length,
      pages: snapshot.pages.length,
    }
  }
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
    operations: {
      status: operation("status", status),
      reveal: operation("reveal", () => ({ token: identity.token })),
      ticket: operation("ticket", () => ({ ticket: issueTicket() })),
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
            await stopListener(previous)
          }
          issue = ""
          return status()
        })
      ),
      list: operation("list", () => store.snapshot()),
      read_page: operation("read_page", (input) =>
        store.readPage(input.pageId)
      ),
      create_directory: operation("create_directory", (input) =>
        store.createDirectory(input)
      ),
      create_page: operation("create_page", (input) => store.createPage(input)),
      write_page: operation("write_page", (input) => store.writePage(input)),
      set_state_args: operation("set_state_args", (input) =>
        store.setStateArgs(input)
      ),
      set_comment_resolved: operation("set_comment_resolved", (input) =>
        store.setCommentResolved(input)
      ),
      load_seed: operation("load_seed", () => {
        if (!seed) throw new Error("种子数据未生成：运行 pnpm notes:build。")
        return store.importSeed({ seed })
      }),
      add_comment: operation("add_comment", (input) =>
        store.addComment({ ...input, author: "agent" })
      ),
    },
    status: () =>
      issue ||
      resourceIssue ||
      store.health?.reason ||
      (listener?.listening && !frozen
        ? `本机工作台 ${settings.port}；${store.snapshot().pages.length} 个页面`
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
      closing = (async () => {
        await changing?.catch(() => {})
        await stopListener(listener)
        for (const socket of sockets) socket.destroy()
        await event("stopped")
      })()
      return closing
    },
  }
}
