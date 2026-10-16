import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createStartupService } from "./startup-service"
import {
  StartupMigrationView,
  type StartupAction,
} from "./startup-migration-view"

/** 首次可选导入/新建数据集；业务App由原生在提交后的正确profile中重新启动。 */
export default function StartupMigrationApp() {
  const [service] = useState(createStartupService)
  const view = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot
  )
  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  const [invalidatedPlanId, setInvalidatedPlanId] = useState<string | null>(
    null
  )
  const [expiredPlanId, setExpiredPlanId] = useState<string | null>(null)
  const [pending, setPending] = useState<StartupAction | null>(null)
  const actionInFlight = useRef(false)
  const lifetime = useRef(0)
  const continued = useRef(new Set<string>())
  useEffect(() => service.start(), [service])
  useEffect(() => {
    lifetime.current += 1
    return () => {
      lifetime.current += 1
    }
  }, [])
  const snapshot = view.snapshot
  const target = targetOverride ?? snapshot?.targetDirectory ?? ""
  const expired = !!snapshot?.planId && expiredPlanId === snapshot.planId
  const planValid =
    snapshot?.phase === "ready" &&
    !!snapshot.planId &&
    !!snapshot.planExpiresAt &&
    Number.isFinite(Date.parse(snapshot.planExpiresAt)) &&
    snapshot.planId !== invalidatedPlanId &&
    target === snapshot.targetDirectory &&
    !expired

  useEffect(() => {
    if (
      snapshot?.phase !== "ready" ||
      !snapshot.planId ||
      !snapshot.planExpiresAt
    )
      return
    const deadline = Date.parse(snapshot.planExpiresAt)
    if (!Number.isFinite(deadline)) return
    const planId = snapshot.planId
    const timer = setTimeout(
      () => setExpiredPlanId(planId),
      Math.max(0, deadline - Date.now()) + 1
    )
    return () => clearTimeout(timer)
  }, [snapshot?.phase, snapshot?.planId, snapshot?.planExpiresAt])

  const run = useCallback(
    async (action: StartupAction, operation: () => Promise<void>) => {
      if (actionInFlight.current) return
      actionInFlight.current = true
      const current = lifetime.current
      setPending(action)
      try {
        await operation()
      } catch {
        // 受控原生失败留在 snapshot；IPC未知由服务读回并提供状态核对入口。
      } finally {
        actionInFlight.current = false
        if (lifetime.current === current) setPending(null)
      }
    },
    []
  )
  const continueStartup = useCallback(async () => {
    const state = service.getSnapshot().snapshot
    if (!state?.capabilities.continueStartup || !state.operationId) return
    await service.call("startup_continue", { operationId: state.operationId })
  }, [service])
  useEffect(() => {
    if (
      snapshot?.phase !== "readyToOpen" ||
      !snapshot.operationId ||
      !snapshot.capabilities.continueStartup ||
      snapshot.issue ||
      !view.listening ||
      view.issue ||
      actionInFlight.current ||
      continued.current.has(snapshot.operationId)
    )
      return
    const operationId = snapshot.operationId
    // StrictMode、重复事件和重读不能重复交接同一操作；失败保留明确的手动入口。
    continued.current.add(operationId)
    void run("continue", continueStartup)
  }, [snapshot, view.listening, view.issue, run, continueStartup, pending])

  return (
    <StartupMigrationView
      view={view}
      target={target}
      planValid={planValid}
      expired={expired}
      pending={pending}
      onTargetChange={(value) => {
        setTargetOverride(value)
        setInvalidatedPlanId(snapshot?.planId ?? null)
      }}
      onAction={(action) => {
        const current = lifetime.current
        void run(action, async () => {
          if (action === "refresh") await service.refresh()
          else if (action === "choose") {
            const chosen = await service.call(
              "startup_choose_directory",
              undefined
            )
            if (chosen !== null && lifetime.current === current) {
              setTargetOverride(chosen)
              setInvalidatedPlanId(snapshot?.planId ?? null)
            }
          } else if (action === "prepare") {
            const result = await service.call("startup_prepare_migration", {
              targetDirectory: target.trim(),
            })
            if (lifetime.current === current)
              setTargetOverride(result.targetDirectory)
          } else if (action === "fresh") {
            const state = service.getSnapshot().snapshot
            const prepared =
              state?.selection === "fresh" && planValid
                ? state
                : await service.call("startup_prepare_fresh", {
                    targetDirectory: target.trim(),
                  })
            if (lifetime.current !== current) return
            setTargetOverride(prepared.targetDirectory)
            // 此明确点击就是“不导入”的确认；合法空目标下串行预检与初始化，不再二次确认。
            if (
              prepared.selection === "fresh" &&
              prepared.phase === "ready" &&
              prepared.planId &&
              prepared.capabilities.createFresh
            )
              await service.call("startup_start_fresh", {
                planId: prepared.planId,
                targetDirectory: prepared.targetDirectory,
              })
          } else if (
            action === "start" &&
            planValid &&
            snapshot?.planId &&
            snapshot.selection === "import"
          ) {
            await service.call("startup_start_migration", {
              planId: snapshot.planId,
              targetDirectory: target,
            })
          } else if (action === "retry" && snapshot?.operationId) {
            await service.call("startup_retry_migration", {
              operationId: snapshot.operationId,
            })
          } else if (action === "continue") await continueStartup()
          else if (action === "diagnostics")
            await service.call("startup_open_diagnostics", undefined)
          else if (action === "exit")
            await service.call("startup_exit", undefined)
        })
      }}
    />
  )
}
