// Generated from backend/schema.mjs and backend/contract.mjs. Do not edit.
export type ConversationQueueItem = {
  /** 稳定会话、消息或提交标识 */
  id: string
  /** 稳定会话、消息或提交标识 */
  clientRequestId: string
  /** 本次原始文字 */
  text: string
  /**  */
  materials: MaterialReference[]
  /** 未进入历史的交付状态 */
  status: "pending" | "dispatching" | "failed"
  /** 下一处交付边界 */
  delivery: "followUp" | "steer"
  /** 失败原因，保留原项 */
  error: string
  /** 提交时间 */
  createdAt: string
}
export type ConversationQueue = {
  /** 队列乐观并发版本 */
  revision: number
  /** 会话级交付数量；下次边界生效 */
  mode: "single" | "all"
  /** 停止、终止失败、重启或材料失效后暂停 */
  paused: boolean
  /**  */
  items: ConversationQueueItem[]
  /** 已持久接受的提交回执，用于原请求核对，已交付/已删除仍保留 */
  acceptedRequestIds: string[]
}
export type MaterialReference = {
  /** 服务准备后返回的稳定材料标识 */
  id: string
  /** 材料原始名称 */
  name: string
  /** 材料类别 */
  kind: "附件" | "Skill"
  /** 实际交付方式 */
  type: "file" | "image" | "skill"
  /** 准备状态；非 ready 不可交付 */
  status: "preparing" | "ready" | "failed"
  /** 实际绝对路径或图片来源说明 */
  source: string
  /** 用途或来源摘要 */
  description?: string
  /** 图片实际 MIME 类型 */
  mimeType?: string
  /** 准备的图片字节数 */
  bytes?: number
  /** 材料失败的具体安全原因 */
  error?: string
  /** 固定图片缩略图；仅界面本地使用，不是请求必需字段 */
  thumbnail?: string
}
export type MaterialCatalog = {
  /** 当前会话真实工作目录 */
  cwd: string
  /**  */
  files: MaterialReference[]
  /**  */
  skills: MaterialReference[]
  /**  */
  diagnostics: string[]
}
export type MaterialPreview = {
  /** 材料标识 */
  id: string
  /** 材料名称 */
  name: string
  /** 当前文件、本次 Skill 内容或待发送/发送时的固定图片 */
  label: string
  /** 实际来源 */
  source: string
  /** 文本预览；不执行 HTML 或脚本 */
  content: string
  /** 图片 MIME */
  mimeType: string
  /** 保存图片的 base64 内容 */
  data: string
  /** 文本只读取前128KiB，明确非全文 */
  truncated: boolean
}
export type WorkspaceRecord = {
  /** 工作区稳定标识 */
  id: string
  /** 真实目录名称 */
  name: string
  /** realpath 解析的绝对目录路径 */
  path: string
  /** 本次读取时目录是否仍可访问 */
  available: boolean
  /** 目录失效说明；可用时为空 */
  unavailableReason: string
}
export type WorkspaceList = {
  /** 已登记工作区，包括失效目录 */
  items: WorkspaceRecord[]
  /** 上次选中的工作区，失效时仍保留标识 */
  selectedId: string | null
}
export type ConversationSummary = {
  /** 稳定会话标识 */
  id: string
  /** 工作区稳定标识 */
  workspaceId: string
  /** 会话固定工作目录的绝对路径 */
  cwd: string
  /** 首条用户消息生成的会话标题 */
  title: string
  /** 创建时间，ISO 8601 */
  createdAt: string
  /** 最后内容或运行状态变化时间；标记已读不改变排序 */
  updatedAt: string
  /** 后端真实运行状态；未读状态由 unread 单独表达 */
  status: "idle" | "running" | "stopping" | "completed" | "failed"
  /** 是否有尚未读取的运行结果 */
  unread: boolean
  /** 单调递增版本；已读更新不覆盖较新的结果 */
  revision: number
  /** 最后使用的 Moon 模型选择标识 */
  modelId: string
  /** 最后使用的 Pi 思考等级 */
  thinking: string
  /** 最近消息摘要，最多 2000 字符 */
  lastMessage: string
  /** 最后一次运行错误；正常时为空 */
  lastError: string
  /** 当前或最后一次运行标识；尚未运行时为空 */
  runId: string
}
export type ConversationFilter = {
  /** 可选工作区标识 */
  workspaceId?: string
  /** 标题、工作目录或最近消息关键词；忽略大小写 */
  query?: string
}
export type ConversationChatTool = {
  /** Pi toolCallId */
  id: string
  /** 工具名称 */
  name: string
  /** 工具来源 */
  source: string
  /** 实际执行状态 */
  status: "running" | "success" | "failed" | "stopped" | "not-run"
  /** 序列化工具输入 */
  input: string
  /** 实际工具结果 */
  result: string
  /** Pi shell 实际退出码，0 是成功；未返回时省略，不从文本推断 */
  exitCode?: number
  /** Pi shell 实际 wall_time_seconds 换算为毫秒；未返回时省略 */
  durationMs?: number
}
export type ConversationRuntime = {
  /** 本次回复的实时执行阶段；只在 running 返回，不代表任务验收结果 */
  phase: "responding" | "tool" | "retrying" | "compacting"
  /** 阶段发生时的 ISO 时间 */
  updatedAt: string
  /** 当前运行的 Pi 工具名称 */
  toolName?: string
  /** Pi 当前自动重试次数 */
  attempt?: number
  /** Pi 本次自动重试上限 */
  maxAttempts?: number
  /** Pi 重试等待结束的 ISO 时间；等待结束后下一次事件更新阶段 */
  retryAt?: string
  /** 固定安全原因，不包含提供者原始响应或凭据 */
  reason?: string
  /** 自动重试属于回复请求还是上下文压缩 */
  retrySource?: "response" | "compaction"
}
export type ConversationChatMessage = {
  /** 由 Pi 消息时间和顺序生成的稳定展示标识 */
  id: string
  /** 消息角色 */
  role: "user" | "assistant"
  /** 消息文本 */
  text: string
  /** ISO 时间 */
  time: string
  /** 实际模型 */
  model?: string
  /** 消息状态 */
  status: "sending" | "streaming" | "settled" | "interrupted" | "failed"
  /**  */
  thinking?: {
    /** Pi 实际返回的思考内容 */
    text: string
  }
  /**  */
  materials?: MaterialReference[]
  /**  */
  attachments?: {
    /** 准备材料标识 */
    id: string
    /** 原始材料名称 */
    name: string
    /** 展示类型 */
    kind: "file" | "image"
    /** 原始来源路径或固定图片说明 */
    source: string
    /** 材料真实类别 */
    materialType: "file" | "image" | "skill"
  }[]
  /**  */
  tools?: ConversationChatTool[]
  /**  */
  blocks?: (
    | {
        /** 内容标识 */
        id: string
        /**  */
        type: "text"
        /** 文本 */
        text: string
      }
    | {
        /** 内容标识 */
        id: string
        /**  */
        type: "tool"
        /**  */
        tool: ConversationChatTool
      }
  )[]
}
export type ConversationSnapshot = {
  /** 稳定的业务会话/请求标识 */
  id: string
  /** 会话标题 */
  title: string
  /** 稳定的业务会话/请求标识 */
  workspaceId: string
  /** 真实工作目录 */
  cwd: string
  /** 当前宿主单调更新版本，结合 epoch 判断新宿主 */
  version: number
  /** 宿主启动标识 */
  epoch: string
  /** 最后接受的客户端请求标识；空会话为空 */
  clientRequestId: string
  /** 仅在 Pi 持久化方法成功返回后确认用户消息（或继续指令）已接受；消息事件本身不代表保存成功。该输入写入失败时返回 false、保留草稿，明确重发使用新请求标识；相同标识不重复执行。 */
  inputAccepted: boolean
  /** 本次或最后一次运行标识 */
  runId: string
  /** 真实回复运行状态；completed 仅表示本轮运行结束，不代表用户任务验收成功 */
  phase:
    "idle" | "running" | "stopping" | "completed" | "failed" | "interrupted"
  /** 连接 ID/模型 ID 的选择值 */
  modelId: string
  /** 模型连接 ID */
  connectionId: string
  /** 服务端模型 ID */
  providerModelId: string
  /** Pi 原生思考等级；不支持思考的模型只能使用 off */
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  /** 错误说明，成功为空 */
  error: string
  /**  */
  messages: ConversationChatMessage[]
  /**  */
  queue?: ConversationQueue
  /** 待处理消息保存或恢复错误；不会自动重发 */
  queueError?: string
  /**  */
  runtime?: ConversationRuntime
  /**  */
  notice?: {
    /** 非阻断执行提醒 */
    kind: "compaction-failed"
    /** 安全说明；不把压缩失败等同任务失败 */
    message: string
    /** 提醒发生时的 ISO 时间 */
    occurredAt: string
    /** 此提醒所属回复运行标识；新回复清除旧提醒 */
    runId: string
  }
  /**  */
  context?: {
    /** Pi getContextUsage 提供的上下文 token 估算，不等同完整请求或精确计费 */
    usedTokens: number
    /** 当前模型上下文上限 */
    contextWindow: number
    /** 统计的权威来源 */
    source?: "pi-context-estimate"
    /** Pi 统计为上下文估算，正式实现为 true */
    estimated?: boolean
    /** 统计读取时点的 ISO 时间 */
    observedAt?: string
    /** true 表示从正式历史恢复的已记录统计，并非当前实时请求 */
    restored?: boolean
  }
  /**  */
  contextState?: {
    /** 未知用量的原因分类；不会同时返回 context */
    status: "awaiting-response" | "unavailable"
    /** 已知的模型上下文上限 */
    contextWindow?: number
    /** 未知状态确认时点的 ISO 时间 */
    observedAt: string
    /** 未知用量的安全说明 */
    reason: string
  }
}
export type InstructionScope = "all" | "directory" | "none"
export type SessionTool = {
  /** Pi 注册工具名 */
  id: string
  /** 工具名称 */
  name: string
  /** Pi 工具描述 */
  description: string
  /** 工具来源 */
  group: string
  /** 工具完整说明 */
  detail: string
  /** 注册且本机依赖已找到；具体文件权限在执行时判断 */
  available: boolean
  /** 依赖缺失原因；可用时为空 */
  unavailableReason: string
}
export type SessionInstruction = {
  /** 实际指令文件绝对路径 */
  path: string
  /** Moon 个人指令或工作目录链指令 */
  source: "global" | "directory"
  /** 本次实际加载的指令内容 */
  content: string
}
export type SessionConfiguration = {
  /** 会话稳定标识 */
  sessionId: string
  /** 会话工作目录 */
  cwd: string
  /** 配置乐观并发版本 */
  revision: number
  /** 保存的工具选择 */
  toolIds: string[]
  /** 从真实 Pi 会话读回的生效集合 */
  effectiveToolIds: string[]
  /** 只读；保存但未知或本机依赖失效的工具，可取消后重新应用 */
  unavailableToolIds: string[]
  /**  */
  instructionScope: InstructionScope
  /** 已提交的有效指令快照 */
  instructions: SessionInstruction[]
}
export type SessionCatalog = {
  /** 解析后的真实工作目录 */
  cwd: string
  /** 本宿主实际注册的 Pi 内置工具 */
  tools: SessionTool[]
  /** 当前目录发现的所有指令；应用按范围选择 */
  instructions: SessionInstruction[]
  /**  */
  defaults: {
    /** 默认活动集 */
    toolIds: string[]
    /**  */
    instructionScope: InstructionScope
  }
}
export type DirectoryProtocol = "openai-completions" | "anthropic-messages"
export type ModelApi = string
export type ThinkingLevelMap = {
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  off?: string | null
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  minimal?: string | null
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  low?: string | null
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  medium?: string | null
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  high?: string | null
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  xhigh?: string | null
  /** null 表示不支持；缺省遵从 Pi 默认映射。 */
  max?: string | null
}
export type ModelDefinition = {
  /** 服务实际返回的模型 ID，调用时原样使用。 */
  id: string
  /** 模型显示名称。 */
  name: string
  /**  */
  api: ModelApi
  /** 是否支持思考；未匹配时缺省，保存 API 模型前必须补全。 */
  reasoning?: boolean
  /**  */
  thinkingLevelMap?: ThinkingLevelMap
  /** 只读；由 Pi 依据模型能力计算，不支持思考时为空。 */
  supportedThinkingLevels?: (
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  )[]
  /** 支持的输入模态。 */
  input: ("text" | "image")[]
  /** 上下文 token 上限，保存 API 模型前必填。 */
  contextWindow?: number
  /** 输出 token 上限，不能超过上下文；保存 API 模型前必填。 */
  maxTokens?: number
  /**  */
  metadata?: {
    /** 能力匹配状态 */
    status: "matched" | "partial" | "unknown"
    /** 匹配来源 */
    sources: string[]
    /** 需要用户确认的字段 */
    conflicts: string[]
  }
}
export type ModelConnection = {
  /** 稳定连接 ID；创建后不变。 */
  id: string
  /** 连接名称，不区分大小写唯一。 */
  name: string
  /** 连接类型，保存后不可更改。 */
  kind: "api" | "subscription"
  /** 编辑/删除必须带读取到的版本；新建不传，旧版本或已删除记录拒绝覆盖。 */
  revision?: number
  /** 订阅选择 Pi 提供者，每个提供者只允许一个连接。 */
  providerId?: string
  /**  */
  protocol?: DirectoryProtocol
  /** 只读的配置问题说明。 */
  issue?: string
  /** HTTP(S)服务端点；可空保存，发现/调用前必填；禁止内嵌凭据、查询和片段。 */
  endpoint: string
  /** 凭据方式；切换会清除旧存储密钥。 */
  credential: "key" | "environment" | "none"
  /** 只读凭据存在标记，不是密钥内容。 */
  keySaved: boolean
  /** 仅请求可带密钥；响应固定空串。禁止命令/变量表达式。 */
  apiKey: string
  /** 明确删除存储密钥。空密钥默认保留已保存值。 */
  clearKey?: boolean
  /** 后端环境变量名称，仅 environment 模式使用。 */
  environmentVariable: string
  /** JSON 字符串字典；只允许字面量，禁止认证头、命令和变量表达式。 */
  headers: string
  /**  */
  account?: {
    /** 账号显示名 */
    name: string
    /** 账号类型 */
    plan: string
    /** 是否存在订阅凭据；实际权限需检查模型调用。 */
    loggedIn: boolean
  }
  /** 该连接保存的模型，API 模型 ID 不能重复。 */
  models: ModelDefinition[]
}
export type AuthEvent = {
  /** Pi 通知类型 */
  type: string
  /** 提示内容 */
  message?: string
  /** 授权 HTTPS URL */
  url?: string
  /** 操作说明 */
  instructions?: string
  /** 设备码 */
  userCode?: string
  /** 设备验证 URL */
  verificationUri?: string
  /** 有效期秒数 */
  expiresInSeconds?: number
  /** 轮询间隔秒数 */
  intervalSeconds?: number
  /** 授权链接 */
  links?: {
    /** 链接地址 */
    url: string
    /** 显示名 */
    label?: string
  }[]
}
export type AuthPrompt = {
  /** 当前提示 ID */
  id: string
  /** Pi 提示类型，如 select / secret / manual_code */
  type: string
  /** 提示内容 */
  message: string
  /** 占位提示 */
  placeholder?: string
  /** 仅 select 提示提供 */
  options?: {
    /** 选项值 */
    id: string
    /** 显示名 */
    label: string
    /** 选项说明 */
    description?: string
  }[]
}
export type AuthState = {
  /** 授权任务 ID */
  id: string
  /** 任务状态 */
  status: "pending" | "complete" | "error" | "cancelled"
  /**  */
  connection: ModelConnection
  /** 安全错误说明 */
  error?: string
  /** Pi 实际通知，不含凭据 */
  events: AuthEvent[]
  /**  */
  prompt?: AuthPrompt
}
export type RpcRequests = {
  conversationQueueEdit: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    itemId: string
    /** 修改后的原始文字，材料保留 */
    text: string
    /**  */
    revision: number
  }
  conversationQueueRemove: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    itemId: string
    /**  */
    revision: number
  }
  conversationQueueMode: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 交付模式 */
    mode: "single" | "all"
    /**  */
    revision: number
  }
  conversationQueueDeliver: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    itemId: string
    /**  */
    revision: number
  }
  materialChoose: {
    /** 会话稳定标识 */
    sessionId: string
    /** 当前会话真实工作目录 */
    cwd: string
  }
  materialPrepare: {
    /** 会话稳定标识 */
    sessionId: string
    /** 当前会话真实工作目录 */
    cwd: string
    /**  */
    paths: string[]
  }
  materialUpload: {
    /** 会话稳定标识 */
    sessionId: string
    /** 当前会话真实工作目录 */
    cwd: string
    /** 粘贴或拖入的图片名 */
    name: string
    /** image/png、jpeg、webp、gif */
    mimeType: string
    /** 图片base64；解码后最多8MiB */
    data: string
  }
  materialCatalog: {
    /** 会话稳定标识 */
    sessionId: string
    /** 当前会话真实工作目录 */
    cwd: string
    /** 文件相对路径或Skill名称搜索 */
    query: string
  }
  materialPreview: {
    /** 当前会话真实工作目录 */
    cwd: string
    /** 准备完成的材料ID */
    id: string
  }
  materialRestore: {
    /** 会话稳定标识 */
    sessionId: string
    /** 当前会话真实工作目录 */
    cwd: string
    /**  */
    materials: MaterialReference[]
  }
  workspaceList: Record<string, never>
  workspaceAdd: {
    /** 用户明确选择的存在目录 */
    path: string
  }
  workspaceSelect: {
    /** 工作区稳定标识 */
    id: string
  }
  workspaceGet: {
    /** 工作区稳定标识 */
    id: string
  }
  workspaceChoose: Record<string, never>
  conversationList: {
    /**  */
    filter?: ConversationFilter
  }
  conversationInfo: {
    /** 稳定会话标识 */
    id: string
  }
  conversationMarkRead: {
    /** 稳定会话标识 */
    id: string
    /** 页面已展示的摘要版本 */
    revision: number
  }
  conversationSend: {
    /** 稳定的业务会话/请求标识 */
    sessionId: string
    /** 稳定的业务会话/请求标识 */
    workspaceId: string
    /** 稳定的业务会话/请求标识 */
    clientRequestId: string
    /** 本轮用户文本；有就绪材料时可以为空 */
    text: string
    /**  */
    materials?: MaterialReference[]
    /** 连接目录中的精确 ID */
    connectionId: string
    /** 模型的精确 ID，允许斜杠 */
    modelId: string
    /** Pi 原生思考等级；不支持思考的模型只能使用 off */
    thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  }
  conversationRead: {
    /** 稳定的业务会话/请求标识 */
    sessionId: string
    /** 可选：客户端已见版本；本版始终返回完整快照 */
    afterVersion?: number
  }
  conversationStop: {
    /** 稳定的业务会话/请求标识 */
    sessionId: string
    /** 稳定的业务会话/请求标识 */
    runId: string
  }
  conversationRetry: {
    /** 稳定的业务会话/请求标识 */
    sessionId: string
    /** 稳定的业务会话/请求标识 */
    clientRequestId: string
    /** 连接目录中的精确 ID */
    connectionId: string
    /** 模型的精确 ID，允许斜杠 */
    modelId: string
    /** Pi 原生思考等级；不支持思考的模型只能使用 off */
    thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
  }
  sessionCatalog: {
    /**  */
    cwd: string
  }
  sessionRead: {
    /**  */
    sessionId: string
  }
  sessionApply: {
    /**  */
    sessionId: string
    /**  */
    cwd: string
    /**  */
    toolIds: string[]
    /**  */
    instructionScope: InstructionScope
    /**  */
    revision?: number
  }
  list: Record<string, never>
  revealKey: {
    /**  */
    id: string
    /**  */
    revision: number
  }
  providers: Record<string, never>
  save: {
    /**  */
    connection: ModelConnection
  }
  remove: {
    /**  */
    id: string
    /**  */
    revision: number
  }
  discover: {
    /**  */
    connection: ModelConnection
  }
  check: {
    /**  */
    connection: ModelConnection
    /**  */
    model: ModelDefinition
  }
  authStart: {
    /**  */
    connection: ModelConnection
  }
  authPoll: {
    /**  */
    id: string
  }
  authReply: {
    /**  */
    id: string
    /**  */
    promptId: string
    /**  */
    value: string
  }
  authCancel: {
    /**  */
    id: string
  }
  logout: {
    /**  */
    id: string
  }
}
export type RpcResults = {
  conversationQueueEdit: ConversationSnapshot
  conversationQueueRemove: ConversationSnapshot
  conversationQueueMode: ConversationSnapshot
  conversationQueueDeliver: ConversationSnapshot
  materialChoose: MaterialReference[]
  materialPrepare: MaterialReference[]
  materialUpload: MaterialReference
  materialCatalog: MaterialCatalog
  materialPreview: MaterialPreview
  materialRestore: MaterialReference[]
  workspaceList: WorkspaceList
  workspaceAdd: WorkspaceRecord
  workspaceSelect: WorkspaceRecord
  workspaceGet: WorkspaceRecord | null
  workspaceChoose: WorkspaceRecord | null
  conversationList: ConversationSummary[]
  conversationInfo: ConversationSummary | null
  conversationMarkRead: ConversationSummary
  conversationSend: ConversationSnapshot
  conversationRead: ConversationSnapshot
  conversationStop: ConversationSnapshot
  conversationRetry: ConversationSnapshot
  sessionCatalog: SessionCatalog
  sessionRead: SessionConfiguration | null
  sessionApply: SessionConfiguration
  list: ModelConnection[]
  revealKey: {
    /**  */
    apiKey: string
  }
  providers: {
    /**  */
    id: string
    /**  */
    name: string
  }[]
  save: ModelConnection
  remove: null
  discover: ModelDefinition[]
  check: null
  authStart: AuthState
  authPoll: AuthState
  authReply: AuthState
  authCancel: null
  logout: ModelConnection
}
export type ModelOperation = keyof RpcRequests
