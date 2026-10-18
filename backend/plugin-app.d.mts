/** Optional application activation result, independent of Pi chat tool factories. */
export type SharedToolResult = {
  /** Host accepts at most 16 MiB of encoded JSON; image data must be base64. */
  content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[]
  /** A JSON object: finite numbers, no functions/cycles, at most 32 levels. */
  structuredContent?: Record<string, unknown>
  isError?: boolean
}
export type SharedTool = {
  /** Local stable name. Host exports <plugin-id>__<name>. */
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Explicit author declaration; absent/false tools are never exported. */
  shareable: true
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execute(
    input: Record<string, unknown>,
    context: { callId: string; source: "mcp" },
    signal: AbortSignal
  ): Promise<SharedToolResult>
  /** Explicitly safe text only; default records field names/types/lengths. */
  summarize?(values: {
    phase: "input" | "result"
    input?: unknown
    result?: SharedToolResult
  }): string
}
export type PluginApplication = {
  sharedTools?: SharedTool[]
  close(): Promise<void> | void
  quiesce?(): Promise<void> | void
  resume?(): Promise<void> | void
}
