import { ClipboardList, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export type QueueDeliveryControlProps = {
  mode: "single" | "all"
  disabled?: boolean
  onChange: (mode: "single" | "all") => void | Promise<unknown>
}
export function QueueDeliveryControl({ mode, disabled, onChange }: QueueDeliveryControlProps) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="xs" disabled={disabled} aria-label="消息交付设置">
        <ClipboardList data-icon="inline-start" />{mode === "single" ? "逐条交付" : "全部交付"}<ChevronDown data-icon="inline-end" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>排队消息 · 下次交付生效</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={(value) => { void Promise.resolve(onChange(value as "single" | "all")).catch(() => {}) }}>
        <DropdownMenuRadioItem value="single">逐条交付</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="all">全部交付</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
