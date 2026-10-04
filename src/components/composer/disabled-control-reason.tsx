import { useId, type ReactNode } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Disabled controls remain explainable by both keyboard focus and hover. */
export function DisabledControlReason({
  reason,
  label,
  children,
}: {
  reason: string
  label: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="button"
            aria-disabled="true"
            aria-label={label}
            aria-describedby={id}
            className="inline-flex min-w-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ")
                event.preventDefault()
            }}
          >
            {children}
            <span id={id} className="sr-only">
              {reason}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
