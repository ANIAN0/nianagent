import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StartupDetailsDialog } from "./breathing/startup-details-dialog"
import { bootElapsed } from "./boot-epoch"
import "./startup-surface.css"
import "./breathing/startup-breathing.css"

export type StartupStep = {
  id: string
  label: string
  status: "complete" | "active" | "pending" | "failed"
  detail?: string
}

/** 详情外观可替换；披露状态、退出与诊断复制仍由启动页统一管理。 */
export type StartupDetailsViewProps = {
  status: "starting" | "failed"
  steps: StartupStep[]
  pending: "retry" | "exit" | null
  open: boolean
  onOpenChange: (open: boolean) => void
  retryAction: ReactNode
  exitAction: ReactNode
  copyAction: ReactNode
}

export type StartupSurfaceProps = {
  status: "starting" | "failed"
  steps: StartupStep[]
  message?: string | null
  failureTitle?: string
  /** 仅允许受控阶段、版本与安全原因，调用方不得传原始异常、配置或凭据。 */
  diagnostics?: string
  pending?: "retry" | "exit" | null
  retryLabel?: string
  exitInstruction?: string | null
  onRetry?: () => void
  onExit?: () => void
}

/** 阶段提示出现延迟：快启动保持纯呼吸点，慢启动才开口交代。 */
const STAGE_REVEAL_DELAY = 1500

/** 启动页只投影真实状态；页面本身不推进阶段，也不决定宿主已就绪。 */
export function StartupSurface({
  status,
  steps,
  message,
  failureTitle,
  diagnostics = "",
  pending = null,
  retryLabel = "重试",
  exitInstruction,
  onRetry,
  onExit,
}: StartupSurfaceProps) {
  const [details, setDetails] = useState(false)
  const [phaseOffset] = useState(() => `${(-bootElapsed()).toFixed(0)}ms`)
  // 阶段披露跟随页面原点：实例交接沿用已过的等待，不重置延迟。
  const [showStage, setShowStage] = useState(
    () => bootElapsed() >= STAGE_REVEAL_DELAY
  )
  const [copyState, setCopyState] = useState<{
    diagnostics: string
    status: "copying" | "copied" | "failed"
  } | null>(null)
  const copying = useRef(false)
  const lifetime = useRef(0)
  useEffect(() => {
    if (showStage) return
    const timer = window.setTimeout(
      () => setShowStage(true),
      Math.max(0, STAGE_REVEAL_DELAY - bootElapsed())
    )
    return () => window.clearTimeout(timer)
  }, [showStage])
  useEffect(() => {
    lifetime.current += 1
    return () => {
      lifetime.current += 1
    }
  }, [])
  const failed = steps.find((step) => step.status === "failed")
  const active = steps.find((step) => step.status === "active")
  const title =
    status === "failed"
      ? (failureTitle ?? `${failed?.label ?? "启动"}失败`)
      : (active?.label ?? "正在启动 moon")
  const currentIndex = steps.findIndex(
    (step) => step.status === "active" || step.status === "failed"
  )
  const copied =
    copyState?.diagnostics === diagnostics ? copyState.status : null
  const failureMessage =
    message ?? failed?.detail ?? "未能完成启动，请按当前提示处理。"

  const copyDiagnostics = () => {
    if (copying.current || !diagnostics) return
    copying.current = true
    const current = lifetime.current
    const text = diagnostics
    setCopyState({ diagnostics: text, status: "copying" })
    // 复制反馈只属于点击时的安全诊断；阶段变化后不能显示旧复制成功。
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(() => {
        if (lifetime.current === current)
          setCopyState({ diagnostics: text, status: "copied" })
      })
      .catch(() => {
        if (lifetime.current === current)
          setCopyState({ diagnostics: text, status: "failed" })
      })
      .finally(() => {
        copying.current = false
      })
  }

  /* 恢复由宿主决定，阶段与诊断按需披露。 */
  const disclosureAvailable =
    (steps.length > 1 || !!diagnostics) && (status === "failed" || showStage)
  const exitAction = onExit ? (
    <Button
      size="sm"
      variant={onRetry ? "outline" : "default"}
      type="button"
      disabled={pending !== null}
      onClick={onExit}
    >
      {pending === "exit" && (
        <Loader2
          data-icon="inline-start"
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      退出 moon
    </Button>
  ) : null
  const copyAction = diagnostics ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={copied === "copying" || pending === "exit"}
      onClick={copyDiagnostics}
      aria-live="polite"
    >
      {copied === "copying"
        ? "正在复制…"
        : copied === "copied"
          ? "诊断已复制"
          : copied === "failed"
            ? "复制失败，再试一次"
            : "复制诊断信息"}
    </Button>
  ) : null

  const failureInDialog = status === "failed" && disclosureAvailable
  const retryAction =
    status === "failed" && onRetry ? (
      <Button
        size="sm"
        disabled={pending !== null}
        data-pending={pending === "retry" ? "retry" : undefined}
        onClick={onRetry}
      >
        {/* 加载指示与原标签并存，不吞掉按钮文字。 */}
        {pending === "retry" && (
          <RefreshCw
            data-icon="inline-start"
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {retryLabel}
      </Button>
    ) : null

  return (
    <main
      className="startup-surface"
      data-status={status}
      data-pending={pending ?? undefined}
      aria-labelledby="startup-title"
    >
      <div
        className="startup-moon"
        aria-hidden="true"
        style={{ "--boot-phase": phaseOffset } as CSSProperties}
      >
        <span className="startup-moon-light" />
      </div>
      <h1 id="startup-title">moon</h1>
      {status === "starting" ? (
        <div className="startup-wait" role="status">
          {showStage && <p className="startup-stage">{title}</p>}
          {showStage && currentIndex >= 0 && (
            <span className="sr-only">
              第 {currentIndex + 1} 步，共 {steps.length} 步
            </span>
          )}
        </div>
      ) : (
        <div className="startup-failure" role="status">
          <h2>{pending === "retry" ? "正在重试…" : title}</h2>
          {!failureInDialog && <p>{failureMessage}</p>}
        </div>
      )}
      {disclosureAvailable ? (
        <StartupDetailsDialog
          status={status}
          steps={steps}
          pending={pending}
          open={failureInDialog || details}
          onOpenChange={setDetails}
          retryAction={retryAction}
          exitAction={exitAction}
          copyAction={copyAction}
        />
      ) : status === "failed" && (exitAction || retryAction) ? (
        <div className="startup-actions">
          {exitAction}
          {retryAction}
        </div>
      ) : null}
      {status === "failed" && exitInstruction && (
        <p className="startup-exit-instruction" role="status">
          {exitInstruction}
        </p>
      )}
    </main>
  )
}
