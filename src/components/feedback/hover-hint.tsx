import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DisabledControlReason } from "@/components/composer/disabled-control-reason"

/** One presentation for control help, complete labels and unavailable reasons. */
export function HoverHint({
  content,
  children,
  disabled,
  label,
  className,
  onlyWhenTruncated,
  suppressed = false,
}: {
  content?: string
  children: ReactElement
  disabled?: boolean
  label?: string
  className?: string
  onlyWhenTruncated?: boolean | string
  suppressed?: boolean
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const needsHint = useCallback(() => {
    if (suppressed) return false
    if (!onlyWhenTruncated) return true
    const labels =
      typeof onlyWhenTruncated === "string"
        ? Array.from(trigger.current?.querySelectorAll(onlyWhenTruncated) ?? [])
        : [trigger.current]
    return labels.some(
      (label) =>
        label instanceof HTMLElement &&
        (!label.getClientRects().length ||
          label.scrollWidth > label.clientWidth ||
          label.scrollHeight > label.clientHeight)
    )
  }, [suppressed, onlyWhenTruncated])
  useEffect(() => {
    if (!open || !onlyWhenTruncated || !trigger.current) return
    const observer = new ResizeObserver(() => {
      if (!needsHint()) setOpen(false)
    })
    observer.observe(trigger.current)
    if (typeof onlyWhenTruncated === "string")
      trigger.current
        .querySelectorAll(onlyWhenTruncated)
        .forEach((label) => observer.observe(label))
    return () => observer.disconnect()
  }, [open, onlyWhenTruncated, needsHint])
  if (!content) return children
  if (disabled)
    return (
      <DisabledControlReason
        reason={content}
        label={`${label ?? content}，暂不可用`}
        className={className}
      >
        {children}
      </DisabledControlReason>
    )
  return (
    <Tooltip
      open={open && !suppressed}
      onOpenChange={(next) => setOpen(next && needsHint())}
    >
      <TooltipTrigger ref={trigger} asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{content}</TooltipContent>
    </Tooltip>
  )
}
