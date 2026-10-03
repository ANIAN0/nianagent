import type { CatalogMetadata } from "./catalog-types"
export type { CatalogEntry, CatalogMetadata } from "./catalog-types"
import manifest from "virtual:moon-ui-catalog"
export const entries: CatalogMetadata[] = manifest.entries

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
  const component = params.get("component") ?? "home-page"
  const entry = entries.find((item) => item.id === component)
  const stateId = params.get("state") ?? entry?.states[0]?.id ?? "default"
  return {
    entry,
    state: entry?.states.find((item) => item.id === stateId),
    component,
    stateId,
    view:
      params.get("view") === "docs" || !params.has("state") ? "docs" : "canvas",
  }
}
