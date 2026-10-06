import { useRef, useState } from "react"
import { ShieldQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Field, FieldLabel } from "@/components/ui/field"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import type { ConversationApproval } from "@/features/models/model-contract.generated"
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
    /* Raw parameters remain available. */
  }
  return input
}
export function ApprovalCard({
  request,
  onReply,
  onReload,
}: {
  request: ConversationApproval
  onReply: (value: string) => Promise<unknown>
  onReload?: () => void
}) {
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const waiting = useRef(false)
  const [issue, setIssue] = useState<FeedbackDescription>()
  async function reply(answer: string) {
    if (waiting.current) return
    waiting.current = true
    setPending(true)
    setIssue(undefined)
    try {
      await onReply(answer)
    } catch (error) {
      setIssue(feedbackFromError(error))
    } finally {
      waiting.current = false
      setPending(false)
    }
  }
  return (
    <Alert
      className="moon-approval"
      role="region"
      aria-label="等待你的确认"
      aria-busy={pending}
    >
      <AlertTitle className="moon-approval-heading">
        <ShieldQuestion aria-hidden />
        <span>等待确认</span>
        {request.toolName && (
          <span className="moon-approval-tool">{request.toolName}</span>
        )}
      </AlertTitle>
      <AlertDescription className="moon-approval-body">
        <p className="moon-approval-title">{request.title}</p>
        {request.kind === "tool" && request.input && (
          <pre className="moon-approval-command" aria-label="待确认的操作">
            {approvalTarget(request.input)}
          </pre>
        )}
        <p>{request.message}</p>
        {request.input && (
          <details>
            <summary>完整参数</summary>
            <pre className="moon-approval-parameters">{request.input}</pre>
          </details>
        )}
      </AlertDescription>
      <form
        className="moon-approval-form"
        onSubmit={(event) => {
          event.preventDefault()
          void reply(value)
        }}
      >
        {request.kind === "input" && (
          <Field>
            <FieldLabel htmlFor={`approval-${request.id}`} className="sr-only">
              {request.title}
            </FieldLabel>
            <Input
              id={`approval-${request.id}`}
              aria-label={request.title}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={pending}
            />
          </Field>
        )}
        <div className="moon-approval-actions">
          <span
            className="moon-approval-expiry"
            title={new Date(request.expiresAt).toLocaleString()}
          >
            超时后自动取消
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              void reply(
                request.kind === "tool" || request.kind === "confirm"
                  ? "deny"
                  : "cancel"
              )
            }
          >
            {request.kind === "tool" ? "拒绝" : "取消"}
          </Button>
          {request.kind === "select" ? (
            request.options?.map((option) => (
              <Button
                key={option}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void reply(option)}
              >
                {option}
              </Button>
            ))
          ) : (
            <Button
              type={request.kind === "input" ? "submit" : "button"}
              size="sm"
              disabled={pending}
              onClick={
                request.kind === "input" ? undefined : () => void reply("allow")
              }
            >
              {pending
                ? "正在提交…"
                : request.kind === "tool"
                  ? "允许这一次"
                  : "确认"}
            </Button>
          )}
        </div>
      </form>
      {issue && (
        <OperationFeedback
          title="回答待核对"
          {...issue}
          actions={
            onReload && (
              <Button size="sm" variant="outline" onClick={onReload}>
                读取当前状态
              </Button>
            )
          }
        />
      )}
    </Alert>
  )
}
