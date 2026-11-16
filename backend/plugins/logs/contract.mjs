const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum })
export const logEntry = object({
  id: str("记录标识"),
  time: str("ISO时间"),
  source: str("mcp接入或tool调用"),
  plugin: str("所属插件"),
  tool: str("工具名"),
  status: str("started/succeeded/failed/cancelled/rejected 或服务事件"),
  durationMs: { anyOf: [integer(0), { type: "null" }] },
  callId: str("开始与结束共用调用ID"),
  client: str("客户端自报名称；缺少或不合格式为未提供，不代表认证身份"),
  input: str("明确安全摘要或字段类型长度"),
  result: str("明确安全摘要或字段类型长度"),
  error: str("安全分类说明，不存原始错误"),
})
// Authenticated actor/credential identifiers are audit metadata, never bearer credentials.
logEntry.properties.actorId = str("认证作者标识", { maxLength: 128 })
logEntry.properties.credentialId = str("凭据记录标识，不含凭据", {
  maxLength: 128,
})
export const logPage = object({
  entries: { type: "array", items: logEntry },
  total: integer(0),
  offset: integer(0),
  limit: integer(1, 100),
  issue: str("日志持久化故障"),
  retention: object({
    days: integer(1),
    maxEntries: integer(1),
    maxBytes: integer(1),
  }),
})
// T20-3：传输终态日志记录（G11 白名单字段；写侧与读取侧同一投影，不含原始载荷）
export const transportLogRecord = object(
  {
    schemaVersion: integer(1),
    timestamp: str("ISO时间", { maxLength: 32 }),
    level: str("debug/info/warn/error", { maxLength: 8 }),
    process: str("写入进程标识", { maxLength: 80 }),
    module: str("来源模块", { maxLength: 64 }),
    event: str("事件或操作名", { maxLength: 200 }),
    traceId: str("链路追踪ID", { maxLength: 128 }),
    operationId: str("操作ID", { maxLength: 64 }),
    durationMs: {
      anyOf: [integer(0), { type: "null" }],
      description: "耗时毫秒；缺失表示未记录",
    },
    outcome: str("committed/rejected/unknown 或空", { maxLength: 16 }),
    repeated: integer(1),
    error: {
      type: "object",
      description: "脱敏错误摘要；缺失表示无错误关联",
      properties: {
        code: str("错误码", { maxLength: 64 }),
        errorId: str("错误标识", { maxLength: 8 }),
        cause: str("脱敏摘要", { maxLength: 400 }),
        frames: str("脱敏调用位置，不含异常首行", { maxLength: 1600 }),
      },
      required: ["code", "errorId", "cause"],
      additionalProperties: false,
    },
  },
  [
    "schemaVersion",
    "timestamp",
    "level",
    "process",
    "module",
    "event",
    "traceId",
    "operationId",
    "outcome",
  ]
)
export const transportLogPage = object({
  records: { type: "array", items: transportLogRecord },
  dropped: integer(0),
  queued: integer(0),
  issue: str("日志持久化故障"),
})
const operation = (title, input, value, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "MCP 与工具日志",
  remote: false,
  effect: "只查询宿主持久日志；关闭查看插件不影响记录。",
  example,
  condition: "日志插件已启用，仅本机查询；时间使用ISO字符串，offset从0开始。",
  errors: "日志文件读取失败、记录过期或输入校验失败；不返回原始调用载荷。",
})
export const logsModule = {
  source: "backend/plugins/logs/host.mjs",
  storage:
    "data/logs/external-tools.json（宿主写入）；14天/10000条/8MiB先到为准；诊断日志为 data/logs/moon-node.jsonl 与 moon-rust.jsonl（各8MiB轮转保留一个.1、14天保留）",
  responsibility:
    "按时间、插件、工具和状态分页查看共享调用与MCP接入记录；按时间/module/errorId/traceId/级别关联查询Node/Rust诊断日志并主动导出脱敏记录。",
}
export const logsOperations = {
  query: operation(
    "分页筛选 MCP 与工具日志",
    object(
      {
        from: str("开始ISO时间", { maxLength: 32 }),
        to: str("结束ISO时间", { maxLength: 32 }),
        plugin: str("插件精确名称", { maxLength: 64 }),
        tool: str("工具精确名称", { maxLength: 128 }),
        status: str("状态精确名称", { maxLength: 32 }),
        offset: integer(0, 1000000),
        limit: integer(1, 100),
      },
      []
    ),
    logPage
  ),
  detail: operation(
    "读取日志详情",
    object({ id: str("日志ID", { maxLength: 64 }) }),
    object({ entry: logEntry, issue: str("日志故障") }),
    { id: "record-id" }
  ),
  operationQuery: operation(
    "查询传输终态日志",
    object(
      {
        traceId: str("按 traceId 精确过滤，空为不过滤", { maxLength: 128 }),
        module: str("来源模块", { maxLength: 64 }),
        errorId: str("错误标识", { maxLength: 8 }),
        from: str("开始ISO时间", { maxLength: 32 }),
        to: str("结束ISO时间", { maxLength: 32 }),
        level: str("按级别过滤（debug/info/warn/error），空为不过滤", {
          maxLength: 8,
        }),
        limit: integer(1, 500),
      },
      []
    ),
    transportLogPage,
    { traceId: "", level: "error", limit: 50 }
  ),
}
