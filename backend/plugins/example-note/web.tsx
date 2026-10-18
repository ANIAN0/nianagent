import * as React from "react"
import createPlugin from "./web.mjs"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
// Bundled and independently installed forms execute the same public frontend factory.
export default createPlugin({
  pluginId: "example-note",
  React,
  apiVersion: 1,
}) as PluginWebModule
