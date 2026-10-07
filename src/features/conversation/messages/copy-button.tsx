import { useEffect, useLayoutEffect, useRef, useState } from "react"
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
  const [state, setState] = useState<"idle" | "pending" | "copied" | "failed">(
    "idle"
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  const busy = useRef(false)
  const latestText = useRef(text)
  useLayoutEffect(() => {
    latestText.current = text
  }, [text])
  useEffect(() => {
    epoch.current += 1
    return () => {
      epoch.current += 1
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
  useEffect(() => {
    if (!busy.current) {
      if (timer.current) clearTimeout(timer.current)
      setState("idle")
    }
  }, [text])
  const description =
    state === "pending"
      ? "正在复制"
      : state === "copied"
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
            aria-busy={state === "pending"}
            disabled={!text || state === "pending"}
            onClick={async () => {
              if (busy.current) return
              busy.current = true
              const request = epoch.current
              setState("pending")
              try {
                await navigator.clipboard.writeText(text)
                if (request !== epoch.current) return
                setState(latestText.current === text ? "copied" : "idle")
                if (timer.current) clearTimeout(timer.current)
                timer.current = setTimeout(() => {
                  if (request === epoch.current) setState("idle")
                }, 1500)
              } catch {
                if (request === epoch.current) setState("failed")
              } finally {
                if (request === epoch.current) busy.current = false
              }
            }}
          >
            {state === "copied" ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
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
