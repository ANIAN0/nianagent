import { spawn } from "node:child_process"

export function managedProcess(
  binary,
  args,
  options,
  { output = "complete" } = {}
) {
  if (
    process.platform !== "win32" ||
    !process.env.MOON_DESKTOP_EXECUTABLE ||
    !process.env.MOON_DESKTOP_PID
  )
    throw new Error("当前运行环境没有Moon进程树回收保护，未启动OpenCLI。")
  const child = spawn(
    process.env.MOON_DESKTOP_EXECUTABLE,
    ["--moon-managed-child", binary, ...args],
    {
      ...options,
      windowsHide: true,
      detached: false,
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  let out = "",
    err = "",
    pid,
    settled = false,
    resolveReady,
    rejectReady
  let outputExceeded = false
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const timer = setTimeout(() => {
    rejectReady(new Error("OpenCLI受管启动超时。"))
    child.stdin.end()
  }, 10000)
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (bytes) => {
    if (!outputExceeded) out += bytes
    const marker = out.match(/MOON_MANAGED_PID=([0-9]+)\r?\n/)
    if (!pid && marker) {
      pid = Number(marker[1])
      out = out.replace(marker[0], "")
      clearTimeout(timer)
      resolveReady(pid)
    }
    if (output === "tail") out = out.slice(-65536)
    else if (out.length > 16 * 1024 * 1024) {
      out = out.slice(0, 16 * 1024 * 1024)
      outputExceeded = true
      err = "OpenCLI输出超过接纳上限，结果未完整接收。"
      child.stdin.end()
    }
  })
  child.stderr.on("data", (bytes) => {
    err = (err + bytes).slice(-32768)
  })
  const done = new Promise((resolve, reject) => {
    child.once("error", () => {
      clearTimeout(timer)
      rejectReady(new Error("OpenCLI受管程序未能启动。"))
      reject(new Error("OpenCLI受管程序未能启动。"))
    })
    child.once("close", (code) => {
      settled = true
      clearTimeout(timer)
      if (!pid) rejectReady(new Error("OpenCLI未能进入进程回收保护。"))
      resolve({ code, stdout: out, stderr: err })
    })
  })
  // Startup is awaited by the owner; failure must not become an unhandled rejection.
  void done.catch(() => {})
  return {
    child,
    ready,
    done,
    get pid() {
      return pid
    },
    get settled() {
      return settled
    },
    stop() {
      // 先礼貌收尾；宽限后强杀，避免子进程或浏览器窗口僵死存活到退出。
      child.stdin.end()
      setTimeout(() => {
        if (!settled) child.kill()
      }, 5000)
    },
  }
}
