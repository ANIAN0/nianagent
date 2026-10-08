import { useLayoutEffect, useState, type RefObject } from "react"
import { composerEditor } from "./composer-editor-contract"
import { materialPanelPlacement } from "@/lib/composer/material-panel-position"

/** 只跟随实际卡片/视口位置；关闭时立即释放全部监听。 */
export function useMaterialPanelPosition({
  open,
  anchorRef,
  trigger,
  inputMode,
  pane,
}: {
  open: boolean
  anchorRef?: RefObject<HTMLDivElement | null>
  trigger: RefObject<HTMLButtonElement | null>
  inputMode: "button" | "file" | "slash" | "skill"
  pane: "resources" | "candidates"
}) {
  const [availableHeight, setAvailableHeight] = useState(320)
  const [position, setPosition] = useState<{
    left: number
    width: number
    top?: number
    bottom?: number
  }>({ left: 12, width: 0, bottom: 12 })
  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef?.current ?? trigger.current
    if (!anchor) return
    function updatePosition() {
      const rect = anchor!.getBoundingClientRect()
      const placement = materialPanelPlacement({
        card: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          width: anchorRef?.current ? rect.width : Math.max(288, rect.width),
        },
        trigger: trigger.current?.getBoundingClientRect() ?? rect,
        text: composerEditor(anchorRef?.current)?.getBoundingClientRect(),
        mode: inputMode,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        desiredHeight: pane === "resources" ? 382 : 160,
      })
      setPosition({
        left: placement.left,
        width: placement.width,
        top: placement.top,
        bottom: placement.bottom,
      })
      setAvailableHeight(placement.maxHeight)
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(anchor)
    if (trigger.current) observer.observe(trigger.current)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, anchorRef, inputMode, pane, trigger])
  return { position, availableHeight }
}
