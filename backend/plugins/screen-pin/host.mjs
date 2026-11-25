import { spawn } from "node:child_process"
import { join } from "node:path"
import { createInterface } from "node:readline"

export async function activate() {
  if (process.platform !== "win32")
    throw new Error("截图贴图需要 Windows 桌面。")

  const systemRoot =
    process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
  const shell = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  )
  const child = spawn(
    shell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-Command",
      "$ErrorActionPreference='Stop'; Add-Type -Path './ScreenPin.cs' -ReferencedAssemblies System.Windows.Forms,System.Drawing; [MoonScreenPin]::Run()",
    ],
    {
      cwd: import.meta.dirname,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  const output = createInterface({ input: child.stdout })
  let stderrBuffer = ""
  child.stderr.on("data", (chunk) => {
    if (stderrBuffer.length < 4096) {
      stderrBuffer += chunk.toString("utf8")
    }
  })
  const done = new Promise((resolve) => child.once("close", resolve))
  try {
    await new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      child.once("error", (err) => settle(reject, err))
      const timer = setTimeout(
        () => settle(reject, new Error("截图快捷键启动超时。")),
        15000
      )
      done.then(() => {
        const detail = stderrBuffer.trim().slice(0, 400)
        settle(
          reject,
          new Error(
            detail
              ? `截图进程启动失败：${detail}`
              : "截图进程启动失败，请检查 Windows PowerShell 和桌面会话。"
          )
        )
      })
      output.once("line", (line) => {
        if (line === "READY") settle(resolve)
        else
          settle(
            reject,
            new Error(
              line === "HOTKEY_BUSY"
                ? "F1 已被占用，请释放快捷键后重新启用。"
                : "无法注册桌面截图快捷键。"
            )
          )
      })
    })
    output.close()
    child.stdout.resume()
  } catch (error) {
    output.close()
    child.kill()
    await done
    throw error
  }
  return {
    status: () =>
      child.exitCode === null && !child.signalCode
        ? "F1 截图贴图已就绪"
        : "截图进程已退出，请重新启用插件。",
    async close() {
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), 1500)
      try {
        await done
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
