import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import "./conversation-layout.css"

export interface ConversationTurn {
  id: string
  turn: number
  prompt: string
  response?: string
}

export interface ConversationNavigatorProps {
  items: readonly ConversationTurn[]
  activeId?: string
  onNavigate: (id: string) => void
}

function responseSummary(text: string) {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .split("\n")
    .filter((line) => !/^\s*\|/.test(line))
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}\s|>\s?|[-*+]\s)/, ""))
    .join(" ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

export function ConversationNavigator({
  items,
  activeId,
  onNavigate,
}: ConversationNavigatorProps) {
  const [preview, setPreview] = useState<{ id: string; top: number }>()
  const marks = useRef<HTMLDivElement>(null)
  const pointerInside = useRef(false)
  const previewId = useId()
  const summaries = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.id,
          responseSummary((item.response ?? "").slice(0, 2000)),
        ])
      ),
    [items]
  )
  const activeIndex = items.findIndex((item) => item.id === activeId)
  const centerCurrent = useCallback(() => {
    const scroller = marks.current
    if (!scroller || pointerInside.current) return
    const button = Array.from(
      scroller.querySelectorAll<HTMLButtonElement>("button")
    ).find((item) => item.dataset.turnId === activeId)
    if (!button) return
    // Only the rail moves here. scrollIntoView could unexpectedly scroll the
    // transcript or document while the reader inspects a previous turn.
    if (
      button.offsetTop < scroller.scrollTop + 12 ||
      button.offsetTop + 10 > scroller.scrollTop + scroller.clientHeight - 12
    )
      scroller.scrollTop = Math.max(
        0,
        button.offsetTop - scroller.clientHeight / 2 + 5
      )
  }, [activeId])
  useLayoutEffect(centerCurrent, [centerCurrent, items.length])
  if (items.length < 2) return null
  const current = items.find((item) => item.id === preview?.id)
  function showPreview(id: string, button: HTMLButtonElement) {
    const rail = button.closest("nav")!
    const bounds = rail.getBoundingClientRect()
    const reading = rail.parentElement!.getBoundingClientRect()
    const mark = button.getBoundingClientRect()
    setPreview({
      id,
      top: Math.max(
        reading.top - bounds.top + 8,
        Math.min(mark.top - bounds.top - 40, reading.bottom - bounds.top - 108)
      ),
    })
  }
  return (
    <nav
      className="conversation-turn-rail"
      style={{ height: Math.min(items.length * 10 + 12, 420) }}
      aria-label="会话轮次"
      onPointerEnter={() => {
        pointerInside.current = true
      }}
      onPointerLeave={() => {
        pointerInside.current = false
        setPreview(undefined)
        centerCurrent()
      }}
    >
      <div
        className="conversation-turn-marks"
        ref={marks}
        onScroll={() => setPreview(undefined)}
      >
        {items.map((item, index) => (
          <Button
            key={item.id}
            variant="ghost"
            size="icon-xs"
            className="conversation-turn-mark"
            data-turn-id={item.id}
            tabIndex={
              activeId === item.id || (activeIndex < 0 && index === 0) ? 0 : -1
            }
            aria-label={`跳转到第 ${item.turn} 轮：${item.prompt.slice(0, 80)}`}
            aria-current={activeId === item.id ? "step" : undefined}
            aria-describedby={preview?.id === item.id ? previewId : undefined}
            onPointerEnter={(event) =>
              showPreview(item.id, event.currentTarget)
            }
            onFocus={(event) => showPreview(item.id, event.currentTarget)}
            onBlur={() => setPreview(undefined)}
            onClick={() => onNavigate(item.id)}
            onKeyDown={(event) => {
              const offset =
                event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
              if (!offset && event.key !== "Home" && event.key !== "End") return
              event.preventDefault()
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : Math.max(0, Math.min(items.length - 1, index + offset))
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  "button"
                )
              buttons?.[next]?.focus()
            }}
          />
        ))}
      </div>
      {current && (
        <div
          id={previewId}
          role="tooltip"
          className="conversation-turn-preview"
          style={{ top: preview?.top }}
        >
          <strong>
            {current.prompt.slice(0, 80) || `第 ${current.turn} 轮`}
          </strong>
          {current.response && <p>{summaries.get(current.id)}</p>}
        </div>
      )}
    </nav>
  )
}
