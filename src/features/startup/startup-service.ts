import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  DesktopCommand,
  DesktopRequests,
  DesktopResults,
  StartupSnapshot,
} from "@/contracts/desktop.generated"

export type StartupCommand = Extract<DesktopCommand, `startup_${string}`>
export type StartupConnectionIssue = { message: string; retryable: boolean }
export type StartupView = {
  snapshot: StartupSnapshot | null
  loaded: boolean
  listening: boolean
  issue: StartupConnectionIssue | null
}
export type StartupService = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => StartupView
  start: () => () => void
  refresh: () => Promise<void>
  call: <K extends StartupCommand>(
    command: K,
    input: DesktopRequests[K]
  ) => Promise<DesktopResults[K]>
}

/** 首启服务不导入业务维护协调器、配置存储或草稿 owner。 */
export function createStartupService(): StartupService {
  let view: StartupView = {
    snapshot: null,
    loaded: !isTauri(),
    listening: false,
    issue: isTauri()
      ? null
      : {
          message: "请在 Moon 桌面窗口中选择导入旧数据或直接启动。",
          retryable: false,
        },
  }
  const listeners = new Set<() => void>()
  let active = false
  let generation = 0
  let stop: UnlistenFn | null = null
  let connection: { generation: number; promise: Promise<boolean> } | null =
    null
  const publish = (next: StartupView) => {
    view = next
    listeners.forEach((listener) => listener())
  }
  const accept = (snapshot: StartupSnapshot | null) => {
    // 命令回包可能晚于进度事件，不能让旧状态重新启用迁移或改写当前操作。
    if (snapshot && view.snapshot && snapshot.revision < view.snapshot.revision)
      return
    if (!snapshot && view.snapshot) return
    publish({ ...view, snapshot, loaded: true, issue: null })
  }
  const report = (message: string) => {
    publish({ ...view, loaded: true, issue: { message, retryable: true } })
  }
  const ensureListening = async () => {
    if (!active) return false
    if (view.listening) return true
    const current = generation
    if (connection?.generation === current) return connection.promise
    const promise = (async () => {
      try {
        const unlisten = await listen<StartupSnapshot>(
          "moon://startup-state",
          ({ payload }) => {
            if (active && generation === current) accept(payload)
          }
        )
        if (!active || generation !== current) {
          unlisten()
          return false
        }
        stop?.()
        stop = unlisten
        publish({ ...view, listening: true })
        return true
      } catch {
        if (active && generation === current)
          report("启动状态订阅未能建立，请重新读取状态后继续。")
        return false
      }
    })()
    connection = { generation: current, promise }
    void promise.finally(() => {
      if (connection?.promise === promise) connection = null
    })
    return promise
  }
  const refresh = async () => {
    if (!isTauri() || !active) return
    const current = generation
    if (!(await ensureListening())) return
    try {
      const snapshot = await invoke<StartupSnapshot | null>("startup_get_state")
      if (active && generation === current) accept(snapshot)
    } catch {
      if (active && generation === current)
        report("启动服务状态未能读取，请重新读取并核对当前操作。")
    }
  }
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh,
    start: () => {
      if (!isTauri()) return () => {}
      active = true
      const current = ++generation
      void refresh()
      return () => {
        if (generation !== current) return
        active = false
        generation += 1
        stop?.()
        stop = null
        connection = null
        view = { ...view, listening: false }
      }
    },
    call: async (command, input) => {
      if (!isTauri() || !active || !view.listening || view.issue)
        throw new Error("启动服务尚未就绪。")
      const current = generation
      try {
        const result = await invoke<DesktopResults[typeof command]>(
          command,
          input === undefined ? {} : { input }
        )
        if (active && generation === current) {
          if (
            command === "startup_prepare_migration" ||
            command === "startup_start_migration" ||
            command === "startup_prepare_fresh" ||
            command === "startup_start_fresh" ||
            command === "startup_retry_migration"
          )
            accept(result as StartupSnapshot)
          else if (command === "startup_choose_directory") await refresh()
        }
        return result
      } catch {
        if (active && generation === current) {
          // 未确认结果只读回原操作；禁止在网络/IPC异常后自动重发迁移。
          await refresh()
          if (!view.snapshot?.issue)
            report("操作结果需要核对，请重新读取状态后继续。")
        }
        throw new Error("启动操作未能确认。")
      }
    },
  }
}
