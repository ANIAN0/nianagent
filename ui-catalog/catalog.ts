import type { CatalogMetadata } from "./catalog-types"
export type { CatalogEntry, CatalogMetadata } from "./catalog-types"
import manifest from "virtual:moon-ui-catalog"
import { readStorySection } from "./catalog-sections"
export const entries: CatalogMetadata[] = manifest.entries

export function readSelection(search = location.search) {
  const params = new URLSearchParams(search)
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
    stateId,
    selectedStateId: explicitState?.id,
    section,
    view: params.get("view") === "docs" ? "docs" : "canvas",
  }
}
