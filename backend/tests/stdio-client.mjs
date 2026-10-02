// Test-only stdio client. Production runtime ownership belongs to Tauri.
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
export function createBridge(options = {}) {
  let child
  const pending = new Map()
  function start() {
    if (child) return child
    const processChild = spawn(
      process.execPath,
      [fileURLToPath(new URL("../rpc.mjs", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, ...options.env },
      }
    )
    child = processChild
    const reader = createInterface({ input: processChild.stdout })
    reader.on("line", (line) => {
      try {
        const result = JSON.parse(line)
        const callback = pending.get(result.id)
        if (callback) {
          pending.delete(result.id)
          callback(result)
        }
      } catch {
        /* Ignore non-protocol output. */
      }
    })
    let diagnostic = ""
    processChild.stderr.on("data", (chunk) => {
      const text = String(chunk)
      if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/.test(text))
        diagnostic = "模型后端依赖文件缺失，请重新安装项目依赖。"
      else if (/SyntaxError|ERR_UNSUPPORTED/.test(text))
        diagnostic = "模型后端无法加载，请检查运行时版本与程序文件。"
    })
    let handled = false
    const failed = (error) => {
      if (handled || child !== processChild) return
      handled = true
      child = undefined
      for (const callback of pending.values())
        callback({
          error:
            error?.code === "ENOENT"
              ? "无法找到 Node.js 运行时，请检查安装路径。"
              : diagnostic || "模型后端进程意外退出，请检查程序安装后重试。",
        })
      pending.clear()
      reader.close()
    }
    processChild.stdin.on("error", failed)
    processChild.on("error", failed)
    processChild.on("close", failed)
    return processChild
  }
  return {
    call(operation, input, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted)
          return reject(new DOMException("已取消", "AbortError"))
        const current = start()
        const id = randomUUID()
        const abort = () => {
          pending.delete(id)
          current.stdin.write(
            JSON.stringify({ id, operation: "$cancel" }) + "\n"
          )
          cleanup()
          reject(new DOMException("已取消", "AbortError"))
        }
        const timer = setTimeout(abort, 60000)
        const cleanup = () => {
          clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
        }
        pending.set(id, (value) => {
          cleanup()
          if (value.error) reject(new Error(value.error))
          else resolve(value.result)
        })
        signal?.addEventListener("abort", abort, { once: true })
        current.stdin.write(JSON.stringify({ id, operation, input }) + "\n")
      })
    },
    close() {
      child?.stdin.end()
      child?.kill()
      child = undefined
    },
  }
}
