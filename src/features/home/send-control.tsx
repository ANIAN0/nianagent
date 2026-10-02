import { ArrowUp } from "lucide-react"
import { InputGroupButton } from "@/components/ui/input-group"

export function SendControl({ disabled }: { disabled: boolean }) {
  return (
    <InputGroupButton
      type="submit"
      size="icon-sm"
      variant="send"
      className="rounded-full"
      aria-label="发送"
      disabled={disabled}
    >
      <ArrowUp />
    </InputGroupButton>
  )
}
