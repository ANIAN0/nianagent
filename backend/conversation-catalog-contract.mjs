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
  pinned: {
    type: "boolean",
    description: "是否由用户置顶；置顶不改变时间排序键",
  },
  archived: {
    type: "boolean",
    description: "是否已归档；归档会话默认不出现在列表",
  },
  lastMessage: text("最近消息摘要，最多 2000 字符", { maxLength: 2000 }),
  lastError: text("最后一次运行错误；正常时为空"),
  runId: text("当前或最后一次运行标识；尚未运行时为空"),
  lineage: object({
    sourceSessionId: id,
    sourceTitle: text("来源会话标题"),
    sourceEntryId: text("来源Pi已完成回复标识"),
  }),
}
export const conversationRecordSchema = object(
  {
    ...properties,
    sessionFile: text("仅后端使用的 Pi JSONL 文件绝对路径；首次落盘前为空"),
    lastRequestId: text("内部：最后接受的客户端请求标识"),
    lastRequestFingerprint: text("内部：最后请求的 SHA-256，用于发送去重"),
  },
  [
    ...Object.keys(properties).filter((key) => key !== "lineage"),
    "sessionFile",
    "lastRequestId",
    "lastRequestFingerprint",
  ]
)
export const conversationSchemas = {
  ConversationSummary: object(
    {
      ...properties,
      pending: object({
        approvals: {
          type: "integer",
          minimum: 0,
          description: "等待用户决定的本次工具授权数量",
        },
        answers: {
          type: "integer",
          minimum: 0,
          description: "等待用户回应的插件确认、选择或输入数量",
        },
      }),
    },
    Object.keys(properties).filter((key) => key !== "lineage")
  ),
  ConversationFilter: object(
    {
      workspaceId: text("可选工作区标识", { minLength: 1, maxLength: 128 }),
      query: text("标题、工作目录或最近消息关键词；忽略大小写", {
        maxLength: 500,
      }),
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 500,
        description: "可选分页大小；缺省返回全部匹配条目。",
      },
      before: text(
        "可选分页游标：上一页最后一条的 updatedAt、pinned、archived 与 id，以 | 连接；返回排序位置严格靠后的条目。",
        { maxLength: 560 }
      ),
      archived: {
        type: "string",
        enum: ["hide", "all", "only"],
        description: "归档过滤；缺省 hide，只返回未归档会话。",
      },
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
    condition:
      "只读；置顶领先，其余按最后更新时间倒序（同刻按 id），归档仅当过滤要求时出现。缺省返回未归档的全部匹配条目；提供 limit/before 时按游标分页。空目录返回空列表，不填充模拟历史。",
    errors: "过滤参数无效、目录元数据损坏或不可读取、请求已取消。",
    effect:
      "无写入；结果包含执行状态、未读标记与当前待处理数量。审批或回答创建后可见，应答、到期、停止或重启后清除。待处理数量独立于持久化 revision 与排序。",
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
  conversationRename: {
    module: "会话列表",
    method: "conversationCatalog.rename",
    args: ["id", "title", "$signal"],
    request: object({
      id,
      title: text("新标题", { minLength: 1, maxLength: 400 }),
    }),
    response: { $ref: "ConversationSummary" },
    title: "重命名会话",
    input: ["id", "title"],
    result: "ConversationSummary",
    condition: "幂等；标题未变化时无额外写入。重命名不改变 updatedAt 排序键。",
    errors: "会话不存在、标题无效、存储失败、提交前取消。",
    effect: "锁内原子更新标题并递增版本；不改变未读标记。",
    example: { id: "sample-conversation", title: "新标题" },
  },
  conversationSetPinned: {
    module: "会话列表",
    method: "conversationCatalog.setPinned",
    args: ["id", "pinned", "$signal"],
    request: object({
      id,
      pinned: { type: "boolean", description: "目标置顶状态" },
    }),
    response: { $ref: "ConversationSummary" },
    title: "设置会话置顶",
    input: ["id", "pinned"],
    result: "ConversationSummary",
    condition: "幂等；状态未变化时无额外写入。置顶不改变 updatedAt 排序键。",
    errors: "会话不存在、参数无效、存储失败、提交前取消。",
    effect: "锁内原子更新置顶并递增版本；列表排序置顶领先。",
    example: { id: "sample-conversation", pinned: true },
  },
  conversationSetArchived: {
    module: "会话列表",
    method: "conversationCatalog.setArchived",
    args: ["id", "archived", "$signal", "expectedRunId"],
    request: object(
      {
        id,
        archived: { type: "boolean", description: "目标归档状态" },
        expectedRunId: text("调用方确认的运行标识；空字符串表示从未运行", {
          maxLength: 128,
          pattern: "^[a-zA-Z0-9_-]*$",
        }),
      },
      ["id", "archived"]
    ),
    response: { $ref: "ConversationSummary" },
    title: "设置会话归档",
    input: ["id", "archived"],
    result: "ConversationSummary",
    condition:
      "幂等；状态未变化时无额外写入。运行中、停止中或有待处理请求时拒绝归档。可用 expectedRunId 防止确认后归档其他运行。归档不改变 updatedAt。",
    errors:
      "会话不存在、运行已变化、会话尚有执行或待处理请求、参数无效、存储失败、提交前取消。",
    effect: "锁内原子更新归档并递增版本；列表默认隐藏已归档会话。",
    example: { id: "sample-conversation", archived: true },
  },
}
