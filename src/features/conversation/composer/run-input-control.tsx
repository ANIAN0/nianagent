import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="composer-auxiliary-trigger"
          aria-label="运行中 Enter 行为"
        >
          Enter {mode === "followUp" ? "排队" : "补充"}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuLabel>运行中发送方式</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => onChange(value as BusyInputMode)}
        >
          <DropdownMenuRadioItem value="followUp">
            排队 · 当前工作结束后处理
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="steer">
            补充 · 在下个可用边界处理
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
