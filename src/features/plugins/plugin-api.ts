import type * as React from "react"
import type { ComponentType } from "react"
import type { Button } from "@/components/ui/button"
import type { Input } from "@/components/ui/input"
import type { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import type { Badge } from "@/components/ui/badge"
import type {
  MaterialReference,
  ExtensionPresentation,
} from "@/contracts/rpc.generated"

/** Moon Web API 1. Only plugin-owned context crosses the public boundary. */
export type PluginContext = {
  pluginId: string
  sessionId: string
  cwd: string
  active: boolean
  payload?: unknown
  /** Plugin-owned resource identity retained with this host tab. */
  resource?: string
  signal: AbortSignal
  openTab: (id: string, payload?: unknown) => void
  /** Close only this plugin's tab; omitted id means the current owned tab. */
  closeTab: (id?: string, resource?: string) => void
  reference: (material: MaterialReference) => void
  call: <T>(
    operation: string,
    input: object,
    signal?: AbortSignal
  ) => Promise<T>
}
export type PluginPageProps = { pluginId: string }
export type PluginDeliveryProps = {
  delivery: ExtensionPresentation
  deliveries?: ExtensionPresentation[]
  context: PluginContext
}
export type PluginWebModule = {
  id: string
  apiVersion: 1
  pages?: { id: string; component: ComponentType<PluginPageProps> }[]
  tabs?: {
    id: string
    component: ComponentType<PluginContext>
    icon?: ComponentType<{ className?: string }>
    description?: string
    /** Resource tabs open from content; page tabs appear in the host guide. */
    resourceKey?: (payload: unknown) => string
    title?: (resource: string) => string
  }[]
  deliveries?: {
    id: string
    version: number
    component: ComponentType<PluginDeliveryProps>
  }[]
  connectSession?: (context: PluginContext) => void | (() => void)
  dispose?: () => void
}
export type PluginWebSDK = {
  apiVersion: 1
  pluginId: string
  React: typeof React
  ui: {
    Button: typeof Button
    Input: typeof Input
    Field: typeof Field
    FieldLabel: typeof FieldLabel
    FieldDescription: typeof FieldDescription
    Badge: typeof Badge
  }
  call: <T>(
    operation: string,
    input: object,
    sessionId?: string,
    signal?: AbortSignal
  ) => Promise<T>
  resource: (path: string, signal?: AbortSignal) => Promise<string>
}
export type PluginWebFactory = (
  sdk: PluginWebSDK
) => PluginWebModule | Promise<PluginWebModule>
