import type { Plugin } from "vite"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { collectProjectAsync } from "./project-index.mjs"

export function developerToolsPlugin(): Plugin {
  let reading: ReturnType<typeof collectProjectAsync> | undefined
  return {
    name: "moon-developer-tools",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        if (/^\/devtools\/(?:index\.html|preview\.html)?$/.test(url.pathname)) {
          const preview = url.pathname.endsWith("preview.html")
          const tool = url.searchParams.get("tool")
          const path = preview
            ? "/ui-catalog/preview.html"
            : tool === "components"
              ? "/ui-catalog/"
              : tool === "api"
                ? "/api-catalog/"
                : "/project/"
          url.searchParams.delete("tool")
          response.writeHead(302, {
            Location: `${path}${url.searchParams.size ? `?${url.searchParams}` : ""}`,
          })
          response.end()
          return
        }
        if (
          ["/project", "/project/", "/project/index.html"].includes(
            url.pathname
          )
        ) {
          request.url = `/devtools/project.html${url.search}`
          return next()
        }
        if (
          ![
            "/__devtools/project",
            "/__devtools/design",
            "/__devtools/source",
          ].includes(url.pathname)
        )
          return next()
        response.setHeader("Content-Type", "application/json; charset=utf-8")
        response.setHeader("Cache-Control", "no-store")
        const local = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
        const host = request.headers.host
        const origin = request.headers.origin
        const expectedPort = server.httpServer?.address()
        let allowed = local.has(request.socket.remoteAddress ?? "") && !!host
        try {
          const requested = new URL(`http://${host}`)
          allowed &&=
            ["localhost", "127.0.0.1", "[::1]"].includes(requested.hostname) &&
            (typeof expectedPort !== "object" ||
              !expectedPort ||
              Number(requested.port || "80") === expectedPort.port)
          if (origin) allowed &&= new URL(origin).host === host
        } catch {
          allowed = false
        }
        if (request.headers["sec-fetch-site"] === "cross-site") allowed = false
        if (!allowed) {
          response.statusCode = 403
          response.end(
            JSON.stringify({ error: "项目索引仅供本机同源开发页面读取。" })
          )
          return
        }
        if (request.method !== "GET") {
          response.statusCode = 405
          response.end(JSON.stringify({ error: "仅支持 GET。" }))
          return
        }
        if (url.pathname === "/__devtools/design") {
          try {
            response.setHeader("Content-Type", "text/plain; charset=utf-8")
            response.end(
              readFileSync(resolve(server.config.root, "DESIGN.md"), "utf8")
            )
          } catch {
            response.statusCode = 404
            response.end("本地 DESIGN.md 不可用。")
          }
          return
        }
        reading ??= collectProjectAsync().finally(() => {
          reading = undefined
        })
        void reading.then(
          (project) => {
            if (url.pathname === "/__devtools/source") {
              const file = project.files.find(
                (item) => item.path === url.searchParams.get("path")
              )
              response.setHeader("Content-Type", "text/plain; charset=utf-8")
              if (
                !file ||
                file.diskState !== "file" ||
                !/\.(?:tsx?|mjs|js|css|json|md|rs|toml|ya?ml|html|txt)$/.test(
                  file.path
                )
              ) {
                response.statusCode = 404
                response.end("当前源码不可读取，或此资源不是可展示的文本文件。")
                return
              }
              try {
                const content = readFileSync(
                  resolve(server.config.root, file.path),
                  "utf8"
                )
                if (content.length > 1024 * 1024) {
                  response.statusCode = 413
                  response.end("此文件超过 1 MiB，请在本地编辑器中阅读。")
                } else response.end(content)
              } catch {
                response.statusCode = 404
                response.end("源码已移动或不可读取，请刷新文件索引。")
              }
              return
            }
            response.end(JSON.stringify(project))
          },
          (error: unknown) => {
            response.statusCode = 503
            response.end(
              JSON.stringify({
                error:
                  error instanceof Error ? error.message : "Git 索引读取失败。",
              })
            )
          }
        )
      })
    },
  }
}
