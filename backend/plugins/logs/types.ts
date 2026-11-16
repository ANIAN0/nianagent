export type LogEntry = {
  actorId?: string
  credentialId?: string
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
export type TransportLogRecord = {
  schemaVersion: number
  timestamp: string
  level: string
  process: string
  module: string
  event: string
  traceId: string
  operationId: string
  durationMs?: number
  outcome: string
  repeated?: number
  error?: { code: string; errorId: string; cause: string; frames?: string }
}
export type TransportLogFilter = {
  module?: string
  errorId?: string
  from?: string
  to?: string
  traceId?: string
  level?: string
  limit?: number
}
export type TransportLogPage = {
  records: TransportLogRecord[]
  dropped: number
  queued: number
  issue: string
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
  operationQuery(
    input: TransportLogFilter,
    signal?: AbortSignal
  ): Promise<TransportLogPage>
}
