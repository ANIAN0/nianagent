import type { KeyboardEvent, ReactNode } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HoverHint } from "@/components/feedback/hover-hint"

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
          : index < 0
            ? items.length - 1
            : (index - 1 + items.length) % items.length
  items[next]?.focus()
}
export function PickerOption({
  selected,
  children,
  description,
  onSelect,
  active = false,
  id,
  onPointerMove,
  fullName,
}: {
  selected: boolean
  children: ReactNode
  description?: string
  onSelect: () => void
  active?: boolean
  id?: string
  onPointerMove?: () => void
  fullName?: string
}) {
  const option = (
    <Button
      id={id}
      type="button"
      variant="ghost"
      role="menuitemradio"
      aria-checked={selected}
      data-picker-item
      data-active={active || undefined}
      className="h-[34px] w-full min-w-0 justify-start gap-2 px-2 py-1 text-left text-[13px] leading-5 font-normal data-active:bg-accent"
      onClick={onSelect}
      onPointerMove={onPointerMove}
    >
      <span className="flex min-w-0 flex-1 items-center gap-4">
        <span className="moon-picker-option-name min-w-0 flex-1 truncate">
          {children}
        </span>
        {description && (
          <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">
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
  return fullName ? (
    <HoverHint content={fullName} onlyWhenTruncated=".moon-picker-option-name">
      {option}
    </HoverHint>
  ) : (
    option
  )
}
