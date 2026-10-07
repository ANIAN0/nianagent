import type { ReactElement, ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** DSH queue actions use a delayed bottom tooltip; disabled actions retain native help. */
export function QueueActionHint({
  content,
  disabled,
  side = "bottom",
  children,
}: {
  content?: ReactNode
  disabled?: boolean
  side?: "top" | "bottom"
  children: ReactElement
}) {
  if (disabled || !content) return children
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={8}
        className="conversation-queue-hint"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
