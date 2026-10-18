export type SharedToolDescriptor = {
  name: string
  plugin: string
  generation: number
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean>
}
export type McpServiceStatus = {
  running: boolean
  url: string
  port: number
  revision: number
  selected: string[]
  tools: SharedToolDescriptor[]
  issue: string
  logIssue: string
  protocol: string
}
export type McpServiceClient = {
  read(signal?: AbortSignal): Promise<McpServiceStatus>
  save(
    input: { revision: number; port: number; selected: string[] },
    signal?: AbortSignal
  ): Promise<McpServiceStatus>
  reveal(signal?: AbortSignal): Promise<{ token: string }>
  reset(revision: number, signal?: AbortSignal): Promise<McpServiceStatus>
}
