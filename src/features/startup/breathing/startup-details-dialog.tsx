import { useRef } from "react"
import { Check, CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { StartupDetailsViewProps } from "../startup-surface"
import "./startup-details-dialog.css"

const stepStatus = {
  complete: "已完成",
  active: "进行中",
  pending: "尚未执行",
  failed: "失败",
}

export function StartupDetailsDialog({
  status,
  steps,
  pending,
  open,
  onOpenChange,
  retryAction,
  exitAction,
  copyAction,
}: StartupDetailsViewProps) {
  const retrying = pending === "retry"
  const locked = status === "failed"
  const failedStep = steps.find((step) => step.status === "failed")
  const decisionRef = useRef<HTMLDivElement>(null)
  // 决定组只属于异常弹窗：启动详情不携带退出与重试。
  const decisionVisible = locked && !!(exitAction || retryAction)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // 异常弹窗没有关闭出口：重试与退出都在弹窗内，关闭只属于启动详情。
        if (locked && !next) return
        onOpenChange(next)
      }}
    >
      {locked ? null : (
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" className="startup-details-trigger">
            查看详情
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        variant="reader"
        className={
          locked
            ? "startup-details-dialog startup-details-locked max-w-[440px]"
            : "startup-details-dialog max-w-[440px]"
        }
        showCloseButton={!locked}
        onEscapeKeyDown={locked ? (event) => event.preventDefault() : undefined}
        onPointerDownOutside={
          locked ? (event) => event.preventDefault() : undefined
        }
        onInteractOutside={
          locked ? (event) => event.preventDefault() : undefined
        }
        onOpenAutoFocus={
          locked
            ? (event) => {
                // 失败时刻只有一个决定：初始焦点落在动作区最右的主动作上。
                const actions =
                  decisionRef.current?.querySelectorAll<HTMLButtonElement>(
                    "button"
                  )
                const primary = actions?.[actions.length - 1]
                if (!primary) return
                event.preventDefault()
                primary.focus()
              }
            : undefined
        }
      >
        <DialogHeader>
          <DialogTitle>{locked ? "启动异常" : "启动详情"}</DialogTitle>
          <DialogDescription
            className={
              retrying || (locked && failedStep?.detail) ? undefined : "sr-only"
            }
            role={retrying ? "status" : undefined}
          >
            {retrying
              ? "正在重试…"
              : locked && failedStep
                ? `${failedStep.label}失败：${failedStep.detail ?? "原因待核对。"}`
                : "moon 的启动阶段与当前状态"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody
          className="px-4 pb-4"
          tabIndex={0}
          role="region"
          aria-label="启动阶段"
        >
          <ol className="startup-dialog-steps">
            {steps.map((step) => (
              <li
                key={step.id}
                data-status={step.status}
                aria-current={step.status === "active" ? "step" : undefined}
              >
                <span className="startup-dialog-marker" aria-hidden="true">
                  {step.status === "complete" ? (
                    <Check />
                  ) : step.status === "failed" ? (
                    <CircleAlert />
                  ) : (
                    <span />
                  )}
                </span>
                <div className="startup-dialog-step">
                  <div className="startup-dialog-step-heading">
                    <strong>{step.label}</strong>
                    {(step.status === "active" || step.status === "failed") && (
                      <span
                        className="startup-dialog-step-status"
                        aria-hidden="true"
                      >
                        {retrying && step.status === "failed"
                          ? "上次失败"
                          : stepStatus[step.status]}
                      </span>
                    )}
                  </div>
                  {/* 失败原因已在摘要中，列表不重复；启动详情保留全部阶段说明。 */}
                  {step.detail && !(locked && step.status === "failed") && (
                    <p>{step.detail}</p>
                  )}
                  <span className="sr-only">
                    {retrying && step.status === "failed"
                      ? "上次失败"
                      : stepStatus[step.status]}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </DialogBody>
        {/* 一个弹窗只有一处动作：诊断复制靠左随行，退出与重试组成右侧决定组。 */}
        {(copyAction || decisionVisible) && (
          <div
            className={
              decisionVisible
                ? "startup-dialog-footer"
                : "startup-dialog-footer startup-dialog-footer-solo"
            }
          >
            {copyAction}
            {decisionVisible && (
              <div ref={decisionRef} className="startup-dialog-decision">
                {exitAction}
                {retryAction}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
