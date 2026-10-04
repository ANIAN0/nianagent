import { useEffect } from "react"
import { ClipboardList, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DisabledControlReason } from "@/components/composer/disabled-control-reason"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/features/home/composer-panel-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type QueueDeliveryControlProps = {
  mode: "single" | "all"
  disabled?: boolean
  disabledReason?: string
  queuedCount?: number
  onChange: (mode: "single" | "all") => void | Promise<unknown>
}
export function QueueDeliveryControl({
  mode,
  disabled,
  disabledReason,
  queuedCount = 0,
  onChange,
}: QueueDeliveryControlProps) {
  const [open, setOpen] = useComposerPanel("delivery")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("delivery")
  useEffect(() => {
    if (disabled && open) setOpen(false)
  }, [disabled, open, setOpen])
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        className="composer-auxiliary-trigger"
        aria-label={`消息交付设置，当前${mode === "single" ? "逐条交付" : "全部交付"}`}
        title="排队消息的交付方式"
      >
        <ClipboardList data-icon="inline-start" />
        {mode === "single" ? "逐条交付" : "全部交付"}
        <ChevronDown data-icon="inline-end" />
      </Button>
    </DropdownMenuTrigger>
  )
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {disabled && disabledReason ? (
        <DisabledControlReason
          label="消息交付设置暂不可用"
          reason={disabledReason}
        >
          {trigger}
        </DisabledControlReason>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        align="end"
        className="w-64"
        onCloseAutoFocus={closeAutoFocus}
      >
        <DropdownMenuLabel>排队消息的交付方式</DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-5 text-muted-foreground">
          {queuedCount
            ? `${queuedCount} 条等待消息`
            : "当前没有等待消息，设置用于后续排队。"}
        </p>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            void Promise.resolve(onChange(value as "single" | "all")).catch(
              () => {}
            )
          }}
        >
          <DropdownMenuRadioItem value="single">逐条交付</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all">全部交付</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">
          {mode === "single"
            ? "每次交付最早的一条消息。"
            : "在同一边界按顺序交付等待中的所有消息，不会合并或并行执行。"}
          更改后在下次交付生效。
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
