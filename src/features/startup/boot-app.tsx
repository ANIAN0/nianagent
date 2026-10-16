import { isTauri } from "@tauri-apps/api/core"
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react"
import type { BootStage } from "@/contracts/desktop.generated"
import { ThemeProvider } from "@/components/theme-provider"
import { recoverStartupProfile } from "@/features/settings/startup-recovery"
import { createBootService } from "./boot-service"
import { StartupSurface, type StartupStep } from "./startup-surface"
import { loadStartupModule } from "./startup-bootstrap"

const stages: Exclude<BootStage, "ready">[] = [
  "profile",
  "backend",
  "storage",
  "frontendProfile",
  "workbench",
]
const labels: Record<BootStage, string> = {
  profile: "核对数据目录",
  backend: "连接本地服务",
  storage: "读取本机数据",
  frontendProfile: "恢复本机草稿",
  workbench: "加载工作台",
  ready: "启动完成",
}
type LocalFailure = { message: string; stage: "frontendProfile" | "workbench" }

/** 先真实服务、当前profile与模块，最后权威ack；ready前不挂任何业务owner。 */
export default function BootApp() {
  const [service] = useState(createBootService)
  const view = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot
  )
  const [Workbench, setWorkbench] = useState<ComponentType | null>(null)
  const loadedIdentity = useRef<string | null>(null)
  const [loadedPageIdentity, setLoadedPageIdentity] = useState<string | null>(
    null
  )
  const [frontendStage, setFrontendStage] = useState<
    "frontendProfile" | "workbench"
  >("frontendProfile")
  const [failure, setFailure] = useState<LocalFailure | null>(null)
  const [pending, setPending] = useState<"retry" | "exit" | null>(null)
  const [exitInstruction, setExitInstruction] = useState<string | null>(null)
  const inFlight = useRef(false)
  const lifetime = useRef(0)
  useEffect(() => {
    lifetime.current += 1
    const stop = service.start()
    return () => {
      lifetime.current += 1
      stop()
    }
  }, [service])
  const snapshot = view.snapshot
  const desktop = isTauri()
  const attemptId = snapshot?.attemptId
  const phase = snapshot?.phase
  const stage = snapshot?.stage
  const storage = snapshot?.storage
  const dataSetId = storage?.dataSetId
  const generation = storage?.generation
  const pageIdentity =
    attemptId && dataSetId && generation !== undefined
      ? `${attemptId}:${dataSetId}:${generation}`
      : null

  useEffect(() => {
    if (
      !desktop ||
      !attemptId ||
      (phase !== "waitingFrontend" && phase !== "ready") ||
      failure ||
      view.issue ||
      !view.listening
    )
      return
    const alreadyReady = phase === "ready"
    if (!alreadyReady && stage !== "frontendProfile" && stage !== "workbench")
      return
    if (alreadyReady && loadedIdentity.current === pageIdentity) return
    // 同一阶段的事件可重建storage对象；身份未变时不取消正在读取的真实模块。
    const current = service.getSnapshot().snapshot
    const currentStorage = current?.storage
    if (
      current?.attemptId !== attemptId ||
      !currentStorage ||
      currentStorage.dataSetId !== dataSetId ||
      currentStorage.generation !== generation
    )
      return
    let disposed = false
    void (async () => {
      let currentStage: "frontendProfile" | "workbench" =
        alreadyReady || stage === "frontendProfile"
          ? "frontendProfile"
          : "workbench"
      let ready = false
      try {
        if (currentStage === "frontendProfile") {
          setFrontendStage("frontendProfile")
          recoverStartupProfile(currentStorage)
        }
        if (alreadyReady || currentStage === "workbench") {
          currentStage = "workbench"
          setFrontendStage("workbench")
          const module = await loadStartupModule(import("../../app-entry"))
          if (disposed) return
          loadedIdentity.current = pageIdentity
          setLoadedPageIdentity(pageIdentity)
          setWorkbench(() => module.default)
        }
        ready = true
      } catch {
        if (!disposed)
          setFailure({
            stage: currentStage,
            message:
              currentStage === "workbench"
                ? "工作台界面未能加载，已保存的数据保留，请重新加载界面。"
                : "本机草稿或配置恢复副本未能读取或保存，原数据和请求身份保留。",
          })
      }
      if (disposed) return
      // 已Ready宿主的刷新只恢复当前页面；失败负ack沿原生前端恢复出口，不重启Node。
      if (alreadyReady && ready) return
      // 不直接调用旧desktop_acknowledge_startup；两个阶段都成功才由原生统一确认。
      await service.call("boot_acknowledge_frontend", {
        attemptId,
        dataSetId: currentStorage.dataSetId,
        generation: currentStorage.generation,
        stage: currentStage === "frontendProfile" ? "profile" : "workbench",
        ready,
      })
    })().catch(() => {
      /* service先读回真实状态，未知不会自动重复启动。 */
    })
    return () => {
      disposed = true
    }
  }, [
    desktop,
    service,
    attemptId,
    phase,
    stage,
    dataSetId,
    generation,
    pageIdentity,
    view.issue,
    view.listening,
    failure,
  ])

  useEffect(() => {
    if (desktop || !view.browserReady || Workbench || failure) return
    let disposed = false
    void loadStartupModule(import("../../app-entry"))
      .then((module) => {
        if (!disposed) setWorkbench(() => module.default)
      })
      .catch(() => {
        if (!disposed)
          setFailure({
            stage: "workbench",
            message: "工作台界面未能加载，请重新加载界面。已保存的数据保留。",
          })
      })
    return () => {
      disposed = true
    }
  }, [desktop, view.browserReady, Workbench, failure])

  const ready = desktop ? snapshot?.phase === "ready" : view.browserReady
  const issue = snapshot?.issue
  const message = view.issue ?? issue?.message ?? failure?.message ?? null
  const failed = !!message || snapshot?.phase === "failed"
  let steps: StartupStep[]
  if (desktop && snapshot) {
    const stage =
      issue?.stage ??
      failure?.stage ??
      (snapshot.phase === "ready" && loadedPageIdentity !== pageIdentity
        ? frontendStage
        : snapshot.stage)
    const current = stage === "ready" ? stages.length : stages.indexOf(stage)
    steps = stages.map((id, index) => ({
      id,
      label: labels[id],
      status:
        index < current
          ? "complete"
          : index === current
            ? failed
              ? "failed"
              : "active"
            : "pending",
      ...(index === current && message ? { detail: message } : {}),
    }))
  } else if (desktop)
    steps = [
      {
        id: "connection",
        label: "读取启动状态",
        status: failed ? "failed" : "active",
        ...(message ? { detail: message } : {}),
      },
    ]
  else
    steps = [
      {
        id: "service",
        label: "连接本地服务并读取数据",
        status: view.browserReady ? "complete" : failed ? "failed" : "active",
        ...(!view.browserReady && message ? { detail: message } : {}),
      },
      {
        id: "workbench",
        label: "加载工作台",
        status:
          failure?.stage === "workbench"
            ? "failed"
            : view.browserReady
              ? "active"
              : "pending",
        ...(failure ? { detail: failure.message } : {}),
      },
    ]
  const reloadModule =
    failure?.stage === "workbench" || issue?.stage === "workbench"
  const diagnostics =
    issue?.diagnostics ??
    (failed
      ? `Moon 启动诊断\n环境：${desktop ? "桌面" : "浏览器开发"}\n阶段：${steps.find((step) => step.status === "failed")?.label ?? "读取启动状态"}\n原因：${message ?? "启动结果待核对。"}`
      : "")
  const canRetry =
    failed && (view.issue !== null || !desktop || snapshot?.capabilities.retry)
  const run = async (action: "retry" | "exit") => {
    if (inFlight.current) return
    inFlight.current = true
    const current = lifetime.current
    setPending(action)
    try {
      if (action === "exit") {
        if (desktop && snapshot?.capabilities.exit)
          await service.call("boot_exit", { attemptId: snapshot.attemptId })
        else {
          // 浏览器无权结束桌面服务；关闭不被允许时留真实指引，不能伪装已退出。
          window.close()
          setExitInstruction("请关闭此页面。浏览器页面不会结束 Moon 桌面服务。")
        }
      } else if (view.issue && desktop) await service.refresh()
      else if (desktop && snapshot?.capabilities.retry) {
        await service.call("boot_retry", { attemptId: snapshot.attemptId })
        if (reloadModule) window.location.reload()
        else if (lifetime.current === current) setFailure(null)
      } else if (!desktop) {
        if (reloadModule) window.location.reload()
        else {
          setFailure(null)
          await service.refresh()
        }
      }
    } catch {
      /* 受控结果保留在service，退出失败亦需核对真实状态。 */
    } finally {
      inFlight.current = false
      if (lifetime.current === current) setPending(null)
    }
  }
  const content =
    ready &&
    Workbench &&
    (!failed || (!desktop && view.browserReady && !failure)) &&
    (!desktop || (view.listening && loadedPageIdentity === pageIdentity)) ? (
      <>
        {!desktop && view.issue && (
          <p role="status" className="border-b p-2 text-sm">
            {view.issue}
          </p>
        )}
        <Workbench />
      </>
    ) : (
      <StartupSurface
        status={failed ? "failed" : "starting"}
        steps={steps}
        message={message}
        failureTitle={
          issue?.message.startsWith("数据已迁移")
            ? "数据已迁移，启动需要处理"
            : undefined
        }
        diagnostics={diagnostics}
        pending={pending}
        retryLabel={
          reloadModule ? "重新加载界面" : view.issue ? "重新连接" : "重试"
        }
        onRetry={
          canRetry
            ? () => {
                void run("retry")
              }
            : undefined
        }
        onExit={
          failed && (!desktop || snapshot?.capabilities.exit)
            ? () => {
                void run("exit")
              }
            : undefined
        }
        exitInstruction={exitInstruction}
      />
    )
  // 原生COM/profile核验前不读写localStorage；验证后首次挂载唯一持久主题Provider。
  const profileProven =
    !!storage &&
    (phase === "waitingFrontend" ||
      phase === "ready" ||
      (phase === "failed" &&
        (stage === "frontendProfile" || stage === "workbench")))
  const persistentTheme = !desktop || profileProven
  return (
    <ThemeProvider
      key={
        persistentTheme
          ? `profile:${dataSetId ?? "browser"}:${generation ?? 0}`
          : "unverified"
      }
      storageKey={persistentTheme ? "theme" : null}
    >
      {content}
    </ThemeProvider>
  )
}
