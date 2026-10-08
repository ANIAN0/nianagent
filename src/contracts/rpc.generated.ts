// Generated from backend/schema.mjs and backend/contract.mjs. Do not edit.
export const transportRecoveryByOperation = {
  list: "reload",
  revealKey: "reload",
  providers: "reload",
  discover: "reload",
  check: "none",
  sessionCatalog: "reload",
  sessionRead: "reload",
  sessionApply: "check",
  save: "check",
  remove: "check",
  authStart: "check",
  authPoll: "reload",
  authReply: "check",
  authCancel: "check",
  logout: "check",
  workspaceList: "reload",
  workspaceGet: "reload",
  workspaceAdd: "check",
  workspaceSelect: "check",
  workspaceChoose: "check",
  conversationList: "reload",
  conversationInfo: "reload",
  conversationMarkRead: "check",
  conversationRead: "reload",
  conversationFollow: "reload",
  conversationReceiptRead: "reload",
  conversationSend: "check",
  conversationRetry: "check",
  conversationStop: "check",
  conversationQueueEdit: "check",
  conversationQueueRemove: "check",
  conversationQueueMode: "check",
  conversationQueueDeliver: "check",
  conversationQueueReceiptRead: "reload",
  conversationFork: "check",
  conversationCompact: "check",
  conversationControlRead: "reload",
  conversationCompactCancel: "check",
  materialChoose: "check",
  materialPrepare: "check",
  materialUpload: "check",
  materialCatalog: "reload",
  materialPreview: "reload",
  materialRestore: "reload",
  mcpList: "reload",
  mcpSave: "check",
  mcpRemove: "check",
  mcpTest: "reload",
  extensionList: "reload",
  extensionConfigure: "check",
  writeReceiptRead: "reload",
  conversationPermissionRead: "reload",
  conversationPermissionSet: "check",
  conversationApprovalReply: "check",
  conversationCommandRun: "check",
  conversationCommandRead: "reload",
} as const
export const receiptOperationNames = [
  "extensionConfigure",
  "mcpSave",
  "mcpRemove",
  "save",
  "remove",
] as const
export const queueReceiptOperationNames = [
  "conversationQueueRemove",
  "conversationQueueMode",
  "conversationQueueDeliver",
] as const
export type ExtensionPresentation = {
  /** 声明中的稳定结果种类；按kind/version选择展示，不按工具或插件名称分支 */
  kind: string
  /** 结果协议版本；不支持的版本仍呈现原始文本 */
  version: number
  /** 经过声明结果schema核对的JSON对象字符串，最多64KiB；不含宿主对象或函数 */
  payload: string
}
export type ExtensionResultKind = {
  /** 稳定展示种类 */
  kind: string
  /**  */
  version: number
  /** 权威结果JSON Schema，来自模块声明 */
  schema: string
}
export type ExtensionDescriptor = {
  /** 稳定模块身份，与名称/安装目录显示文字无关 */
  id: string
  /** 模块名称 */
  name: string
  /** 能力及适用场景 */
  description: string
  /** Moon公开扩展契约版本 */
  apiVersion: 1
  /** 模块代码版本 */
  version: string
  /** 配置CAS版本；未保存时为0 */
  revision: number
  /** 下一次空闲加载启停，当前已接受运行保持快照 */
  enabled: boolean
  /** 已保存JSON配置；默认配置同样经过声明schema核对 */
  configuration: string
  /** 模块权威JSON Schema，title/description/default用于设置字段展示 */
  configurationSchema: string
  /**  */
  tools: SessionTool[]
  /**  */
  resultKinds: ExtensionResultKind[]
  /** 声明能否加载；不会把测试成功当持续连接 */
  state: "ready" | "failed"
  /**  */
  issue?: OperationIssue
  /** 持有此模块工具快照的正式会话数，资源按首次执行创建；不含只读目录 */
  activeSessions: number
}
export type WriteReceipt = {
  /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
  operationRequestId: string
  /** 原操作名 */
  operation: "save" | "remove" | "mcpSave" | "mcpRemove" | "extensionConfigure"
  /** 原目标稳定标识；缺少回执时为空，不能猜测已提交 */
  targetId: string
  /** committed 与业务数据同原子文件提交；rejected 未提交；unknown 不得盲重试 */
  state: "committed" | "rejected" | "unknown"
  /** 原操作完成时的目标版本，不等于当前最新版本 */
  revision?: number
  /**  */
  issue?: OperationIssue
}
export type OperationIssue = {
  /** 稳定问题类别，不能通过解析显示文案决定恢复动作 */
  code: string
  /** 已脱敏的用户原因；不包含提供方响应、凭据或内部文件标识 */
  summary: string
  /** 可选安全诊断，只含允许公开的错误码与操作类别 */
  details?: string
  /** 所属操作允许的恢复方向；具体按钮由该操作的调用方提供 */
  recovery: "retry" | "reload" | "check" | "settings" | "restart" | "none"
  /** 取消/等待属于info，非阻断问题warning，操作失败error */
  severity: "error" | "warning" | "info"
}
export type RpcFailure = {
  /** 兼容旧客户端的安全错误摘要 */
  error: string
  /**  */
  issue: OperationIssue
}
export type ConversationQueueOperationReceipt = {
  /** 稳定会话、消息或提交标识 */
  sessionId: string
  /** 稳定会话、消息或提交标识 */
  operationRequestId: string
  /** 原队列操作名，不按当前队列外观推断 */
  operation?:
    | "conversationQueueRemove"
    | "conversationQueueMode"
    | "conversationQueueDeliver"
  /** 冻结请求的原队列CAS版本 */
  baseRevision?: number
  /** 本次动作采用时原子提交的队列版本，不是当前最新版本 */
  revision?: number
  /** 稳定会话、消息或提交标识 */
  itemId?: string
  /** 本次请求的交付模式 */
  mode?: "single" | "all"
  /**  */
  issue?: OperationIssue
  /** committed证明原动作采用；不是Pi输入ACK或回答完成。missing/current preparing为unknown，cold preparing为rejected */
  state: "committed" | "rejected" | "unknown"
  /** 仅宿主确认原ID无登记时为true，允许用户显式恢复冻结同ID/同内容/同CAS的原操作；不是新ID重发或自动补发 */
  retryOriginalAllowed?: true
}
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
  /** 最后成功编辑的原队列版本，需与编辑请求身份一起匹配 */
  editBaseRevision?: number
  /** 最后成功编辑的clientEditId；即使交付失败仍保留 */
  editRequestId?: string
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
  /** 已交付/已删除原项的最小终态回执，用于核对未知编辑；不返回文字、材料或媒体正文。 */
  retiredItems?: {
    /** 稳定会话、消息或提交标识 */
    id: string
    /** 稳定会话、消息或提交标识 */
    clientRequestId: string
    /** 不可再修改的原项终态 */
    status: "delivered" | "removed"
    /** 最后成功编辑请求的原队列版本；需同时匹配editRequestId证明本次编辑已提交 */
    editBaseRevision?: number
    /** 最后成功编辑请求的clientEditId；与冻结提交身份核对，不返回编辑正文 */
    editRequestId?: string
  }[]
  /** 已持久接受的提交回执，用于原请求核对，已交付/已删除仍保留 */
  acceptedRequestIds: string[]
}
export type MaterialDiagnostic = {
  /** 诊断所属资源视图 */
  scope: "files" | "skills"
  /** Pi资源诊断或文件目录限制说明 */
  message: string
}
export type MaterialReference = {
  /** 服务准备后返回的稳定材料标识 */
  id: string
  /** 材料原始名称 */
  name: string
  /** 材料类别 */
  kind: "附件" | "Skill"
  /** 实际交付方式 */
  type: "file" | "directory" | "image" | "skill"
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
  /** 失败条目的权威恢复标记；false需重新选择或移除，true允许人工重试准备/核对。旧草稿可缺省，恢复时由服务重新判定。 */
  retryable?: boolean
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
  diagnostics: MaterialDiagnostic[]
  /**  */
  commands?: ConversationCommand[]
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
  /**  */
  lineage?: {
    /** 稳定会话标识 */
    sourceSessionId: string
    /** 来源会话标题 */
    sourceTitle: string
    /** 来源Pi已完成回复标识 */
    sourceEntryId: string
  }
}
export type ConversationFilter = {
  /** 可选工作区标识 */
  workspaceId?: string
  /** 标题、工作目录或最近消息关键词；忽略大小写 */
  query?: string
}
export type ConversationRequestReceipt = {
  /** 稳定的业务会话/请求标识 */
  sessionId: string
  /** 稳定的业务会话/请求标识 */
  clientRequestId: string
  /** 仅原请求的结论；accepted由正式Pi输入或已存队列证明，handled由明确保存的扩展处理回执证明；started缺权威证据始终unknown，不重发 */
  state: "accepted" | "handled" | "rejected" | "unknown"
  /**  */
  issue?: OperationIssue
}
export type ConversationToolTarget = {
  /** 工具目标类型 */
  kind: "file" | "command"
  /** 按Pi参数和会话cwd解析的请求路径；预览另经realpath及目录边界核验 */
  path?: string
  /** 工作区内相对路径或完整外部路径 */
  displayPath?: string
  /** Pi工具原始路径参数 */
  requestedPath?: string
  /** read请求的起始行，从1开始 */
  line?: number
  /** read请求的行数 */
  lineCount?: number
  /** Pi实际接收的命令参数 */
  command?: string
  /** 命令所属会话工作目录 */
  cwd?: string
}
export type ConversationToolDetails = {
  /** Pi edit实际成功结果的差异，不由模型正文或预计参数构造 */
  diff?: string
  /** Pi edit实际成功结果的unified patch */
  patch?: string
  /** Pi实际结果的首个改动行，从1开始 */
  firstChangedLine?: number
}
export type ConversationFileArtifact = {
  /** 成功的Pi文件操作目标路径，打开时仍须核对当前磁盘及权限边界 */
  path: string
  /** 可读的文件目标 */
  displayPath: string
  /** 成功文件工具的实际操作；Pi无前像时只称write，不猜创建/覆盖 */
  operation: "write" | "edit"
}
export type ConversationChatTool = {
  /** Pi toolCallId */
  id: string
  /** 工具名称 */
  name: string
  /** 工具来源 */
  source: string
  /** 工具发生的实际状态；returned仅有结束证据而缺结果，不代表成功；unknown缺少可确认结论；not-run须有明确未执行证据，缺记录不作此证据 */
  status:
    | "running"
    | "success"
    | "failed"
    | "stopped"
    | "not-run"
    | "returned"
    | "unknown"
  /** 序列化工具输入 */
  input: string
  /** 实际工具结果 */
  result: string
  /** 当前投影的结果可用事实：available有真实最终结果（可为空、图片或截断，不保证已落盘）；partial仅有工具更新的部分结果；missing无可用结果。正式投影总提供，省略仅兼容未提供此事实的旧调用方，不能由空文本推断 */
  resultAvailability?: "available" | "partial" | "missing"
  /** Pi shell 实际退出码，0仅说明命令正常退出，不证明任务达成或结果正文已保存；未返回时省略，不从文本推断 */
  exitCode?: number
  /** Pi shell 实际 wall_time_seconds 换算为毫秒；未返回时省略 */
  durationMs?: number
  /** Pi assistant entryId与内容位置组成的调用身份；旧格式未持久迁移时使用稳定展示id，不冒充正式entryId；不以可重复的提供者toolCallId作为唯一键 */
  occurrenceId?: string
  /**  */
  target?: ConversationToolTarget
  /** Pi工具文本结果在Moon展示截断前的字符数；不是源文件总长度 */
  resultLength?: number
  /** Pi结果本身或Moon展示结果发生截断；不能将展示文本当完整文件 */
  resultTruncated?: boolean
  /**  */
  details?: ConversationToolDetails
  /**  */
  images?: MaterialReference[]
  /**  */
  artifact?: ConversationFileArtifact
  /**  */
  presentation?: ExtensionPresentation
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
  /** 原Pi历史已保存的权威条目标识；运行中消息或v1只读恢复的临时迁移标识不返回 */
  entryId?: string
  /** 在完整Pi分支中的位置，包含custom条目；pending位于branch.length，继续指令使用原custom_message位置 */
  historyIndex?: number
  /** 对应可见用户输入的稳定展示标识，用于聚合该输入之后的正式阶段；不是Pi fork锚点 */
  userTurnId?: string
  /** 可见用户输入的正式类型；不按正文文案猜继续请求 */
  inputKind?: "continuation"
  /** 可见继续指令所恢复的前一用户轮次；独立输入身份保留，便于标注历史attempt恢复关系 */
  continuationOf?: string
  /** Moon正式请求标记提供的运行归属；旧记录缺失时省略，不推测 */
  runId?: string
  /** Pi正式assistant停止原因；length表示输出上限，不当作完整答案 */
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted"
  /** Pi当前仍在生成的内容块；结束的thinking不随整条消息继续显示运行态 */
  activeBlockId?: string
  /** Pi已保存且完成的Agent回复边界，不含待执行工具调用；旧格式只读历史迁移前为false，来源会话还需通过控制门禁 */
  forkable?: boolean
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
  issue?: OperationIssue
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
    materialType: "file" | "directory" | "image" | "skill"
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
        /** 此块是否仍在生成 */
        phase?: "running" | "settled"
      }
    | {
        /** 原始Pi内容位置生成的标识 */
        id: string
        /**  */
        type: "thinking"
        /** 该位置的Pi思考正文 */
        text: string
        /** 此思考块的真实生成阶段 */
        phase: "running" | "settled"
      }
    | {
        /** 原始Pi内容位置生成的标识 */
        id: string
        /**  */
        type: "image"
        /**  */
        image: MaterialReference
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
  /** 最后提交启动的客户端请求标识；不是接受证明，未启动会话为空 */
  clientRequestId: string
  /** 仅在 Pi 持久化方法成功返回后确认本次用户消息（或继续指令）已接受；消息事件本身不代表保存成功。false不推断拒绝，须核对原回执；handled表示扩展领取输入，仍不伪造user保存。相同标识不重复执行。 */
  inputAccepted: boolean
  /** handled表示Pi公开入口确认扩展已处理本次输入；没有本次user接受证据，不能声称执行成功或重复提交 */
  inputDisposition?: "handled"
  /** 本次或最后一次运行标识 */
  runId: string
  /** 输入已接受且末次回复失败/停止或Pi length截断；继续是新的幂等可见指令，不重发原请求或自动执行旧工具 */
  canContinue?: boolean
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
  issue?: OperationIssue
  /** 本次运行失败对应的正式 Pi 回复条目 ID；无对应回复时省略 */
  issueEntryId?: string
  /**  */
  messages: ConversationChatMessage[]
  /**  */
  permission?: ConversationPermission
  /**  */
  approvals?: ConversationApproval[]
  /**  */
  statistics?: ConversationStatistics
  /**  */
  command?: ConversationCommandReceipt
  /**  */
  extensionNotifications?: {
    /** 稳定的业务会话/请求标识 */
    id: string
    /** 扩展提示 */
    message: string
    /** 提示等级 */
    severity: "info" | "warning" | "error"
  }[]
  /** 旧格式历史的非阻断说明；只读恢复不持久化迁移标识，显式发送交由Pi迁移后恢复派生能力 */
  historyNotice?: string
  /**  */
  queue?: ConversationQueue
  /** 待处理消息保存或恢复错误；不会自动重发 */
  queueError?: string
  /**  */
  queueIssue?: OperationIssue
  /**  */
  control?: ConversationControl
  /**  */
  compactions?: ConversationCompaction[]
  /**  */
  lineage?: {
    /** 稳定的业务会话/请求标识 */
    sourceSessionId: string
    /** 来源会话标题 */
    sourceTitle: string
    /** Pi来源回复标识 */
    sourceEntryId: string
  }
  /**  */
  runtime?: ConversationRuntime
  /**  */
  notice?: {
    /** 非阻断执行提醒 */
    kind: "compaction-failed" | "input-handled"
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
export type ConversationMetadata = {
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
  /** 最后提交启动的客户端请求标识；不是接受证明，未启动会话为空 */
  clientRequestId: string
  /** 仅在 Pi 持久化方法成功返回后确认本次用户消息（或继续指令）已接受；消息事件本身不代表保存成功。false不推断拒绝，须核对原回执；handled表示扩展领取输入，仍不伪造user保存。相同标识不重复执行。 */
  inputAccepted: boolean
  /** handled表示Pi公开入口确认扩展已处理本次输入；没有本次user接受证据，不能声称执行成功或重复提交 */
  inputDisposition?: "handled"
  /** 本次或最后一次运行标识 */
  runId: string
  /** 输入已接受且末次回复失败/停止或Pi length截断；继续是新的幂等可见指令，不重发原请求或自动执行旧工具 */
  canContinue?: boolean
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
  issue?: OperationIssue
  /** 本次运行失败对应的正式 Pi 回复条目 ID；无对应回复时省略 */
  issueEntryId?: string
  /**  */
  permission?: ConversationPermission
  /**  */
  approvals?: ConversationApproval[]
  /**  */
  statistics?: ConversationStatistics
  /**  */
  command?: ConversationCommandReceipt
  /**  */
  extensionNotifications?: {
    /** 稳定的业务会话/请求标识 */
    id: string
    /** 扩展提示 */
    message: string
    /** 提示等级 */
    severity: "info" | "warning" | "error"
  }[]
  /** 旧格式历史的非阻断说明；只读恢复不持久化迁移标识，显式发送交由Pi迁移后恢复派生能力 */
  historyNotice?: string
  /**  */
  queue?: ConversationQueue
  /** 待处理消息保存或恢复错误；不会自动重发 */
  queueError?: string
  /**  */
  queueIssue?: OperationIssue
  /**  */
  control?: ConversationControl
  /**  */
  compactions?: ConversationCompaction[]
  /**  */
  lineage?: {
    /** 稳定的业务会话/请求标识 */
    sourceSessionId: string
    /** 来源会话标题 */
    sourceTitle: string
    /** Pi来源回复标识 */
    sourceEntryId: string
  }
  /**  */
  runtime?: ConversationRuntime
  /**  */
  notice?: {
    /** 非阻断执行提醒 */
    kind: "compaction-failed" | "input-handled"
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
export type ConversationFrame = {
  /** 首次/失去版本基线返回snapshot；变化返回update；无变化返回heartbeat */
  kind: "snapshot" | "update" | "heartbeat"
  /** 宿主身份 */
  epoch: string
  /** 变化版本 */
  version: number
  /** 增量所需的精确基线 */
  baseVersion?: number
  /**  */
  snapshot?: ConversationSnapshot
  /**  */
  metadata?: ConversationMetadata
  /**  */
  upserts?: ConversationChatMessage[]
  /**  */
  order?: string[]
}
export type ConversationPermission = {
  /** 稳定标识 */
  sessionId: string
  /** 文件工具范围与命令审批策略，不等同操作系统沙箱 */
  mode: "read-only" | "workspace" | "full-access"
  /** 权限配置CAS版本，运行中禁止更改 */
  revision: number
}
export type ConversationApproval = {
  /** 稳定标识 */
  id: string
  /** 所属运行，扩展空闲命令为空 */
  runId: string
  /** 请求类型 */
  kind: "tool" | "confirm" | "select" | "input"
  /** 请求标题 */
  title: string
  /** 请求说明 */
  message: string
  /** 工具名称 */
  toolName?: string
  /** Pi 工具调用标识，与 runId 共同关联当前待执行工具 */
  toolCallId?: string
  /** 完整工具参数JSON */
  input?: string
  /**  */
  options?: string[]
  /** 到期自动拒绝，ISO时间 */
  expiresAt: string
}
export type ConversationStatistics = {
  /** Pi provider input tokens */
  input: number
  /** Pi provider output tokens */
  output: number
  /** Pi缓存读tokens */
  cacheRead: number
  /** Pi缓存写tokens */
  cacheWrite: number
  /** Pi会话tokens总和 */
  totalTokens: number
  /** 正式分支工具调用数 */
  toolCalls: number
  /** 正式Pi分支中有assistant消息的用户轮次数 */
  turns?: number
  /** 正式Pi分支assistant消息数，含工具调用步骤 */
  steps?: number
  /** 本轮总耗时，包含工具与等待 */
  durationMs?: number
  /** 本轮模型消息生成耗时，不含工具与审批 */
  modelDurationMs?: number
  /** 本轮Pi output tokens，未返回usage时省略 */
  outputTokens?: number
  /** 本轮output/modelDuration估算，等待不算生成，缺usage不返回 */
  tokensPerSecond?: number
  /** Pi模型费率估算USD；无费率不返回，不能当实际账单 */
  cost?: number
  /** 历史恢复 */
  restored?: boolean
}
export type ConversationCommand = {
  /** 精确调用名 */
  name: string
  /** 命令描述 */
  description: string
  /** 命令类型 */
  kind: "host" | "extension"
  /**  */
  available: boolean
  /** 禁用原因 */
  reason?: string
}
export type ConversationCommandReceipt = {
  /** 稳定标识 */
  id: string
  /** 稳定标识 */
  sessionId: string
  /** 精确命令名 */
  name: string
  /** 命令状态，started先于副作用；unknown不能重发 */
  status: "started" | "completed" | "failed" | "unknown"
  /**  */
  issue?: OperationIssue
}
export type ConversationControlOperation = {
  /** 稳定操作或会话标识 */
  id: string
  /** 操作类型 */
  kind: "compact" | "fork"
  /** 稳定操作或会话标识 */
  sessionId: string
  /** 实际操作结果；unknown必须查询原标识 */
  status:
    "running" | "cancelling" | "completed" | "cancelled" | "failed" | "unknown"
  /** 接受时间 */
  createdAt: string
  /** 更新时点 */
  updatedAt: string
  /** 安全错误原因 */
  error: string
  /** 压缩时希望保留的重点 */
  focus?: string
  /** Pi权威历史边界 */
  anchorId?: string
  /** 实际保存的Pi压缩条目标识 */
  compactionEntryId?: string
  /** 稳定操作或会话标识 */
  targetSessionId?: string
}
export type ConversationControl = {
  /**  */
  busy: boolean
  /** 不能开始压缩的具体原因；可用时为空 */
  compactDisabledReason: string
  /** 不能创建会话分支的具体原因；可用时为空 */
  forkDisabledReason: string
  /**  */
  operation?: ConversationControlOperation
}
export type ConversationCompaction = {
  /** Pi压缩entryId */
  id: string
  /** Pi实际保存时间 */
  time: string
  /** 真实只读摘要 */
  summary: string
  /** 保留历史起点的Pi entryId */
  firstKeptEntryId: string
  /** Pi保存的压缩前估算用量 */
  tokensBefore: number
  /** 实际压缩来源；派生保留原摘要来源，不因新会话没有来源操作回执改标自动 */
  source: "manual" | "automatic"
  /** 当前Pi分支中的排列位置 */
  historyIndex: number
  /** 保留起点在当前分支的位置；-1表示原记录不存在 */
  firstKeptHistoryIndex: number
}
export type McpEnvironmentEntry = {
  /** 环境变量或请求头名称 */
  name: string
  /** 字面值或 ${ENV_NAME}，不执行命令 */
  value: string
}
export type McpConfiguration = {
  /** 稳定服务名称；横线与下划线视为相同身份 */
  name: string
  /** Pi 原生传输 */
  transport: "stdio" | "http"
  /** 单一可执行文件，不是 shell 命令 */
  command: string
  /**  */
  args: string[]
  /** 可选工作目录，相对路径以会话目录为基准 */
  cwd: string
  /**  */
  env: McpEnvironmentEntry[]
  /** Streamable HTTP URL */
  url: string
  /**  */
  headers: McpEnvironmentEntry[]
  /** 服务用途 */
  description: string
  /** 新会话及空闲会话下一次操作生效 */
  enabled: boolean
  /** 未另行选择时的 Pi 工具暴露方式 */
  exposure: "codemode" | "deferred" | "direct" | "hidden"
  /** 每个协议请求超时秒数，最大 120 */
  timeout: number
}
export type McpDiscoveredTool = {
  /** 服务器工具原名 */
  name: string
  /** Pi 模型工具名 */
  id: string
  /** 实际工具说明 */
  description: string
  /** 真实 JSON 参数 schema */
  inputSchema: string
}
export type McpTestResult = {
  /** 本次真实验证结果；验证结束即关闭测试连接 */
  state: "connected" | "needs-auth" | "failed"
  /** 脱敏后失败原因 */
  error: string
  /**  */
  tools: McpDiscoveredTool[]
  /** 验证时间 ISO 格式 */
  testedAt: string
}
export type McpRuntimeState = {
  /** 当前正式会话连接状态，不来自测试缓存 */
  state: "connecting" | "connected" | "disconnected" | "needs-auth" | "failed"
  /** 当前正式会话已连接数 */
  connections: number
  /** 当前连接的安全错误说明 */
  error: string
}
export type McpServer = {
  /**  */
  configuration: McpConfiguration
  /**  */
  revision: number
  /** 配置绝对路径，个人服务归 Moon agent/mcp.json */
  source: string
  /**  */
  test?: McpTestResult
  /**  */
  runtime?: McpRuntimeState
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
  /** 只读；正式订阅连接始终为true/false。true表示此提供者的完整退出登录操作仍运行，凭据不存在不能证明SDK清理结束。明确false才允许结束未知等待，缺省代表旧宿主须重启。 */
  accountOperationBusy?: boolean
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
  /** 授权准备、Pi登录或清理阶段；settling仍pending，原lease清理结束才公开终态，保留原任务ID供取消/失败恢复 */
  stage?: "preparing" | "authorizing" | "settling"
  /**  */
  issue?: OperationIssue
}
export type RpcRequests = {
  extensionList: Record<string, never>
  extensionConfigure: {
    /** 已发现模块稳定ID */
    id: string
    /**  */
    revision: number
    /**  */
    enabled: boolean
    /** JSON对象，按模块configurationSchema验证 */
    configuration: string
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId?: string
  }
  writeReceiptRead: {
    /** 原操作名 */
    operation:
      "save" | "remove" | "mcpSave" | "mcpRemove" | "extensionConfigure"
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId: string
  }
  conversationQueueEdit: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    itemId: string
    /** 修改后的原始文字 */
    text: string
    /**  */
    revision: number
    /** 可选完整材料选择；省略保留旧材料，空数组解除全部引用。提交前重新核对，不删除源文件。 */
    materials?: MaterialReference[]
    /** 可选冻结编辑身份；界面在RPC前持久保存，未知时只核对，不重发 */
    clientEditId?: string
  }
  conversationQueueRemove: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    itemId: string
    /**  */
    revision: number
    /** 稳定会话、消息或提交标识 */
    operationRequestId?: string
  }
  conversationQueueMode: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 交付模式 */
    mode: "single" | "all"
    /**  */
    revision: number
    /** 稳定会话、消息或提交标识 */
    operationRequestId?: string
  }
  conversationQueueDeliver: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    itemId: string
    /**  */
    revision: number
    /** 稳定会话、消息或提交标识 */
    operationRequestId?: string
  }
  conversationQueueReceiptRead: {
    /** 稳定会话、消息或提交标识 */
    sessionId: string
    /** 稳定会话、消息或提交标识 */
    operationRequestId: string
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
    /** selected用于用户明确系统选择绝对路径；workspace用于Agent正文链接/本地图像/成果，可使用相对cwd路径，必须realpath位于cwd内 */
    scope?: "selected" | "workspace"
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
    /** 文件/目录相对路径或Skill名称搜索；路径以/结尾时列出该目录的直接子项 */
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
  mcpList: Record<string, never>
  mcpSave: {
    /**  */
    configuration: McpConfiguration
    /**  */
    revision?: number
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId?: string
  }
  mcpRemove: {
    /** 服务名 */
    name: string
    /**  */
    revision: number
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId?: string
  }
  mcpTest: {
    /**  */
    configuration: McpConfiguration
    /** 真实会话目录，可空使用宿主目录 */
    cwd: string
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
  conversationReceiptRead: {
    /** 稳定的业务会话/请求标识 */
    sessionId: string
    /** 稳定的业务会话/请求标识 */
    clientRequestId: string
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
    /** 运行中Enter的交付方式，空闲始终正常发送 */
    delivery?: "followUp" | "steer"
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
  conversationFollow: {
    /** 稳定业务标识 */
    sessionId: string
    /** 客户端宿主身份 */
    epoch?: string
    /** 已应用版本 */
    afterVersion?: number
  }
  conversationPermissionRead: {
    /** 稳定标识 */
    sessionId: string
  }
  conversationPermissionSet: {
    /** 稳定标识 */
    sessionId: string
    /** 文件工具范围与命令审批策略，不等同操作系统沙箱 */
    mode: "read-only" | "workspace" | "full-access"
    /** 已读CAS版本 */
    revision: number
  }
  conversationApprovalReply: {
    /** 稳定标识 */
    sessionId: string
    /** 稳定标识 */
    approvalId: string
    /** 精确运行身份 */
    runId: string
    /** 工具/confirm为allow或deny；select为选项；input为文字；cancel取消 */
    value: string
  }
  conversationCommandRun: {
    /** 稳定标识 */
    sessionId: string
    /** 稳定标识 */
    commandRequestId: string
    /** 精确注册名 */
    name: string
    /** 参数 */
    arguments: string
  }
  conversationCommandRead: {
    /** 稳定标识 */
    sessionId: string
    /** 稳定标识 */
    commandRequestId: string
  }
  conversationFork: {
    /** 稳定操作或会话标识 */
    sessionId: string
    /** 稳定操作或会话标识 */
    operationId: string
    /** 精确Pi assistant entryId */
    entryId: string
  }
  conversationCompact: {
    /** 稳定操作或会话标识 */
    sessionId: string
    /** 稳定操作或会话标识 */
    operationId: string
    /** 可空保留重点 */
    focus: string
  }
  conversationControlRead: {
    /** 稳定操作或会话标识 */
    sessionId: string
    /** 稳定操作或会话标识 */
    operationId: string
  }
  conversationCompactCancel: {
    /** 稳定操作或会话标识 */
    sessionId: string
    /** 稳定操作或会话标识 */
    operationId: string
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
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId?: string
  }
  remove: {
    /**  */
    id: string
    /**  */
    revision: number
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId?: string
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
    /** 客户端冻结的原写入身份；同标识不重复执行，结果未知只读原回执 */
    operationRequestId?: string
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
  extensionList: ExtensionDescriptor[]
  extensionConfigure: ExtensionDescriptor
  writeReceiptRead: WriteReceipt
  conversationQueueEdit: ConversationSnapshot
  conversationQueueRemove: ConversationSnapshot
  conversationQueueMode: ConversationSnapshot
  conversationQueueDeliver: ConversationSnapshot
  conversationQueueReceiptRead: ConversationQueueOperationReceipt
  materialChoose: MaterialReference[]
  materialPrepare: MaterialReference[]
  materialUpload: MaterialReference
  materialCatalog: MaterialCatalog
  materialPreview: MaterialPreview
  materialRestore: MaterialReference[]
  mcpList: McpServer[]
  mcpSave: McpServer
  mcpRemove: null
  mcpTest: McpTestResult
  workspaceList: WorkspaceList
  workspaceAdd: WorkspaceRecord
  workspaceSelect: WorkspaceRecord
  workspaceGet: WorkspaceRecord | null
  workspaceChoose: WorkspaceRecord | null
  conversationList: ConversationSummary[]
  conversationInfo: ConversationSummary | null
  conversationMarkRead: ConversationSummary
  conversationReceiptRead: ConversationRequestReceipt
  conversationSend: ConversationSnapshot
  conversationRead: ConversationSnapshot
  conversationStop: ConversationSnapshot
  conversationRetry: ConversationSnapshot
  conversationFollow: ConversationFrame
  conversationPermissionRead: ConversationPermission
  conversationPermissionSet: ConversationPermission
  conversationApprovalReply: null
  conversationCommandRun: ConversationCommandReceipt
  conversationCommandRead: ConversationCommandReceipt
  conversationFork: ConversationControlOperation
  conversationCompact: ConversationControlOperation
  conversationControlRead: ConversationControlOperation | null
  conversationCompactCancel: ConversationControlOperation
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
