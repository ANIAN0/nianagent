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

/** The source import map itself is deferred until the documentation asks for an implementation. */
export async function loadSource(
  entry: CatalogMetadata,
  signal?: AbortSignal
): Promise<string> {
  const loader = await import("./source-loader")
  return loader.loadSource(entry, signal)
}

export const symbolOf = (entry: CatalogMetadata) =>
  entry.source
    .split("/")
    .pop()!
    .replace(/\.tsx$/, "")
    .split("-")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("")
export function dependenciesOf(entry: CatalogMetadata) {
  const ids = new Set(manifest.dependencies[entry.id] ?? [])
  return entries.filter((candidate) => ids.has(candidate.id))
}
export const consumersOf = (entry: CatalogMetadata) =>
  entries.filter((candidate) =>
    manifest.dependencies[candidate.id]?.includes(entry.id)
  )

export function catalogUrl(entry: CatalogMetadata, state?: string) {
  return `?${new URLSearchParams({ component: entry.id, ...(state ? { state } : { view: "docs" }) })}`
}
export function readSelection(search = location.search) {
  const params = new URLSearchParams(search)
  const pageFilter =
    params.get("page") === "对话" ? "会话" : (params.get("page") ?? "")
  const component = params.get("component") ?? "prompt-input"
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
    view:
      params.get("view") === "docs" || !params.has("state") ? "docs" : "canvas",
  }
}
