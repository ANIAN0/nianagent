import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { request as httpRequest } from "node:http"
import { runtimeVersion } from "./runtime.mjs"
import { readJsonBody } from "./http-body.mjs"
import { operationError, publicFailure } from "./operation-issue.mjs"

function unconfirmed(error) {
  const failure = new Error("未能确认此次操作的结果，请先核对状态。", {
    cause: error,
  })
  failure.name = "MoonOperationError"
  failure.issue = {
    code: "result_unknown",
    summary: failure.message,
    recovery: "check",
    severity: "warning",
    ...(error?.code === "MOON_RESPONSE_TIMEOUT"
      ? { details: "传输响应等待已超时；无法据此判断操作是否提交。" }
      : {}),
  }
  return failure
}

// Match the native command deadline. The directory host owns its shorter
// 600s user-selection wait; this margin lets its specific error reach the UI.
export const bridgeWaitMs = (operation) =>
  ["workspaceChoose", "materialChoose"].includes(operation) ? 610_000 : 60_000

function requestRuntime(runtime, operation, input, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let response
    let request
    try {
      request = httpRequest(
        {
          hostname: "127.0.0.1",
          port: runtime.port,
          agent: false,
          path: `/api/models/${encodeURIComponent(operation)}`,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-moon-token": runtime.token,
          },
          signal,
        },
        (incoming) => {
          response = incoming
          let body = ""
          incoming.setEncoding("utf8")
          incoming.on("data", (chunk) => {
            body += chunk
          })
          incoming.once("error", fail)
          incoming.once("end", () => {
            cleanup()
            let payload
            try {
              payload = JSON.parse(body)
              if (
                !payload ||
                typeof payload !== "object" ||
                Array.isArray(payload)
              )
                throw new Error("Invalid response envelope")
            } catch {
              reject(unconfirmed(new Error("Invalid response envelope")))
              return
            }
            if (
              incoming.statusCode < 200 ||
              incoming.statusCode >= 300 ||
              payload.error
            ) {
              const failure = new Error(payload.error || "本次操作未完成。")
              if (payload.issue) {
                failure.name = "MoonOperationError"
                failure.issue = payload.issue
              }
              reject(failure)
            } else resolve(payload.result)
          })
        }
      )
    } catch {
      reject(
        operationError(
          "host_connection",
          "Moon 服务连接信息无效，请重新启动 Moon。",
          "restart"
        )
      )
      return
    }
    const timer = setTimeout(() => {
      const error = new Error(
        operation === "workspaceChoose"
          ? "目录选择等待已超时，请关闭目录窗口后重试。"
          : "模型服务响应超时，请重试当前操作。"
      )
      error.code = "MOON_RESPONSE_TIMEOUT"
      request.destroy(error)
      response?.destroy(error)
    }, bridgeWaitMs(operation))
    timer.unref()
    function cleanup() {
      clearTimeout(timer)
    }
    function fail(error) {
      cleanup()
      if (signal?.aborted || error.code === "MOON_RESPONSE_TIMEOUT")
        reject(signal?.aborted ? error : unconfirmed(error))
      else reject(unconfirmed(error))
    }
    request.once("error", fail)
    request.end(JSON.stringify(input))
  })
}

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
          throw operationError(
            "host_unavailable",
            "Moon 服务尚未就绪，请启动或重新启动桌面应用。",
            "restart"
          )
        }
        if (runtime.version !== (await runtimeVersion()))
          throw operationError(
            "host_version",
            "Moon 服务代码已更新，请重新启动 Moon。",
            "restart"
          )
        if (
          !Number.isInteger(runtime.port) ||
          runtime.port < 1 ||
          runtime.port > 65535 ||
          typeof runtime.token !== "string"
        )
          throw operationError(
            "host_connection",
            "Moon 服务连接信息无效，请重新启动 Moon。",
            "restart"
          )
        // Built-in fetch has an implicit 300s Undici response-header deadline,
        // shorter than the user's native directory selection. Use node:http
        // with one explicit cancellable total deadline for both transports.
        return requestRuntime(runtime, operation, input, signal)
      },
    }
    server.middlewares.use("/api/models/", async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405
        res.end()
        return
      }
      const origin = req.headers.origin
      let validOrigin
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
      const operation = req.url.split("?")[0].replace(/^\//, "")
      try {
        const input = await readJsonBody(
          req,
          operation === "materialUpload" ? 16 * 1024 * 1024 : 1024 * 1024
        )
        const result = await bridge.call(operation, input, controller.signal)
        res.setHeader("content-type", "application/json")
        res.setHeader("cache-control", "no-store")
        res.end(JSON.stringify({ result }))
      } catch (error) {
        if (!res.destroyed) {
          res.statusCode = 400
          res.setHeader("content-type", "application/json")
          res.end(
            JSON.stringify(
              publicFailure(error, operation, controller.signal.aborted)
            )
          )
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
