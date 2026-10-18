import { profileLocalStorage as localStorage } from "@/lib/rpc/profile-storage"
export type PluginTab = {
  pluginId: string
  id: string
  resource?: string
  title?: string
  payload?: unknown
}
export type PluginSidebarLayout = {
  tabs: PluginTab[]
  selected: string
  expanded: boolean
  guide: boolean
  width: number
}
export const GUIDE = "@guide"
export const tabKey = (tab: Pick<PluginTab, "pluginId" | "id" | "resource">) =>
  JSON.stringify([tab.pluginId, tab.id, tab.resource || ""])
const layouts = new Map<string, PluginSidebarLayout>()
const storageKey = (sessionId: string) => `moon.plugin-sidebar.v1.${sessionId}`
const empty = (): PluginSidebarLayout => ({
  tabs: [],
  selected: "",
  expanded: false,
  guide: false,
  width: 420,
})

export function readSidebarLayout(sessionId: string): PluginSidebarLayout {
  const retained = layouts.get(sessionId)
  if (retained) return retained
  try {
    const value = JSON.parse(
      localStorage.getItem(storageKey(sessionId)) || "null"
    )
    if (
      value &&
      Array.isArray(value.tabs) &&
      typeof value.selected === "string"
    ) {
      const legacy = value.tabs.find(
        (tab: PluginTab) =>
          tab && `${tab.pluginId}/${tab.id}` === value.selected
      )
      if (legacy) value.selected = tabKey(legacy)
    }
    if (
      value &&
      Array.isArray(value.tabs) &&
      value.tabs.every(
        (tab: PluginTab) =>
          tab &&
          typeof tab.pluginId === "string" &&
          typeof tab.id === "string" &&
          (tab.resource === undefined || typeof tab.resource === "string") &&
          (tab.title === undefined || typeof tab.title === "string")
      ) &&
      new Set(value.tabs.map(tabKey)).size === value.tabs.length &&
      typeof value.selected === "string" &&
      typeof value.expanded === "boolean" &&
      typeof value.guide === "boolean" &&
      typeof value.width === "number" &&
      Number.isFinite(value.width) &&
      value.width >= 320 &&
      value.width <= 720 &&
      (value.selected === "" ||
        (value.guide && value.selected === GUIDE) ||
        value.tabs.some((tab: PluginTab) => tabKey(tab) === value.selected))
    ) {
      const layout: PluginSidebarLayout = {
        ...value,
        tabs: value.tabs.map(
          ({ pluginId, id, resource, title }: PluginTab) => ({
            pluginId,
            id,
            resource,
            title,
          })
        ),
      }
      layouts.set(sessionId, layout)
      return layout
    }
  } catch {
    /* Storage is optional; a session still works in memory. */
  }
  return empty()
}

export function saveSidebarLayout(
  sessionId: string,
  layout: PluginSidebarLayout
) {
  layouts.set(sessionId, layout)
  try {
    localStorage.setItem(
      storageKey(sessionId),
      JSON.stringify({
        ...layout,
        // Persist identity and title, never file contents or transient navigation.
        tabs: layout.tabs.map(({ pluginId, id, resource, title }) => ({
          pluginId,
          id,
          resource,
          title,
        })),
      })
    )
  } catch {
    /* Keep the current window usable if storage is unavailable. */
  }
}

export function openSidebarTab(
  layout: PluginSidebarLayout,
  tab: PluginTab
): PluginSidebarLayout {
  const key = tabKey(tab)
  const exists = layout.tabs.some((item) => tabKey(item) === key)
  return {
    ...layout,
    // The guide is a doorway: opening its destination replaces it.
    guide: layout.selected === GUIDE ? false : layout.guide,
    expanded: true,
    selected: key,
    tabs: exists
      ? layout.tabs.map((item) =>
          tabKey(item) === key && tab.payload !== undefined
            ? { ...item, payload: tab.payload }
            : item
        )
      : [...layout.tabs, tab],
  }
}

export function closeSidebarTab(
  layout: PluginSidebarLayout,
  key: string
): PluginSidebarLayout {
  const index = layout.tabs.findIndex((tab) => tabKey(tab) === key)
  if (index < 0 && key !== GUIDE) return layout
  if (key === GUIDE && !layout.tabs.length) return layout
  const tabs = layout.tabs.filter((tab) => tabKey(tab) !== key)
  const guide = key === GUIDE ? false : layout.guide
  const selected =
    layout.selected !== key
      ? layout.selected
      : tabs.length
        ? tabKey(tabs[Math.min(Math.max(index, 0), tabs.length - 1)])
        : guide
          ? GUIDE
          : ""
  return {
    ...layout,
    tabs,
    guide,
    selected,
    expanded: layout.expanded && !!selected,
  }
}
