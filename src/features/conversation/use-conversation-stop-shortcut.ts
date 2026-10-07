import { useEffect, useEffectEvent, type RefObject } from "react"

/** DSH's default stop sequence belongs to one running turn and focus region. */
export function useConversationStopShortcut({
  root,
  sessionId,
  runId,
  epoch,
  enabled,
  onStop,
}: {
  root: RefObject<HTMLElement | null>
  sessionId: string
  runId?: string
  epoch?: string
  enabled: boolean
  onStop: () => void
}) {
  const stop = useEffectEvent(onStop)
  useEffect(() => {
    if (!enabled || !runId) return
    const page = root.current
    if (!page) return
    let first: { region: Element; deadline: number } | undefined
    let captured: Element | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let composing = false
    let compositionEnded = 0
    const reset = () => {
      first = undefined
      clearTimeout(timer)
    }
    const regionFor = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !page.contains(target)) return
      if (
        target.closest("iframe, .xterm, [inert], [data-approval-key]") ||
        target.closest("[data-conversation-session]") !== page
      )
        return
      const region = target.closest("[data-conversation-region]")
      return region && page.contains(region) ? region : undefined
    }
    const panelOpen = () =>
      !!page.querySelector("[data-composer-editor][aria-expanded='true']") ||
      [
        ...document.querySelectorAll<HTMLElement>(
          "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-slot='popover-content']"
        ),
      ].some(
        (panel) =>
          panel.getClientRects().length && !panel.closest("[hidden], [inert]")
      )
    const capture = (event: KeyboardEvent) => {
      captured = undefined
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        composing ||
        performance.now() - compositionEnded < 50 ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey ||
        event.defaultPrevented ||
        panelOpen()
      ) {
        reset()
        return
      }
      captured = regionFor(event.target)
      if (!captured) reset()
    }
    const press = (event: KeyboardEvent) => {
      // Capture sees panels before Escape dismisses them; bubbling lets the
      // editor's candidate selection or queue edit consume Escape first.
      if (
        !captured ||
        event.defaultPrevented ||
        captured !== regionFor(event.target)
      ) {
        reset()
        return
      }
      const region = captured
      captured = undefined
      event.preventDefault()
      const previous = first
      reset()
      const now = performance.now()
      if (previous && previous.region === region && now <= previous.deadline)
        stop()
      else {
        first = { region, deadline: now + 500 }
        timer = setTimeout(reset, 500)
      }
    }
    const focus = (event: FocusEvent) => {
      if (first && regionFor(event.target) !== first.region) reset()
    }
    const compositionStart = () => {
      composing = true
      reset()
    }
    const compositionEnd = () => {
      composing = false
      compositionEnded = performance.now()
      reset()
    }
    document.addEventListener("keydown", capture, true)
    document.addEventListener("keydown", press)
    document.addEventListener("focusin", focus)
    document.addEventListener("pointerdown", reset, true)
    document.addEventListener("compositionstart", compositionStart, true)
    document.addEventListener("compositionend", compositionEnd, true)
    document.addEventListener("visibilitychange", reset)
    window.addEventListener("blur", reset)
    return () => {
      reset()
      document.removeEventListener("keydown", capture, true)
      document.removeEventListener("keydown", press)
      document.removeEventListener("focusin", focus)
      document.removeEventListener("pointerdown", reset, true)
      document.removeEventListener("compositionstart", compositionStart, true)
      document.removeEventListener("compositionend", compositionEnd, true)
      document.removeEventListener("visibilitychange", reset)
      window.removeEventListener("blur", reset)
    }
  }, [root, sessionId, runId, epoch, enabled])
}
