import { useEffect, useId, useRef, useState } from "react"
import type { ConversationApproval } from "@/contracts/rpc.generated"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { useApprovalReply } from "@/features/conversation/permissions/use-approval-reply"

/** Pi business input has its own form; it is not a tool permission decision. */
export function PluginInteractionRequest({
  request,
  sessionId,
  epoch,
  onReply,
  onReload,
}: {
  request: ConversationApproval
  sessionId: string
  epoch: string
  onReply: (value: string) => Promise<unknown>
  onReload?: () => void
}) {
  const id = useId()
  const deadline = Date.parse(request.expiresAt)
  const decision = useApprovalReply(
    JSON.stringify([sessionId, epoch, request.runId, request.id]),
    deadline,
    onReply
  )
  const [value, setValue] = useState(decision.answer ?? "")
  const [expired, setExpired] = useState(
    () => !Number.isFinite(deadline) || Date.now() >= deadline
  )
  const composing = useRef(false)
  const compositionEnded = useRef(false)
  useEffect(() => {
    if (!Number.isFinite(deadline)) return
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Math.min(deadline - Date.now(), 2147483647))
    )
    return () => clearTimeout(timer)
  }, [deadline])
  const blocked = decision.phase !== "idle" || expired
  return (
    <form
      className="plugin-interaction-request"
      aria-labelledby={id}
      aria-busy={decision.phase === "sending"}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
        compositionEnded.current = true
      }}
      onKeyUp={() => {
        compositionEnded.current = false
      }}
      onSubmit={(event) => {
        event.preventDefault()
        if (
          !blocked &&
          !composing.current &&
          !compositionEnded.current &&
          (request.kind !== "select" || request.options?.includes(value))
        )
          void decision.reply(request.kind === "confirm" ? "allow" : value)
      }}
    >
      <h3 id={id}>{request.title}</h3>
      {request.message && (
        <p className="plugin-interaction-copy">{request.message}</p>
      )}
      {request.kind === "input" && (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-input`}>回复</FieldLabel>
            <Input
              id={`${id}-input`}
              value={value}
              disabled={blocked}
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
          </Field>
        </FieldGroup>
      )}
      {request.kind === "select" && (
        <RadioGroup
          value={value}
          onValueChange={setValue}
          disabled={blocked}
          aria-labelledby={id}
        >
          <FieldGroup>
            {request.options?.map((option, index) => (
              <Field key={option} orientation="horizontal">
                <RadioGroupItem id={`${id}-${index}`} value={option} />
                <FieldLabel htmlFor={`${id}-${index}`}>{option}</FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </RadioGroup>
      )}
      {decision.issue && (
        <OperationFeedback
          notify={false}
          {...decision.issue}
          title="回复未完成"
          actions={
            onReload && (
              <RecoveryAction
                issue={decision.issue}
                onCheck={onReload}
                onReload={onReload}
              />
            )
          }
        />
      )}
      {expired && (
        <p role="status" className="plugin-interaction-copy">
          请求已到期
        </p>
      )}
      {decision.phase !== "idle" && (
        <p role="status" className="plugin-interaction-copy">
          {decision.phase === "sending"
            ? "正在提交…"
            : decision.phase === "submitted"
              ? "已回复，等待继续"
              : "回复结果待确认，等待会话更新"}
        </p>
      )}
      <div className="plugin-interaction-actions">
        <Button
          type="button"
          variant="outline"
          disabled={blocked}
          onClick={() =>
            void decision.reply(request.kind === "confirm" ? "deny" : "cancel")
          }
        >
          取消
        </Button>
        <Button
          type="submit"
          disabled={
            blocked ||
            (request.kind === "select" && !request.options?.includes(value))
          }
        >
          确认
        </Button>
      </div>
    </form>
  )
}
