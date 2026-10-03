import type { CatalogMetadata } from "./catalog"

export type ViewportAxis = "width" | "height"
export const viewportLimits = {
  width: { minimum: 240, maximum: 2560 },
  height: { minimum: 96, maximum: 1600 },
} as const

/** One decimal-integer policy serves URL restoration and input commits. */
export function parseViewportDimension(
  value: string | null,
  axis: ViewportAxis
): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  const { minimum, maximum } = viewportLimits[axis]
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

export function readViewportDimension(
  value: string | null,
  axis: ViewportAxis,
  fallback: number
): number {
  return (
    parseViewportDimension(value, axis) ??
    parseViewportDimension(String(fallback), axis) ??
    viewportLimits[axis].minimum
  )
}

type CatalogTarget = Pick<CatalogMetadata, "id" | "states" | "viewport">
type CurrentSelection = {
  component: string
  stateId: string
  width: number
  height: number
  theme: "light" | "dark"
}

/** Recovery URLs never retain a state absent from the target component. */
export function buildCatalogHref(
  entry: CatalogTarget,
  current: CurrentSelection,
  requestedState?: string
): string {
  const candidate =
    requestedState ??
    (current.component === entry.id ? current.stateId : undefined)
  const stateId = entry.states.some((state) => state.id === candidate)
    ? candidate
    : entry.states[0]?.id
  const params = new URLSearchParams({
    component: entry.id,
    view: requestedState ? "canvas" : "docs",
    theme: current.theme,
    width: String(
      current.component === entry.id ? current.width : entry.viewport.width
    ),
    height: String(
      current.component === entry.id ? current.height : entry.viewport.height
    ),
  })
  if (stateId) params.set("state", stateId)
  return `?${params}`
}
