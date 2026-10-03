// Authoritative metadata DTO and operation definitions, composed by schema.mjs
// and contract.mjs. Pi's JSONL transcript is intentionally not exposed here.
const text = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const id = text("稳定会话标识", { pattern: "^[a-zA-Z0-9_-]{1,128}$" })
const properties = {
  id,
  workspaceId: text("工作区稳定标识", { minLength: 1, maxLength: 128 }),
  cwd: text("会话固定工作目录的绝对路径", { minLength: 1 }),
  title: text("首条用户消息生成的会话标题", { minLength: 1, maxLength: 400 }),
  createdAt: text("创建时间，ISO 8601"),
  updatedAt: text("最后内容或运行状态变化时间；标记已读不改变排序"),
  status: text("后端真实运行状态；未读状态由 unread 单独表达", {
    enum: ["idle", "running", "stopping", "completed", "failed"],
  }),
  unread: { type: "boolean", description: "是否有尚未读取的运行结果" },
  revision: {
    type: "integer",
    minimum: 1,
    description: "单调递增版本；已读更新不覆盖较新的结果",
  },
  modelId: text("最后使用的 Moon 模型选择标识"),
  thinking: text("最后使用的 Pi 思考等级"),
  lastMessage: text("最近消息摘要，最多 2000 字符", { maxLength: 2000 }),
  lastError: text("最后一次运行错误；正常时为空"),
  runId: text("当前或最后一次运行标识；尚未运行时为空"),
}
export const conversationRecordSchema = object({
  ...properties,
  sessionFile: text("仅后端使用的 Pi JSONL 文件绝对路径；首次落盘前为空"),
  lastRequestId: text("内部：最后接受的客户端请求标识"),
  lastRequestFingerprint: text("内部：最后请求的 SHA-256，用于发送去重"),
})
export const conversationSchemas = {
  ConversationSummary: object(properties),
  ConversationFilter: object(
    {
      workspaceId: text("可选工作区标识", { minLength: 1, maxLength: 128 }),
      query: text("标题、工作目录或最近消息关键词；忽略大小写", {
        maxLength: 500,
      }),
    },
    []
  ),
}
export const conversationOperations = {
  conversationList: {
    module: "会话列表",
    method: "conversationCatalog.list",
    args: ["filter", "$signal"],
    request: object({ filter: { $ref: "ConversationFilter" } }, []),
    response: { type: "array", items: { $ref: "ConversationSummary" } },
    title: "读取会话列表",
    input: ["filter?"],
    result: "ConversationSummary[]",
    condition: "只读；按最后更新时间倒序。空目录返回空列表，不填充模拟历史。",
    errors: "过滤参数无效、目录元数据损坏或不可读取、请求已取消。",
    effect: "无写入；结果包含真实状态及未读标记，不包含 Pi 会话文件路径。",
    example: { filter: { query: "" } },
  },
  conversationInfo: {
    module: "会话列表",
    method: "conversationCatalog.info",
    args: ["id", "$signal"],
    request: object({ id }),
    response: { anyOf: [{ $ref: "ConversationSummary" }, { type: "null" }] },
    title: "读取会话摘要",
    input: ["id"],
    result: "ConversationSummary | null",
    condition: "只读；不存在返回 null。正文与消息由 conversationRead 提供。",
    errors: "标识无效、目录元数据损坏或不可读取、请求已取消。",
    effect: "无写入，不改变未读标记。",
    example: { id: "sample-conversation" },
  },
  conversationMarkRead: {
    module: "会话列表",
    method: "conversationCatalog.markRead",
    args: ["id", "revision", "$signal"],
    request: object({
      id,
      revision: {
        type: "integer",
        minimum: 1,
        description: "页面已展示的摘要版本",
      },
    }),
    response: { $ref: "ConversationSummary" },
    title: "标记会话已读",
    input: ["id", "revision"],
    result: "ConversationSummary",
    condition:
      "仅在版本仍等于已展示版本时清除 unread；新结果到达则保留未读并返回最新摘要。重复调用无额外写入。",
    errors: "会话不存在、参数无效、存储失败、提交前取消。",
    effect: "锁内原子清除已读标记，保留运行状态和时间排序；提交后取消不回滚。",
    example: { id: "sample-conversation", revision: 1 },
  },
}
