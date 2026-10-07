import { ArrowUp } from "lucide-react"
import { InputGroupButton } from "@/components/ui/input-group"
import { composerPrimaryAction } from "@/components/composer/composer-policy"
import { HoverHint } from "@/components/feedback/hover-hint"
import { QueueActionHint } from "./queue-action-hint"

export type ConversationSendControlProps = {
  allowQueue?: boolean
  running?: boolean
  stopping?: boolean
  stopUnconfirmed?: boolean
  hasDraft: boolean
  disabled?: boolean
  disabledReason?: string
  command?: "compact" | "extension"
  delivery?: "followUp" | "steer"
  onStop: () => void
}
export function ConversationSendControl({
  allowQueue = true,
  running = false,
  stopping = false,
  stopUnconfirmed = false,
  hasDraft,
  disabled = false,
  disabledReason,
  command,
  delivery = "followUp",
  onStop,
}: ConversationSendControlProps) {
  const action = composerPrimaryAction({
    running,
    stopping,
    hasDraft,
    canSubmit: !disabled && (!running || allowQueue),
    command: command === "compact",
  })
  const label =
    action === "stopping"
      ? stopUnconfirmed
        ? "停止结果待确认"
        : "正在停止"
      : action === "stop"
        ? "停止执行"
        : action === "queue"
            ? delivery === "steer"
              ? "补充当前工作"
              : "排队发送"
            : command === "extension"
              ? "执行扩展命令"
              : "发送"
  const primaryStops = action === "stop" || action === "stopping"
  const primaryDisabled =
    action === "stopping" ||
    (!primaryStops && (disabled || !hasDraft || (running && !allowQueue)))
  const control = (
    <InputGroupButton
      type={primaryStops ? "button" : "submit"}
      variant="send"
      size="icon-sm"
      className="conversation-send-control"
      aria-label={label}
      disabled={primaryDisabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={
        primaryStops
          ? (event) => {
              event.preventDefault()
              onStop()
            }
          : undefined
      }
    >
      {primaryStops ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
          <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
        </svg>
      ) : (
        <ArrowUp />
      )}
    </InputGroupButton>
  )
  return (
    <div className="conversation-send-controls">
      {primaryDisabled && !primaryStops && hasDraft ? (
        <HoverHint content={disabledReason} disabled label={label}>
          {control}
        </HoverHint>
      ) : (
        <QueueActionHint
          content={
            primaryDisabled ? undefined : action === "stop" ? (
              <span className="conversation-stop-hint">
                <span>{label}</span>
                <span className="conversation-stop-keys">
                  <kbd>Esc</kbd>
                  <kbd>Esc</kbd>
                </span>
              </span>
            ) : (
              label
            )
          }
          side="top"
        >
          {control}
        </QueueActionHint>
      )}
    </div>
  )
}
