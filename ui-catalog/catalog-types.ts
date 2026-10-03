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

/** Documentation is static and available before the selected preview is imported. */
export type CatalogMetadata = Omit<CatalogEntry, "states"> & {
  states: Omit<CatalogEntry["states"][number], "render">[]
}
