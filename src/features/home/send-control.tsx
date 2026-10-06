import { HoverHint } from "@/components/feedback/hover-hint"
import { ArrowUp } from "lucide-react"
import { InputGroupButton } from "@/components/ui/input-group"

export function SendControl({
  disabled,
  disabledReason,
}: {
  disabled: boolean
  disabledReason?: string
}) {
  return (
    <HoverHint
      content={disabled ? disabledReason : "发送"}
      disabled={disabled}
      label="发送"
    >
      <InputGroupButton
        type="submit"
        size="icon-sm"
        variant="send"
        className="size-[34px] rounded-full"
        aria-label="发送"
        disabled={disabled}
      >
        <ArrowUp className="size-4" />
      </InputGroupButton>
    </HoverHint>
  )
}
