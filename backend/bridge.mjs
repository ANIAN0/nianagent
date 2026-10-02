import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { runtimeVersion } from "./runtime.mjs"

export function modelBackendPlugin() {
  function configure(server) {
    const file =
      process.env.MOON_RUNTIME_FILE ||
      join(
        process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
        "Moon",
        "models",
        "runtime.json"
      )
    const bridge = {
      async call(operation, input, signal) {
        let runtime
        try {
          runtime = JSON.parse(await readFile(file, "utf8"))
        } catch {
          throw new Error("请先启动 Moon 桌面应用，浏览器将共用它的模型服务。")
        }
        if (runtime.version !== (await runtimeVersion()))
          throw new Error("模型服务代码已更新，请重启 Moon 后重新读取。")
        if (
          !Number.isInteger(runtime.port) ||
          runtime.port < 1 ||
          runtime.port > 65535 ||
          typeof runtime.token !== "string"
        )
          throw new Error("模型服务连接信息无效，请重启 Moon。")
        let response
        try {
          response = await fetch(
            `http://127.0.0.1:${runtime.port}/api/models/${encodeURIComponent(operation)}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-moon-token": runtime.token,
              },
              body: JSON.stringify(input),
              signal,
            }
          )
        } catch (error) {
          if (signal?.aborted) throw error
          throw new Error("无法连接 Moon 模型服务，请启动或重启桌面应用。")
        }
        const payload = await response.json()
        if (!response.ok || payload.error)
          throw new Error(payload.error || "模型服务请求失败。")
        return payload.result
      },
    }
    server.middlewares.use("/api/models/", async (req, res, next) => {
      if (req.method !== "POST") {
        res.statusCode = 405
        res.end()
        return
      }
      const origin = req.headers.origin
      let validOrigin = true
      try {
        validOrigin = !origin || new URL(origin).host === req.headers.host
      } catch {
        validOrigin = false
      }
      if (!validOrigin) {
        res.statusCode = 403
        res.end()
        return
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        res.statusCode = 415
        res.end()
        return
      }
      const controller = new AbortController()
      res.on("close", () => {
        if (!res.writableEnded) controller.abort()
      })
      try {
        let body = ""
        for await (const chunk of req) {
          body += chunk
          if (body.length > 1024 * 1024) throw new Error("请求过大。")
        }
        const result = await bridge.call(
          req.url.split("?")[0].replace(/^\//, ""),
          JSON.parse(body),
          controller.signal
        )
        res.setHeader("content-type", "application/json")
        res.setHeader("cache-control", "no-store")
        res.end(JSON.stringify({ result }))
      } catch (error) {
        if (!res.destroyed) {
          res.statusCode = 400
          res.setHeader("content-type", "application/json")
          res.end(JSON.stringify({ error: error.message }))
        }
      }
    })
  }
  return {
    name: "moon-model-backend",
    configureServer: configure,
    configurePreviewServer: configure,
  }
}
