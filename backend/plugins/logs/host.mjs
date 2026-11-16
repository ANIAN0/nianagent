import { redactSensitive } from "../../redact.mjs"
import { logsOperations } from "./contract.mjs"
// T20-3：读取侧按写侧同一白名单再次投影（主动脱敏导出的数据来源）——
// 出端口字段与 G11 写入白名单一一对应，写入侧缺陷夹带的额外字段不会离开宿主
const transportRecord = (record) => ({
  schemaVersion: record.schemaVersion,
  timestamp: record.timestamp,
  level: record.level,
  process: record.process,
  module: record.module,
  event: record.event,
  traceId: record.traceId,
  operationId: record.operationId,
  ...(Number.isFinite(record.durationMs)
    ? { durationMs: record.durationMs }
    : {}),
  outcome: record.outcome ?? "",
  ...(record.repeated ? { repeated: record.repeated } : {}),
  ...(record.error && typeof record.error === "object"
    ? {
        error: {
          code: record.error.code,
          errorId: record.error.errorId,
          cause: redactSensitive(record.error.cause),
          ...(record.error.frames
            ? { frames: redactSensitive(record.error.frames) }
            : {}),
        },
      }
    : {}),
})
export async function activate(host) {
  const operation = (name, action) => ({
    ...logsOperations[name],
    execute: async (input, _context, signal) => {
      signal?.throwIfAborted()
      const value = await action(input)
      signal?.throwIfAborted()
      return { value }
    },
  })
  return {
    operations: {
      query: operation("query", (input) => host.logs.query(input)),
      detail: operation("detail", ({ id }) => host.logs.detail(id)),
      operationQuery: operation("operationQuery", async (input) => {
        if (!host.operationLog?.query || !host.operationLog?.status)
          throw new Error("传输终态日志端口未装配。")
        const records = await host.operationLog.query(input)
        const status = host.operationLog.status()
        return {
          records: records.map(transportRecord),
          dropped: status.dropped,
          queued: status.queued,
          issue: status.issue,
        }
      }),
    },
    status: () => host.logs.issue || "MCP 与对外工具日志",
    close() {},
  }
}
