import type { ReactNode } from "react"
import type { StorySection } from "./catalog-sections.js"

export type CatalogEntry = {
  id: string
  name: string
  layer: "基础组件" | "复合组件" | "组合验证" | "页面"
  stage: "structure" | "content"
  order: number
  pages: string[]
  group: string
  source: string
  description: string
  boundary: string
  story?: { goal: string; preconditions: string[]; result: string }
  standards: {
    id: string
    name: string
    rule: string
    reason: string
    check: string
  }[]
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
    section: StorySection
    expected: string
    steps: string[]
    knownIssue?: string
    render: () => ReactNode
  }[]
}

/** Documentation is static and available before the selected preview is imported. */
export type CatalogMetadata = Omit<CatalogEntry, "states"> & {
  states: Omit<CatalogEntry["states"][number], "render">[]
}
