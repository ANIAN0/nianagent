import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function CopyButton({
  text,
  label = "复制",
}: {
  text: string
  label?: string
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )
  const description =
    state === "copied"
      ? "已复制"
      : state === "failed"
        ? "复制失败，请重试"
        : label
  return (
    <span className="conversation-copy-control">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={description}
            disabled={!text}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                setState("copied")
                if (timer.current) clearTimeout(timer.current)
                timer.current = setTimeout(() => setState("idle"), 1500)
              } catch {
                setState("failed")
              }
            }}
          >
            {state === "copied" ? <Check /> : <Copy />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status">
        {state === "idle" ? "" : description}
      </span>
      {state === "failed" && (
        <span className="conversation-copy-error">复制失败，请重试</span>
      )}
    </span>
  )
}
