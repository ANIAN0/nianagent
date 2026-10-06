import { useEffect, useState, type RefObject } from "react"
import {
  TOOLTIP_DELAY,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Lexical owns the reference DOM; this layer owns only its hover presentation. */
export function InlineReferenceHint({
  root,
}: {
  root: RefObject<HTMLElement | null>
}) {
  const [hint, setHint] = useState<{ content: string; bounds: DOMRect }>()
  useEffect(() => {
    const editor = root.current
    if (!editor) return
    let target: HTMLElement | null = null
    let timer: number | undefined
    const clear = () => {
      window.clearTimeout(timer)
      timer = undefined
      target = null
      setHint(undefined)
    }
    const enter = (event: PointerEvent) => {
      const reference =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-reference-source]")
          : null
      if (!reference || !editor.contains(reference) || target === reference)
        return
      clear()
      target = reference
      timer = window.setTimeout(() => {
        if (reference.isConnected && target === reference)
          setHint({
            content:
              reference.dataset.referenceHint ||
              reference.dataset.referenceSource!,
            bounds: reference.getBoundingClientRect(),
          })
      }, TOOLTIP_DELAY)
    }
    const leave = (event: PointerEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        target?.contains(event.relatedTarget)
      )
        return
      clear()
    }
    editor.addEventListener("pointerover", enter)
    editor.addEventListener("pointerout", leave)
    editor.addEventListener("pointerdown", clear)
    editor.addEventListener("input", clear)
    editor.addEventListener("keydown", clear)
    window.addEventListener("scroll", clear, true)
    window.addEventListener("resize", clear)
    return () => {
      window.clearTimeout(timer)
      editor.removeEventListener("pointerover", enter)
      editor.removeEventListener("pointerout", leave)
      editor.removeEventListener("pointerdown", clear)
      editor.removeEventListener("input", clear)
      editor.removeEventListener("keydown", clear)
      window.removeEventListener("scroll", clear, true)
      window.removeEventListener("resize", clear)
    }
  }, [root])
  if (!hint) return null
  return (
    <Tooltip
      open
      onOpenChange={(open) => {
        if (!open) setHint(undefined)
      }}
    >
      <TooltipTrigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: "fixed",
            pointerEvents: "none",
            left: hint.bounds.left,
            top: hint.bounds.top,
            width: hint.bounds.width,
            height: hint.bounds.height,
          }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{hint.content}</TooltipContent>
    </Tooltip>
  )
}
