import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { MarkerIcon } from "@/components/ui/marker"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import type { ConversationApproval } from "@/features/models/model-contract.generated"
import { useApprovalReply } from "./use-approval-reply"
import "./approval-card.css"

function approvalTarget(input?: string) {
  if (!input) return ""
  try {
    const value: unknown = JSON.parse(input)
    if (value && typeof value === "object") {
      const fields = value as Record<string, unknown>
      if (typeof fields.command === "string") return fields.command
      if (typeof fields.path === "string") return fields.path
    }
  } catch {
    /* Raw parameters remain readable. */
  }
  return input
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
  const target = approvalTarget(request.input)
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
            ? "确认结果待核对"
            : submitted
              ? "决定已提交，等待当前状态"
              : busy
                ? "正在提交决定"
                : expired
                  ? "确认请求已到期"
                  : "等待审批"}
        </span>
      </AlertTitle>
      <form
        className="moon-approval-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (
            !isDecision &&
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
          <p className="moon-approval-title">
            {request.kind === "tool"
              ? request.message ||
                request.title ||
                "工具 " + (request.toolName ?? "") + " 请求越权执行"
              : request.title}
          </p>
          {request.kind !== "tool" && request.message && (
            <p>{request.message}</p>
          )}
          {request.kind === "tool" && target && (
            <pre className="moon-approval-command" aria-label="待确认的操作">
              {target}
            </pre>
          )}
          {request.input && request.input !== target && (
            <details>
              <summary>完整参数</summary>
              <pre className="moon-approval-parameters">{request.input}</pre>
            </details>
          )}
          {request.kind === "input" && (
            <FieldGroup>
              <Field>
                <FieldLabel
                  htmlFor={"approval-" + request.id}
                  className="sr-only"
                >
                  {request.title}
                </FieldLabel>
                <Input
                  id={"approval-" + request.id}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  disabled={blocked}
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
              </Field>
            </FieldGroup>
          )}
          {request.kind === "select" && (
            <RadioGroup
              value={value}
              onValueChange={setValue}
              disabled={blocked}
              aria-label={request.title}
            >
              <FieldGroup>
                {request.options?.map((option, index) => (
                  <Field key={index} orientation="horizontal">
                    <RadioGroupItem
                      id={"approval-" + request.id + "-" + index}
                      value={option}
                    />
                    <FieldLabel
                      htmlFor={"approval-" + request.id + "-" + index}
                    >
                      {option}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            </RadioGroup>
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
        <div className="moon-approval-actions">
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
        </div>
      </form>
    </Alert>
  )
}
