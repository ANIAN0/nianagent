import "./startup-surface.css"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { BootSnapshot } from "@/contracts/desktop.generated"

/** 仅真实界面失败调用：已Ready宿主先记录本页失败，再按权威能力取得退出动作。 */
export async function startupExitAction(): Promise<
  (() => Promise<void>) | null
> {
  if (!isTauri()) return null
  let snapshot = await invoke<BootSnapshot>("boot_get_state")
  if (snapshot.phase === "ready" && snapshot.storage) {
    const current = snapshot
    const storage = snapshot.storage
    const failed = await invoke<BootSnapshot>("boot_acknowledge_frontend", {
      input: {
        attemptId: current.attemptId,
        dataSetId: storage.dataSetId,
        generation: storage.generation,
        stage: "workbench",
        ready: false,
      },
    })
    // 不能把另一轮启动的结果当作本页面合法退出；正常Ready能力仍不放宽。
    if (failed.attemptId !== current.attemptId || failed.phase !== "failed")
      return null
    snapshot = failed
  }
  if (!snapshot.capabilities.exit) return null
  return async () => {
    await invoke("boot_exit", { input: { attemptId: snapshot.attemptId } })
  }
}

/** 截止只报告真实资源等待失败；超时后的迟到模块不能推进已经结束的启动。 */
export function loadStartupModule<T>(module: Promise<T>, deadline = Date.now() + 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (Date.now() >= deadline) { reject(new Error("启动界面资源加载等待超时。")); return }
    const timer = setTimeout(
      () => reject(new Error("启动界面资源加载等待超时。")),
      Math.max(0, deadline - Date.now())
    )
    void module.then(
      (value) => {
        clearTimeout(timer)
        if (Date.now() >= deadline) reject(new Error("启动界面资源加载等待超时。"))
        else resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** 无React入口保护只报告真实模块加载，不计时推进或补造服务就绪。 */
export function createStartupBootstrap() {
  const surface = document.getElementById("moon-initial-boot")
  if (!surface) throw new Error("启动入口不存在。")
  surface.removeAttribute("style")
  surface.className = "startup-surface"
  const section = surface.querySelector("section")
  section?.removeAttribute("style")
  surface.querySelector("h1")?.removeAttribute("style")
  const stage = document.getElementById("moon-initial-stage")
  stage?.removeAttribute("style")
  const progress = document.createElement("div")
  progress.className = "startup-progress"
  progress.setAttribute("role", "status")
  const spinner = document.createElement("span")
  spinner.className = "startup-spinner"
  spinner.setAttribute("aria-hidden", "true")
  progress.append(spinner)
  if (stage) progress.append(stage)
  section?.insertBefore(
    progress,
    document.getElementById("moon-initial-actions")
  )
  const actions = document.getElementById("moon-initial-actions")
  if (actions) {
    actions.className = "startup-initial-actions"
    actions.querySelector("button")?.classList.add("startup-initial-button")
  }

  return {
    fail() {
      if (!surface.isConnected) return
      spinner.remove()
      progress.className = "startup-failure"
      if (stage) stage.textContent = "启动界面未能加载，请重新加载界面。"
      if (actions) actions.hidden = false
      const copy = document.getElementById("moon-initial-copy") ?? document.createElement("button")
      copy.setAttribute("type", "button")
      copy.className = "startup-initial-button"
      copy.textContent = "复制诊断信息"
      if (copy.id !== "moon-initial-copy") copy.addEventListener("click", () => {
        copy.setAttribute("disabled", "")
        void Promise.resolve()
          .then(() =>
            navigator.clipboard.writeText(
              "Moon 启动诊断\n阶段：加载启动界面\n原因：界面资源未能加载或等待超时。"
            )
          )
          .then(() => {
            copy.textContent = "诊断已复制"
          })
          .catch(() => {
            copy.textContent = "复制失败，再试一次"
          })
          .finally(() => {
            copy.removeAttribute("disabled")
          })
      })
      actions?.insertBefore(copy, actions.querySelector("p"))
      void startupExitAction()
        .then((exit) => {
          if (!exit || !surface.isConnected) return
          const button = document.createElement("button")
          button.type = "button"
          button.className = "startup-initial-button"
          button.textContent = "退出 Moon"
          button.addEventListener("click", () => {
            button.disabled = true
            button.textContent = "正在退出…"
            void exit()
              .catch(() => {
                if (stage)
                  stage.textContent =
                    "未能确认退出。若窗口仍留在托盘，请从托盘菜单退出 Moon 后重新打开。"
              })
              .finally(() => {
                button.disabled = false
                button.textContent = "退出 Moon"
              })
          })
          actions?.insertBefore(button, actions.querySelector("p"))
        })
        .catch(() => {
          /* 无真实退出能力时保留关闭窗口指引。 */
        })
      // 重新加载是真正重新请求入口/chunk，不复用已经reject的lazy Promise。
    },
  }
}
