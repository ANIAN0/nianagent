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
    "data/logs/external-tools.json（宿主写入）；30天/10000条/8MiB先到为准",
  responsibility: "按时间、插件、工具和状态分页查看共享调用与MCP接入记录。",
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
}
