import type { CatalogMetadata } from "./catalog-types"
export type { CatalogEntry, CatalogMetadata } from "./catalog-types"
import manifest from "virtual:moon-ui-catalog"
import { readStorySection } from "./catalog-sections"
export const entries: CatalogMetadata[] = manifest.entries

/** Registered source relationships supplement explicit page associations. */
export function associatedPagesOf(entry: CatalogMetadata) {
  const pages = new Set(entry.pages)
  for (const owner of entries) {
    if (
      owner.layer !== "页面" &&
      !(
        owner.layer === "复合组件" &&
        owner.pages.includes("会话") &&
        !owner.pages.includes("首页")
      )
    )
      continue
    const visited = new Set<string>()
    const pending = [...(manifest.dependencies[owner.id] ?? [])]
    while (pending.length) {
      const id = pending.pop()!
      if (visited.has(id)) continue
      visited.add(id)
      if (id === entry.id) owner.pages.forEach((page) => pages.add(page))
      pending.push(...(manifest.dependencies[id] ?? []))
    }
  }
  return [...pages]
}

export function readSelection(search = location.search) {
  const params = new URLSearchParams(search)
  const pageFilter =
    params.get("page") === "对话" ? "会话" : (params.get("page") ?? "")
  const component = params.get("component") ?? ""
  const entry = entries.find((item) => item.id === component)
  const explicitState = entry?.states.find(
    (item) => item.id === params.get("state")
  )
  const section =
    entry?.layer === "复合组件"
      ? (explicitState?.section ?? readStorySection(params.get("section")))
      : undefined
  const stateId =
    explicitState?.id ??
    entry?.states.find((item) => !section || item.section === section)?.id ??
    "default"
  return {
    entry,
    state: entry?.states.find((item) => item.id === stateId),
    component,
    pageFilter,
    stateId,
    selectedStateId: explicitState?.id,
    section,
    view: params.get("view") === "docs" ? "docs" : "canvas",
  }
}
