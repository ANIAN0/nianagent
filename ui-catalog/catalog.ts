import type { ReactNode } from "react"
export type CatalogEntry = {
  id: string
  name: string
  layer: "基础组件" | "复合组件" | "页面"
  group: string
  source: string
  description: string
  boundary: string
  props?: { name: string; type: string; default: string; description: string }[]
  inputs: string[]
  events: string[]
  composition: string[]
  consumers: string[]
  viewport: { width: number; height: number }
  states: {
    id: string
    name: string
    condition: string
    expected: string
    render: () => ReactNode
  }[]
}
const modules = import.meta.glob<{ default: CatalogEntry }>(
  "../src/**/*.catalog.tsx",
  { eager: true }
)
export const entries = Object.values(modules).map((module) => module.default)
const ids = new Set<string>()
for (const entry of entries) {
  if (ids.has(entry.id)) throw new Error(`组件标识重复：${entry.id}`)
  ids.add(entry.id)
  if (
    !entry.states.length ||
    new Set(entry.states.map((state) => state.id)).size !== entry.states.length
  )
    throw new Error(`组件状态无效：${entry.id}`)
}
const sources = import.meta.glob<string>("../src/**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
})
export const sourceOf = (entry: CatalogEntry) =>
  sources[`../${entry.source}`] ?? ""
export const symbolOf = (entry: CatalogEntry) =>
  entry.source
    .split("/")
    .pop()!
    .replace(/\.tsx$/, "")
    .split("-")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("")
export function dependenciesOf(entry: CatalogEntry) {
  const imports = [
    ...sourceOf(entry).matchAll(
      /import\s+(?!type\b)[\s\S]*?from\s+["']([^"']+)["']/g
    ),
  ]
  const paths = imports
    .filter((match) => {
      const names = match[0].split("from")[0]!.match(/\b[A-Z]\w*/g) ?? []
      return names.some((name) =>
        new RegExp(`<${name}(?:[\\s/>.])`).test(sourceOf(entry))
      )
    })
    .map((match) => {
      const target = match[1]!.startsWith("@/")
        ? `src/${match[1]!.slice(2)}`
        : `${entry.source.slice(0, entry.source.lastIndexOf("/"))}/${match[1]}`
      const parts: string[] = []
      for (const part of target.split("/")) {
        if (part === "..") parts.pop()
        else if (part !== ".") parts.push(part)
      }
      return `${parts.join("/")}.tsx`
    })
  return entries.filter((candidate) => paths.includes(candidate.source))
}
export const consumersOf = (entry: CatalogEntry) =>
  entries.filter((candidate) =>
    dependenciesOf(candidate).some((dependency) => dependency.id === entry.id)
  )
export function catalogUrl(entry: CatalogEntry, state?: string) {
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
