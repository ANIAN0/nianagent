import { useEffect, useRef, useState, type ReactNode } from "react"
import { TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"

/** A restored-input warning belongs just above its editor, not to global history. */
export function HomeSubmissionNotice({
  message,
  actions,
  persistent = false,
}: {
  message: string
  actions?: ReactNode
  persistent?: boolean
}) {
  const [visible, setVisible] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const remaining = useRef(8000)
  useEffect(() => {
    if (!visible || persistent || paused) return
    const started = Date.now()
    const timer = setTimeout(() => setVisible(false), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(
        0,
        remaining.current - (Date.now() - started)
      )
    }
  }, [visible, paused, persistent])
  if (!visible) return null
  return (
    <div
      role="status"
      data-slot="home-submission-notice"
      className="mb-3 flex items-start gap-2 rounded-lg border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-sm leading-5 text-foreground"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-status-warning"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p>{message}</p>
        {actions && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        aria-label="关闭发送提示"
        onClick={() => setVisible(false)}
      >
        <X />
      </Button>
    </div>
  )
}
