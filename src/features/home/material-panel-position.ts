type AnchorRect = Pick<DOMRect, "top" | "bottom" | "left" | "width">
type PanelPlacement = {
  left: number
  width: number
  maxHeight: number
  side: "top" | "bottom"
  top?: number
  bottom?: number
}

const SAFE_EDGE = 12
const ANCHOR_GAP = 4
const MIN_USEFUL_HEIGHT = 160

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

/** Preserve the card-width, above-card layout when it has useful visible space. */
export function materialPanelPlacement({
  card,
  trigger,
  text,
  mode,
  viewportWidth,
  viewportHeight,
  desiredHeight,
}: {
  card: AnchorRect
  trigger: AnchorRect
  text?: AnchorRect
  mode: "button" | "file" | "slash" | "skill"
  viewportWidth: number
  viewportHeight: number
  desiredHeight: number
}): PanelPlacement {
  const safeWidth = Math.max(0, viewportWidth - SAFE_EDGE * 2)
  const width = Math.min(card.width, safeWidth)
  const left = clamp(card.left, SAFE_EDGE, viewportWidth - SAFE_EDGE - width)
  const cardSpace = card.top - SAFE_EDGE - ANCHOR_GAP
  if (
    card.top <= viewportHeight - SAFE_EDGE &&
    cardSpace >= Math.min(desiredHeight, MIN_USEFUL_HEIGHT)
  )
    return {
      left,
      width,
      side: "top",
      bottom: viewportHeight - card.top + ANCHOR_GAP,
      maxHeight: Math.min(desiredHeight, cardSpace),
    }

  // The card itself may be scrolled away. Use a visible operation/caret surface
  // instead of manufacturing a minimum height above an off-screen anchor.
  const source = mode === "button" || !text ? trigger : text
  const sourceTop = clamp(source.top, SAFE_EDGE, viewportHeight - SAFE_EDGE)
  const sourceBottom =
    mode === "button" || !text
      ? clamp(source.bottom, sourceTop, viewportHeight - SAFE_EDGE)
      : Math.min(sourceTop + 24, viewportHeight - SAFE_EDGE)
  const above = Math.max(0, sourceTop - SAFE_EDGE - ANCHOR_GAP)
  const below = Math.max(
    0,
    viewportHeight - SAFE_EDGE - sourceBottom - ANCHOR_GAP
  )
  return above >= below
    ? {
        left,
        width,
        side: "top",
        bottom: viewportHeight - sourceTop + ANCHOR_GAP,
        maxHeight: Math.min(desiredHeight, above),
      }
    : {
        left,
        width,
        side: "bottom",
        top: sourceBottom + ANCHOR_GAP,
        maxHeight: Math.min(desiredHeight, below),
      }
}
