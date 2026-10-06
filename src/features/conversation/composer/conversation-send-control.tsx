import { ArrowUp, ListCollapse, LoaderCircle, Square } from "lucide-react"
import { InputGroupButton } from "@/components/ui/input-group"
import { composerPrimaryAction } from "@/components/composer/composer-policy"

export type ConversationSendControlProps = {
  allowQueue?: boolean
  running?: boolean
  stopping?: boolean
  hasDraft: boolean
  disabled?: boolean
  command?: "compact" | "extension"
  delivery?: "followUp" | "steer"
  onStop: () => void
}
export function ConversationSendControl({
  allowQueue = true,
  running = false,
  stopping = false,
  hasDraft,
  disabled = false,
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
      ? "正在停止"
      : action === "stop"
        ? "停止执行"
        : action === "compact"
          ? "打开压缩面板"
          : action === "queue"
            ? delivery === "steer"
              ? "补充当前工作"
              : "排队发送"
            : command === "extension"
              ? "执行扩展命令"
              : "发送"
  const primaryStops = action === "stop" || action === "stopping"
  return (
    <div className="conversation-send-controls">
      {action === "queue" && (
        <InputGroupButton
          type="button"
          variant="ghost"
          size="icon-sm"
          className="conversation-send-control text-muted-foreground"
          aria-label="停止执行"
          title="停止执行"
          onClick={(event) => {
            event.preventDefault()
            onStop()
          }}
        >
          <Square />
        </InputGroupButton>
      )}
      <InputGroupButton
        type={primaryStops ? "button" : "submit"}
        variant="send"
        size="icon-sm"
        className="conversation-send-control"
        aria-label={label}
        title={label}
        disabled={
          action === "stopping" ||
          (!primaryStops && (disabled || !hasDraft || (running && !allowQueue)))
        }
        onClick={
          primaryStops
            ? (event) => {
                event.preventDefault()
                onStop()
              }
            : undefined
        }
      >
        {action === "stopping" ? (
          <LoaderCircle className="motion-safe:animate-spin" />
        ) : primaryStops ? (
          <Square />
        ) : action === "compact" ? (
          <ListCollapse />
        ) : (
          <ArrowUp />
        )}
      </InputGroupButton>
    </div>
  )
}
