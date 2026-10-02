import { ArrowUp, LoaderCircle, Square } from "lucide-react"
import { InputGroupButton } from "@/components/ui/input-group"

export type ConversationSendControlProps = {
  running?: boolean
  stopping?: boolean
  hasDraft: boolean
  disabled?: boolean
  onStop: () => void
}
export function ConversationSendControl({
  running = false,
  stopping = false,
  hasDraft,
  disabled = false,
  onStop,
}: ConversationSendControlProps) {
  const stop = stopping || (running && (!hasDraft || disabled))
  const label = stopping
    ? "正在停止"
    : stop
      ? "停止执行"
      : running
        ? "排队发送"
        : "发送"
  return (
    <InputGroupButton
      type={stop ? "button" : "submit"}
      variant="send"
      size="icon-sm"
      className="conversation-send-control"
      aria-label={label}
      title={label}
      disabled={stopping || (!stop && (disabled || !hasDraft))}
      onClick={stop ? onStop : undefined}
    >
      {stopping ? (
        <LoaderCircle className="animate-spin" />
      ) : stop ? (
        <Square />
      ) : (
        <ArrowUp />
      )}
    </InputGroupButton>
  )
}
