import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { MarkerIcon } from "@/components/ui/marker"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { ConversationApproval } from "@/contracts/rpc.generated"
import { useApprovalReply } from "@/lib/operations/use-approval-reply"
import "./approval-card.css"

const approvalSources = {
  builtin: "Pi 内置工具",
  plugin: "moon 插件",
  extension: "Pi 扩展",
  unknown: "来源未确认",
}
export function ApprovalCard({
  request,
  sessionId,
  epoch,
  onReply,
  onReload,
  readPending,
  disabledReason,
}: {
  request: ConversationApproval
  sessionId: string
  epoch: string
  onReply: (value: string) => Promise<unknown>
  onReload?: () => void
  readPending?: boolean
  disabledReason?: string
}) {
  const key = JSON.stringify([sessionId, epoch, request.runId, request.id])
  const deadline = Date.parse(request.expiresAt)
  const decision = useApprovalReply(key, deadline, onReply)
  const [value, setValue] = useState(decision.answer ?? "")
  const [expired, setExpired] = useState(() => Date.now() >= deadline)
  const composing = useRef(false)
  const compositionEnded = useRef(false)
  useEffect(() => {
    const remaining = deadline - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) return
    const timer = setTimeout(
      () => setExpired(true),
      Math.min(remaining, 2147483647)
    )
    return () => clearTimeout(timer)
  }, [deadline])
  const busy = decision.phase === "sending"
  const submitted = decision.phase === "submitted"
  const unknown = decision.phase === "uncertain"
  const blocked = decision.phase !== "idle" || expired || !!disabledReason
  const isDecision = request.kind === "tool" || request.kind === "confirm"
  const Form = isDecision ? "form" : Questionnaire
  const Actions = isDecision ? "div" : QuestionnaireActions
  const details = request.details
  const target = details?.target
  const cancel = isDecision ? "deny" : "cancel"
  const answer = (value: string) => {
    if (!blocked) void decision.reply(value)
  }
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as Element
    if (
      event.defaultPrevented ||
      !event.currentTarget.contains(document.activeElement) ||
      target.closest(
        "input, textarea, select, [contenteditable='true'], [contenteditable='']"
      )
    )
      return
    if (event.key !== "Escape" && !(event.key === "Enter" && isDecision)) return
    if (
      event.key === "Enter" &&
      target.closest("button, a[href], summary, [role='button']")
    )
      return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    if (
      event.repeat ||
      composing.current ||
      compositionEnded.current ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return
    answer(event.key === "Enter" ? "allow" : cancel)
  }
  const issue =
    decision.issue ??
    (expired && !submitted
      ? {
          code: "approval_expired",
          message: "本次确认请求已到期，请读取当前状态。",
          recovery: "check" as const,
          severity: "info" as const,
        }
      : disabledReason
        ? {
            code: "approval_unavailable",
            message: disabledReason,
            recovery: "check" as const,
            severity: "info" as const,
          }
        : undefined)
  return (
    <Alert
      className="moon-approval"
      role="region"
      aria-label="等待审批"
      data-approval-key={key}
      aria-busy={busy || submitted}
      onKeyDown={keydown}
      onKeyUpCapture={() => {
        compositionEnded.current = false
      }}
      onCompositionStartCapture={() => {
        composing.current = true
      }}
      onCompositionEndCapture={() => {
        composing.current = false
        compositionEnded.current = true
      }}
    >
      <AlertTitle className="moon-approval-heading">
        {busy || submitted ? (
          <LoaderCircle
            className="moon-approval-spinner motion-safe:animate-spin"
            aria-hidden
          />
        ) : (
          <MarkerIcon className="moon-approval-dot" />
        )}
        <span role="status">
          {unknown
            ? "正在确认操作结果"
            : submitted
              ? "决定已提交，等待当前状态"
              : busy
                ? "正在提交决定"
                : expired
                  ? "确认请求已到期"
                  : "等待审批"}
        </span>
      </AlertTitle>
      <Form
        className="moon-approval-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (
            !isDecision &&
            !composing.current &&
            !compositionEnded.current &&
            (request.kind !== "select" || request.options?.includes(value))
          )
            answer(value)
        }}
      >
        <AlertDescription
          className="moon-approval-body [&_p:not(:last-child)]:mb-0"
          tabIndex={0}
          role="group"
          aria-label="审批详情"
        >
          {isDecision && (
            <p className="moon-approval-title">
              {request.kind === "tool"
                ? details
                  ? request.title
                  : request.message || request.title
                : request.title}
            </p>
          )}
          {request.kind === "tool" && (
            <>
              <p className="text-muted-foreground">
                {[
                  details?.sourceName ??
                    approvalSources[details?.sourceKind ?? "unknown"],
                  request.toolName,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {target && (
                <pre
                  className="moon-approval-command"
                  aria-label={
                    target.kind === "path" ? "目标路径" : "待执行命令"
                  }
                >
                  {target.value}
                </pre>
              )}
              {details?.scopeNotice && <p>{details.scopeNotice}</p>}
            </>
          )}
          {request.kind === "confirm" && request.message && (
            <p>{request.message}</p>
          )}
          {request.input && (
            <details>
              <summary>完整参数</summary>
              <pre className="moon-approval-parameters">{request.input}</pre>
            </details>
          )}
          {!isDecision && (
            <QuestionnaireItem
              name="answer"
              disabled={blocked}
              required={request.kind === "select"}
            >
              <QuestionnaireTitle className="wrap-anywhere">
                {request.title}
              </QuestionnaireTitle>
              {request.message && (
                <QuestionnaireDescription>
                  {request.message}
                </QuestionnaireDescription>
              )}
              {request.kind === "select" ? (
                <QuestionnaireChoices>
                  {request.options?.map((option, index) => (
                    <QuestionnaireChoice
                      key={index}
                      value={option}
                      checked={value === option}
                      onChange={() => setValue(option)}
                    >
                      {option}
                    </QuestionnaireChoice>
                  ))}
                </QuestionnaireChoices>
              ) : (
                <QuestionnaireInput
                  value={value}
                  aria-label={request.title}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.repeat ||
                        composing.current ||
                        compositionEnded.current ||
                        event.nativeEvent.isComposing ||
                        event.keyCode === 229)
                    )
                      event.preventDefault()
                  }}
                />
              )}
            </QuestionnaireItem>
          )}
          {issue && (
            <OperationFeedback
              notify={false}
              title={unknown ? "确认结果待核对" : "确认请求未完成"}
              {...issue}
              actions={
                <RecoveryAction
                  issue={issue}
                  onCheck={onReload}
                  onReload={onReload}
                  disabled={readPending}
                  labels={{ check: "读取当前请求", reload: "读取当前请求" }}
                />
              }
            />
          )}
        </AlertDescription>
        <Actions className="moon-approval-actions">
          <Button
            type="button"
            variant="approval-reject"
            size="approval"
            disabled={blocked}
            onClick={() => answer(cancel)}
          >
            {request.kind === "tool" ? "拒绝" : "取消"}
          </Button>
          <Button
            type={isDecision ? "button" : "submit"}
            variant="approval"
            size="approval"
            disabled={
              blocked ||
              (request.kind === "select" && !request.options?.includes(value))
            }
            onClick={isDecision ? () => answer("allow") : undefined}
          >
            {request.kind === "tool" ? "允许一次" : "确认"}
          </Button>
        </Actions>
      </Form>
    </Alert>
  )
}
