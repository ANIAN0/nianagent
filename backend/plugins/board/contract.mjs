// Pure metadata. Importing this catalog must never activate the Board plugin or open SQLite.
export const READ_ONLY_TOOLS = new Set([
  "list_channels",
  "read_channel",
  "read_thread",
  "list_tasks",
])

export const DESTRUCTIVE_TOOLS = new Set(["fail_task"])

export const object = (
  properties = {},
  required = Object.keys(properties)
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
export const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const bool = (description) => ({ type: "boolean", description })
export const int = (description, minimum = 0, maximum) => ({
  type: "integer",
  description,
  minimum,
  ...(maximum !== undefined ? { maximum } : {}),
})
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] })

const toolItem = object({
  name: str("工具本地稳定标识"),
  description: str("工具说明"),
  effect: str("读写分类", { enum: ["read", "write"] }),
  destructive: bool("是否属于破坏性操作"),
  enabled: bool("当前模式下是否允许执行"),
})

const channelItem = object({
  name: str("频道名称"),
  messageCount: nullable(int("消息数量", 0)),
})

const messageItem = object({
  id: str("消息 ID"),
  channel: str("所属频道"),
  threadId: nullable(str("所属线程 ID")),
  text: str("消息正文"),
  by: nullable(str("发帖身份")),
  createdAt: nullable(str("创建时间")),
})

const taskItem = object({
  id: str("任务线程 ID"),
  channel: str("所属频道"),
  text: str("任务内容"),
  status: str("任务状态"),
  owner: nullable(str("认领或指派身份")),
  createdAt: nullable(str("创建时间")),
})

export const boardStatus = object({
  boardName: str("当前本机看板名称"),
  defaultChannel: str("默认频道"),
  defaultActor: str("默认发帖身份"),
  storageDir: str("SQLite 存储目录"),
  readOnly: bool("是否处于只读模式"),
  channelCount: int("当前频道数", 0),
  taskCount: int("当前任务数", 0),
  tools: { type: "array", items: toolItem, maxItems: 64 },
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "Board 插件",
  remote: false,
  effect,
  example,
  condition: "Board 插件已启用，仅本机插件详情页可调用管理操作。",
  errors: "参数不合法、只读模式拒绝写入、任务租约冲突或本地 SQLite 存储失败。",
})

export const boardModule = {
  source: "backend/plugins/board/host.mjs",
  storage: "plugins/board/boards/（node:sqlite 单文件落盘）",
  responsibility:
    "在 Moon 本机宿主内运行 @vercel/board/backend-local，为多 Agent 提供频道消息、线程回复与租约任务板能力。",
}

export const boardOperations = {
  status: operation(
    "读取 Board 插件状态与统计",
    object(),
    boardStatus,
    "读取当前看板名称、存储路径、频道/任务计数及可用工具清单。"
  ),
  listChannels: operation(
    "列出当前看板频道",
    object(),
    object({ channels: { type: "array", items: channelItem } }),
    "列出本机看板中的所有频道。"
  ),
  readChannel: operation(
    "读取指定频道消息",
    object(
      {
        channel: str("频道名称"),
        limit: int("最多返回条数", 1, 100),
      },
      []
    ),
    object({
      channel: str("频道名称"),
      messages: { type: "array", items: messageItem },
    }),
    "读取指定频道的最近消息列表。",
    { channel: "general", limit: 30 }
  ),
  postMessage: operation(
    "向指定频道发布消息",
    object(
      {
        channel: str("频道名称"),
        text: str("消息正文", { minLength: 1, maxLength: 32768 }),
        actor: str("发帖身份标识"),
      },
      ["text"]
    ),
    object({ message: messageItem }),
    "在指定频道发布一条新消息。",
    { channel: "general", text: "Hello from Moon Board", actor: "moon" }
  ),
  listTasks: operation(
    "列出看板任务",
    object(
      {
        channel: str("按频道过滤"),
        status: str("按状态过滤（如 ready/claimed/completed/failed）"),
        limit: int("最多返回条数", 1, 100),
      },
      []
    ),
    object({ tasks: { type: "array", items: taskItem } }),
    "列出本机看板中的任务列表。",
    { channel: "general", limit: 30 }
  ),
  createTask: operation(
    "创建看板任务",
    object(
      {
        channel: str("频道名称"),
        text: str("任务描述", { minLength: 1, maxLength: 32768 }),
        actor: str("创建者身份标识"),
      },
      ["text"]
    ),
    object({ task: taskItem }),
    "在指定频道创建一个可被 Agent 认领的异步任务。",
    { channel: "general", text: "Review latest changes", actor: "moon" }
  ),
}
