import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  BootSnapshot,
  DesktopCommand,
  DesktopRequests,
  DesktopResults,
} from "@/contracts/desktop.generated"
import { rpcCall, RpcRequestRejected } from "@/lib/rpc/client"
import { subscribeRemoteReady } from "@/lib/rpc/remote-transport"

type BootCommand = Extract<DesktopCommand, `boot_${string}`>
export type BootView = {
  snapshot: BootSnapshot | null
  browserReady: boolean
  loaded: boolean
  listening: boolean
  issue: string | null
}

/** 桌面权威状态与浏览器真实RPC分开持有，浏览器不伪造desktop/profile快照。 */
export function createBootService() {
  let view: BootView = {
    snapshot: null,
    browserReady: false,
    loaded: false,
    listening: false,
    issue: null,
  }
  const subscribers = new Set<() => void>()
  let active = false
  let generation = 0
  let unlisten: UnlistenFn | null = null
  let connection: Promise<boolean> | null = null
  let controller: AbortController | null = null
  const publish = (next: BootView) => {
    view = next
    subscribers.forEach((listener) => listener())
  }
  const accept = (snapshot: BootSnapshot) => {
    if (view.snapshot && snapshot.revision < view.snapshot.revision) return
    publish({ ...view, snapshot, loaded: true, issue: null })
  }
  const subscribe = async () => {
    if (!active) return false
    if (view.listening) return true
    if (connection) return connection
    const current = generation
    const task = (async () => {
      try {
        const stop = await listen<BootSnapshot>(
          "moon://boot-state",
          ({ payload }) => {
            if (active && generation === current) accept(payload)
          }
        )
        if (!active || generation !== current) {
          stop()
          return false
        }
        unlisten?.()
        unlisten = stop
        publish({ ...view, listening: true })
        return true
      } catch {
        if (active && generation === current)
          publish({
            ...view,
            loaded: true,
            issue: "启动状态连接未能建立，请重新连接后核对。",
          })
        return false
      }
    })()
    connection = task
    void task.finally(() => {
      if (connection === task) connection = null
    })
    return task
  }
  const refresh = async (keepWorkbench = false) => {
    if (!active) return
    const current = generation
    if (isTauri()) {
      if (!(await subscribe())) return
      try {
        const snapshot = await invoke<BootSnapshot>("boot_get_state")
        if (active && generation === current) accept(snapshot)
      } catch {
        if (active && generation === current)
          publish({
            ...view,
            loaded: true,
            issue: "启动状态未能读取，请重新连接并核对。",
          })
      }
      return
    }
    controller?.abort()
    const request = new AbortController()
    controller = request
    const preserveReady = keepWorkbench && view.browserReady
    if (!preserveReady)
      publish({ ...view, browserReady: false, loaded: false, issue: null })
    try {
      const result = await rpcCall("bootStatus", {}, request.signal)
      if (active && generation === current && !request.signal.aborted)
        publish({
          ...view,
          browserReady: preserveReady || result.readable,
          loaded: true,
          issue: result.readable
            ? null
            : "本地服务尚未完成数据恢复，请重试连接。",
        })
    } catch (error) {
      if (active && generation === current && !request.signal.aborted)
        publish({
          ...view,
          loaded: true,
          browserReady: preserveReady,
          issue:
            error instanceof RpcRequestRejected && error.issue
              ? error.issue.summary
              : "未能连接 Moon 本地服务，请启动桌面开发服务后重试连接。",
        })
    }
  }
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    },
    start() {
      active = true
      generation += 1
      const current = generation
      void refresh()
      const stopRecovery = subscribeRemoteReady(() => {
        void refresh(true)
      })
      return () => {
        stopRecovery()
        if (current !== generation) return
        active = false
        generation += 1
        unlisten?.()
        unlisten = null
        connection = null
        controller?.abort()
        controller = null
        view = { ...view, listening: false }
      }
    },
    refresh,
    async call<K extends BootCommand>(
      command: K,
      input: DesktopRequests[K]
    ): Promise<DesktopResults[K]> {
      if (!isTauri() || !active || !view.listening || view.issue)
        throw new Error("启动连接尚未就绪。")
      const current = generation
      try {
        const result = await invoke<DesktopResults[K]>(
          command,
          input === undefined ? {} : { input }
        )
        if (active && generation === current && command !== "boot_exit")
          accept(result as BootSnapshot)
        return result
      } catch {
        // 不明命令结果先读权威状态，不自动重建服务或重复ack。
        if (active && generation === current) {
          await refresh()
          if (!view.snapshot?.issue)
            publish({
              ...view,
              loaded: true,
              issue: "启动操作结果需要核对，请重新连接并读取当前状态。",
            })
        }
        throw new Error("启动操作结果未能确认。")
      }
    },
  }
}
