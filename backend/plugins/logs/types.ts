export type LogEntry = {
  id: string
  time: string
  source: string
  plugin: string
  tool: string
  status: string
  durationMs: number | null
  callId: string
  client: string
  input: string
  result: string
  error: string
}
export type LogFilter = {
  from: string
  to: string
  plugin: string
  tool: string
  status: string
}
export type LogPage = {
  entries: LogEntry[]
  total: number
  offset: number
  limit: number
  issue: string
  retention: { days: number; maxEntries: number; maxBytes: number }
}
export type LogsClient = {
  query(
    input: Partial<LogFilter> & { offset: number; limit: number },
    signal?: AbortSignal
  ): Promise<LogPage>
  detail(
    id: string,
    signal?: AbortSignal
  ): Promise<{ entry: LogEntry; issue: string }>
}
