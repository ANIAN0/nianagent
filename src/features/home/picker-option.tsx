import type { KeyboardEvent, ReactNode } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"

// Focus navigation must never change the selected value.
export function navigatePicker(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button[data-picker-item]:not(:disabled)"
    )
  )
  if (!items.length) return
  event.preventDefault()
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length
  items[next]?.focus()
}
export function PickerOption({
  selected,
  children,
  description,
  onSelect,
}: {
  selected: boolean
  children: ReactNode
  description?: string
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      role="menuitemradio"
      aria-checked={selected}
      data-picker-item
      className="h-auto min-h-10 w-full min-w-0 justify-start gap-3 px-3 py-2 text-left font-normal whitespace-normal"
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block">{children}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <span
        className="grid size-4 shrink-0 place-items-center"
        aria-hidden="true"
      >
        {selected && <Check />}
      </span>
    </Button>
  )
}
