// Generated from backend/schema.mjs and backend/contract.mjs. Do not edit.
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
