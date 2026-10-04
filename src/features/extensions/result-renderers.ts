import { lazy, type ComponentType, type LazyExoticComponent } from "react"
import type { ConversationToolCall } from "@/features/conversation/conversation-types"

export type ResultRendererProps = {
  payload: unknown
  tool: Readonly<
    Pick<
      ConversationToolCall,
      "id" | "name" | "source" | "status" | "input" | "result"
    >
  >
  /** Host-controlled material preview; no transport, queue, navigation or history owner. */
  onOpenPath?: (path: string) => Promise<void>
}
export type ResultRendererDeclaration = {
  kind: string
  version: number
  load: () => Promise<{ default: ComponentType<ResultRendererProps> }>
  component: LazyExoticComponent<ComponentType<ResultRendererProps>>
}
type PresentationModule = {
  results: { kind: string; version: number; component: string }[]
}

// Adding a presentation module and declaration requires no ToolCall or send-loop branch.
const modules = import.meta.glob<PresentationModule>(
  "../../extensions/*/manifest.json",
  { eager: true, import: "default" }
)
const loaders: Record<
  string,
  (() => Promise<{ default: ComponentType<ResultRendererProps> }>) | undefined
> = import.meta.glob<{
  default: ComponentType<ResultRendererProps>
}>("../../extensions/*/*-result.tsx")
const declarations: ResultRendererDeclaration[] = Object.entries(
  modules
).flatMap(([path, module]) => {
  if (!module || typeof module !== "object" || !Array.isArray(module.results))
    return []
  const directory = path.slice(0, path.lastIndexOf("/") + 1)
  return module.results.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.kind !== "string" ||
      !Number.isInteger(item.version) ||
      item.version < 1 ||
      typeof item.component !== "string" ||
      !/^[a-z0-9-]+-result\.tsx$/.test(item.component)
    )
      return []
    const load = loaders[directory + item.component]
    return load
      ? [
          {
            kind: item.kind,
            version: item.version,
            load,
            component: lazy(load),
          },
        ]
      : []
  })
})

export function findResultRenderer(kind: string, version: number) {
  const matches = declarations.filter(
    (item) => item.kind === kind && item.version === version
  )
  // Conflicts and unsupported versions preserve the original recorded text.
  return matches.length === 1 ? matches[0] : undefined
}
