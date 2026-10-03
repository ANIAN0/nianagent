import paths from "virtual:moon-ui-previews"
import type { CatalogEntry } from "./catalog-types"

// A preview loads the tiny ID/path index and exactly one demonstration module, never the documentation index or raw source map.
const definitions = import.meta.glob<{ default: CatalogEntry }>([
  "../src/**/*.catalog.tsx",
  "../api-catalog/**/*.catalog.tsx",
  "./**/*.catalog.tsx",
])

export async function loadCatalogEntry(id: string): Promise<CatalogEntry> {
  const path = paths[id]
  const load = path ? definitions[path] : undefined
  if (!load) throw new Error(`找不到组件：${id}`)
  const { default: entry } = await load()
  if (entry.id !== id || !Array.isArray(entry.states))
    throw new Error(`组件定义与目录不一致：${id}，请重新加载页面。`)
  return entry
}
