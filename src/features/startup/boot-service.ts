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
import { loadStartupModule } from "./startup-bootstrap"

const HOST_POLL_INTERVAL_MS = 5_000
const HOST_REQUEST_LIMIT_MS = 8_000

type BootCommand = Extract<DesktopCommand, `boot_${string}`>
export type BootView = {
  snapshot: BootSnapshot | null
  browserReady: boolean
  loaded: boolean
  listening: boolean
  issue: string | null
  /** 领域存储损坏的非阻塞提示（G03 分层启动）：工作台与其余功能正常进入。 */
  degraded: string | null
  /** 浏览器启动等待文案：非失败，等待仍在继续；桌面推送链路不使用。 */
  waiting: string | null
}

/** 桌面权威状态与浏览器真实RPC分开持有，浏览器不伪造desktop/profile快照。 */
export function createBootService() {
  let view: BootView = {
    snapshot: null,
    browserReady: false,
    loaded: false,
    listening: false,
    issue: null,
    degraded: null,
    waiting: null,
  }
  const subscribers = new Set<() => void>()
  let active = false
  let generation = 0
  let unlisten: UnlistenFn | null = null
  let connection: Promise<boolean> | null = null
  // 浏览器启动等待：只读 bootStatus 自动重探（对齐静态页 30s 看门狗）。
  // 等待永不取消；人工"重新连接"只是立即补一次探测，不重置等待窗口。
  const WAIT_INTERVAL_MS = 1_500
  const WAIT_LIMIT_MS = 30_000
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  let waitDeadline = 0
  const clearWait = () => {
    if (waitTimer !== null) {
      clearTimeout(waitTimer)
      waitTimer = null
    }
  }
  let controller: AbortController | null = null
  const publish = (next: BootView) => {
    view = next
    subscribers.forEach((listener) => listener())
  }
  const accept = (snapshot: BootSnapshot) => {
    if (view.snapshot && snapshot.revision < view.snapshot.revision) return
    clearWait()
    publish({ ...view, snapshot, loaded: true, issue: null })
    if (snapshot.phase === "ready" || snapshot.phase === "failed") return
    // 推送偶发遗漏时，从原生权威快照补读；正常推进后停止轮询。
    waitTimer = setTimeout(() => void refresh(), HOST_POLL_INTERVAL_MS)
  }
  const subscribe = async () => {
    if (!active) return false
    if (view.listening) return true
    if (connection) return connection
    const current = generation
    const task = (async () => {
      let expired = false
      const registration = listen<BootSnapshot>(
        "moon://boot-state",
        ({ payload }) => {
          if (!expired && active && generation === current) accept(payload)
        }
      ).then((stop) => {
        if (expired || !active || generation !== current) {
          stop()
          return null
        }
        return stop
      })
      try {
        const stop = await loadStartupModule(
          registration,
          Date.now() + HOST_REQUEST_LIMIT_MS
        )
        if (!stop) return false
        if (!active || generation !== current) {
          stop()
          return false
        }
        unlisten?.()
        unlisten = stop
        publish({ ...view, listening: true })
        return true
      } catch {
        expired = true
        void registration.then(
          (stop) => stop?.(),
          () => {}
        )
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
  const scheduleWait = (
    browserReady: boolean,
    waiting: string,
    failed: string
  ) => {
    if (waitDeadline === 0) waitDeadline = Date.now() + WAIT_LIMIT_MS
    if (Date.now() >= waitDeadline) {
      waitDeadline = 0
      publish({
        ...view,
        loaded: true,
        browserReady,
        waiting: null,
        issue: failed,
      })
      return
    }
    publish({ ...view, loaded: true, browserReady, issue: null, waiting })
    waitTimer = setTimeout(() => {
      waitTimer = null
      if (active) void refresh()
    }, WAIT_INTERVAL_MS)
  }
  const refresh = async (keepWorkbench = false) => {
    if (!active) return
    const current = generation
    clearWait()
    if (isTauri()) {
      if (!(await subscribe())) return
      try {
        const snapshot = await loadStartupModule(
          invoke<BootSnapshot>("boot_get_state"),
          Date.now() + HOST_REQUEST_LIMIT_MS
        )
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
      publish({
        ...view,
        browserReady: false,
        loaded: false,
        issue: null,
        // 重探期间保留等待文案，阶段详情不逐次闪烁。
        waiting: view.waiting,
      })
    try {
      const result = await rpcCall("bootStatus", {}, request.signal)
      if (active && generation === current && !request.signal.aborted) {
        if (result.readable) {
          waitDeadline = 0
          // G03 分层启动：单域损坏显式提示但不阻塞进入；受损域操作由其自身明确报错
          const broken = (result.domains ?? [])
            .filter((domain) => !domain.ok)
            .map((domain) => domain.name)
          publish({
            ...view,
            browserReady: true,
            loaded: true,
            issue: null,
            waiting: null,
            degraded: broken.length
              ? `以下本地数据存储损坏，相关功能暂不可用，其余功能正常：${broken.join("、")}`
              : null,
          })
        } else if (preserveReady) {
          publish({
            ...view,
            browserReady: true,
            loaded: true,
            waiting: null,
            issue: "本地服务尚未完成数据恢复，请重试连接。",
          })
        } else {
          scheduleWait(
            false,
            "本地服务尚未完成数据恢复，正在自动重试。",
            "本地服务尚未完成数据恢复，请重试连接。（已自动重试 30 秒，仍未就绪。）"
          )
        }
      }
    } catch (error) {
      if (active && generation === current && !request.signal.aborted) {
        // 仅"服务尚未启动"属等待范畴；其余拒绝是需要人处理的真失败。
        if (error instanceof RpcRequestRejected) {
          if (error.issue?.code === "host_unavailable" && !preserveReady) {
            scheduleWait(
              false,
              "正在等待 moon 本地服务就绪，自动重试中。",
              "moon 服务尚未就绪，请启动或重新启动桌面应用。（已自动重试 30 秒，仍未就绪。）"
            )
            return
          }
          publish({
            ...view,
            loaded: true,
            browserReady: preserveReady,
            waiting: null,
            issue: error.issue?.summary ?? error.message,
          })
          return
        }
        if (preserveReady) {
          publish({
            ...view,
            loaded: true,
            browserReady: true,
            waiting: null,
            issue: "未能连接 moon 本地服务，请重试连接。",
          })
          return
        }
        scheduleWait(
          false,
          "正在等待 moon 本地服务就绪，自动重试中。",
          "未能连接 moon 本地服务，请启动桌面开发服务后重试连接。（已自动重试 30 秒，仍未就绪。）"
        )
      }
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
        clearWait()
        waitDeadline = 0
        unlisten?.()
        unlisten = null
        connection = null
        controller?.abort()
        controller = null
        view = { ...view, listening: false, waiting: null }
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
