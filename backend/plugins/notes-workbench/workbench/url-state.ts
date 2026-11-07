/** 地址 hash 即工作台状态：刷新恢复、可分享；页面深链由宿主内嵌视图与交付卡使用。 */
export type ViewMode = "canvas" | "docs"
export type PanelMode = "comments" | "controls"
export type WorkbenchHash = {
  pageId: string | null
  view: ViewMode
  panel: PanelMode
  stateId: string | null
  width: number | null
  height: number | null
}

export const initialHash: WorkbenchHash = {
  pageId: null,
  view: "canvas",
  panel: "comments",
  stateId: null,
  width: null,
  height: null,
}

const positiveInt = (value: string | null) => {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
const enumValue = <T extends string>(
  value: string | null,
  allowed: readonly T[]
): T | null =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : null

export function parseHash(hash: string): WorkbenchHash {
  const params = new URLSearchParams(hash.replace(/^#/, ""))
  return {
    pageId: params.get("page") || null,
    view: enumValue(params.get("view"), ["canvas", "docs"]) ?? initialHash.view,
    panel:
      enumValue(params.get("panel"), ["comments", "controls"]) ??
      initialHash.panel,
    stateId: params.get("state") || null,
    width: positiveInt(params.get("width")),
    height: positiveInt(params.get("height")),
  }
}

/** 省略默认值，保持地址可读；无任何状态时不写 hash。 */
export function serializeHash(value: WorkbenchHash): string {
  const params = new URLSearchParams()
  if (value.pageId) params.set("page", value.pageId)
  if (value.view !== initialHash.view) params.set("view", value.view)
  if (value.panel !== initialHash.panel) params.set("panel", value.panel)
  if (value.stateId) params.set("state", value.stateId)
  if (value.width) params.set("width", String(value.width))
  if (value.height) params.set("height", String(value.height))
  const query = params.toString()
  return query ? `#${query}` : ""
}

/** 用 replaceState 写 hash：不产生历史记录，也不触发本页 hashchange。 */
export function applyHash(value: WorkbenchHash): void {
  const next = serializeHash(value)
  if (serializeHash(parseHash(window.location.hash)) === next) return
  const url = `${window.location.pathname}${window.location.search}${next}`
  window.history.replaceState(null, "", url)
}
