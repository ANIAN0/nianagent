import { saveConfigurationDrafts } from "@/lib/operations/configuration-draft-store"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  DesktopCommand,
  DesktopIssue,
  DesktopRequests,
  DesktopResults,
  DesktopSnapshot,
  FlushRequest,
} from "@/contracts/desktop.generated"
import {
  saveForMaintenance,
  setMaintenanceFrozen,
} from "@/lib/maintenance/maintenance-coordinator"

export class DesktopCommandError extends Error {
  readonly issue: DesktopIssue
  constructor(issue: DesktopIssue) {
    super(issue.message)
    this.issue = issue
  }
}
export const unavailableDesktopIssue: DesktopIssue = {
  code: "unavailable",
  recovery: "none",
  activities: [],
  message:
    "当前为浏览器开发环境。请在 Moon 桌面开发窗口中查看数据目录、迁移数据及检查更新。",
}
function commandIssue(error: unknown): DesktopIssue {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    "recovery" in error &&
    "activities" in error
  )
    return error as DesktopIssue
  return {
    code: "unknown",
    recovery: "retry",
    activities: [],
    message: "未能确认桌面操作结果，请重新读取状态后核对。不会自动重发原操作。",
  }
}
export async function desktopCall<K extends DesktopCommand>(
  command: K,
  input: DesktopRequests[K]
): Promise<DesktopResults[K]> {
  if (!isTauri()) throw new DesktopCommandError(unavailableDesktopIssue)
  try {
    return await invoke<DesktopResults[K]>(
      command,
      input === undefined ? {} : { input }
    )
  } catch (error) {
    throw new DesktopCommandError(commandIssue(error))
  }
}
export type DesktopView = {
  snapshot: DesktopSnapshot | null
  issue: DesktopIssue | null
  listening: boolean
}
export type DesktopService = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => DesktopView
  start: () => () => void
  refresh: () => Promise<void>
  call: typeof desktopCall
}
export function createDesktopService(): DesktopService {
  let view: DesktopView = {
    snapshot: null,
    issue: isTauri() ? null : unavailableDesktopIssue,
    listening: false,
  }
  const subscribers = new Set<() => void>()
  const publish = (next: DesktopView) => {
    view = next
    setMaintenanceFrozen(next.snapshot?.maintenance.writesFrozen ?? false)
    for (const subscriber of subscribers) subscriber()
  }
  const accept = (snapshot: DesktopSnapshot) => {
    if (view.snapshot && snapshot.revision < view.snapshot.revision) return
    publish({ ...view, snapshot, issue: null })
  }
  const refresh = async () => {
    try {
      accept(await desktopCall("desktop_get_state", undefined))
    } catch (error) {
      publish({
        ...view,
        issue: commandIssue(
          error instanceof DesktopCommandError ? error.issue : error
        ),
      })
    }
  }
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      subscribers.add(listener)
      return () => {
        subscribers.delete(listener)
      }
    },
    refresh,
    call: async (command, input) => {
      const result = await desktopCall(command, input)
      await refresh()
      return result
    },
    start: () => {
      if (!isTauri()) return () => {}
      let disposed = false
      const stops: UnlistenFn[] = []
      void (async () => {
        try {
          // 先订阅再读取，避免首次状态和维护事件之间出现空窗。
          stops.push(
            await listen<DesktopSnapshot>(
              "moon://desktop-state",
              ({ payload }) => {
                if (!disposed) accept(payload)
              }
            )
          )
          stops.push(
            await listen<FlushRequest>(
              "moon://maintenance-flush",
              ({ payload }) => {
                if (disposed) return
                setMaintenanceFrozen(true)
                void (async () => {
                  const blockers = await saveForMaintenance()
                  try {
                    saveConfigurationDrafts()
                  } catch {
                    blockers.push({
                      id: "configuration-recovery",
                      kind: "frontend",
                      label: "设置恢复副本尚未保存，请先处理本机存储问题。",
                      sessionId: null,
                      stoppable: false,
                    })
                  }
                  if (disposed) return
                  await desktopCall("desktop_acknowledge_flush", {
                    operationId: payload.operationId,
                    nonce: payload.nonce,
                    saved: blockers.length === 0,
                    blockers,
                  })
                })().catch(() => {
                  void refresh()
                })
              }
            )
          )
          if (disposed) {
            stops.forEach((stop) => stop())
            return
          }
          publish({ ...view, listening: true })
          await refresh()
        } catch (error) {
          if (!disposed) publish({ ...view, issue: commandIssue(error) })
        }
      })()
      return () => {
        disposed = true
        stops.forEach((stop) => stop())
      }
    },
  }
}
const DesktopContext = createContext<DesktopService | null>(null)
export const DesktopServiceProvider = DesktopContext.Provider
export function useDesktopService() {
  const service = useContext(DesktopContext)
  if (!service) throw new Error("桌面状态服务未装配。")
  return service
}
export function useDesktopView() {
  const service = useDesktopService()
  return useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot
  )
}
export function useDesktopLifecycle() {
  const [service] = useState(createDesktopService)
  useEffect(() => service.start(), [service])
  return service
}
