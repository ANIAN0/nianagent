import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/components/composer/composer-panel-context"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
export type BusyInputMode = "followUp" | "steer"
export function RunInputControl({
  mode,
  onChange,
}: {
  mode: BusyInputMode
  onChange: (mode: BusyInputMode) => void
}) {
  const [open, setOpen] = useComposerPanel("run-input")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("run-input")
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="composer-auxiliary-trigger"
          aria-label="运行中发送方式"
        >
          {mode === "followUp" ? "后续（Follow-up）" : "补充（Steer）"}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={closeAutoFocus}>
        <DropdownMenuLabel>运行中发送方式</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => onChange(value as BusyInputMode)}
        >
          <DropdownMenuRadioItem value="followUp">
            后续（Follow-up） · 当前工作准备结束时处理
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="steer">
            补充（Steer） · 在可交付的轮次边界处理
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Ctrl / Cmd + Enter 使用另一种方式
          <br />
          Shift + Enter 换行
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
