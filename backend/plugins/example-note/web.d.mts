import type * as React from "react"
import type { PluginWebModule } from "../../../src/features/plugins/plugin-api"
export default function createPlugin(sdk: {
  pluginId: string
  React: typeof React
  apiVersion: number
}): PluginWebModule
