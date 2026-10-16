import type { ComponentType, ReactNode } from "react"
import type { MaterialReference } from "@/contracts/rpc.generated"
import type { ResultRendererProps } from "@/features/extensions/result-renderers"

export type PluginWorkspaceProps = { sessionId: string; cwd: string; active: boolean; onMaterial: (material: MaterialReference) => void; children: ReactNode }
export type PluginWebModule = {
  id: string
  Workspace?: ComponentType<PluginWorkspaceProps>
  Page?: ComponentType<{ pluginId: string }>
  results?: { kind: string; version: number; persistent?: boolean; component: ComponentType<ResultRendererProps> }[]
}
const modules = import.meta.glob<PluginWebModule>("../../../backend/plugins/*/web.tsx", { eager: true })
export const pluginWebModules = Object.values(modules)
export function findPluginResult(kind: string, version: number) {
  const entries = pluginWebModules.flatMap(module => module.results || []).filter(item => item.kind === kind && item.version === version)
  return entries.length === 1 ? entries[0] : undefined
}
