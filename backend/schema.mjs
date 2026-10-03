import { workspaceSchemas } from "./workspace-contract.mjs"
// JSON Schema subset used by runtime validation, generated TypeScript and docs.
const string = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})
const integer = (description) => ({ type: "integer", minimum: 1, description })
const boolean = (description) => ({ type: "boolean", description })
const enumeration = (values, description) =>
  string(description, { enum: values })
const array = (items, description) => ({ type: "array", items, description })
export const object = (
  properties,
  required = Object.keys(properties),
  description = "",
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  description,
})
export const ref = (name) => ({ $ref: name })
const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
export const schemas = {
  ...workspaceSchemas,
  InstructionScope: enumeration(
    ["all", "directory", "none"],
    "项目指令加载范围，不影响应用系统指令。",
  ),
  SessionTool: object({
    id: string("Pi 注册工具名"),
    name: string("工具名称"),
    description: string("Pi 工具描述"),
    group: string("工具来源"),
    detail: string("工具完整说明"),
    available: boolean("注册且本机依赖已找到；具体文件权限在执行时判断"),
    unavailableReason: string("依赖缺失原因；可用时为空"),
  }),
  SessionInstruction: object({
    path: string("实际指令文件绝对路径"),
    source: enumeration(
      ["global", "directory"],
      "Moon 个人指令或工作目录链指令",
    ),
    content: string("本次实际加载的指令内容"),
  }),
  SessionConfiguration: object({
    sessionId: string("会话稳定标识"),
    cwd: string("会话工作目录"),
    revision: integer("配置乐观并发版本"),
    toolIds: array(string("已选择工具名"), "保存的工具选择"),
    effectiveToolIds: array(
      string("Pi 活动工具名"),
      "从真实 Pi 会话读回的生效集合",
    ),
    unavailableToolIds: array(
      string("失效工具名"),
      "只读；保存但未知或本机依赖失效的工具，可取消后重新应用",
    ),
    instructionScope: ref("InstructionScope"),
    instructions: array(ref("SessionInstruction"), "已提交的有效指令快照"),
  }),
  SessionCatalog: object({
    cwd: string("解析后的真实工作目录"),
    tools: array(ref("SessionTool"), "本宿主实际注册的 Pi 内置工具"),
    instructions: array(
      ref("SessionInstruction"),
      "当前目录发现的所有指令；应用按范围选择",
    ),
    defaults: object({
      toolIds: array(string("Pi 默认活动工具名"), "默认活动集"),
      instructionScope: ref("InstructionScope"),
    }),
  }),

  DirectoryProtocol: enumeration(
    ["openai-completions", "anthropic-messages"],
    "模型目录协议；Responses 仅用于模型调用，不提供目录接口。",
  ),
  ModelApi: string(
    "模型调用协议；自定义模型支持 openai-completions / openai-responses / anthropic-messages，订阅沿用 Pi 协议。",
  ),
  ThinkingLevelMap: object(
    Object.fromEntries(
      levels.map((level) => [
        level,
        {
          anyOf: [string("传给模型提供者的等级值"), { type: "null" }],
          description: "null 表示不支持；缺省遵从 Pi 默认映射。",
        },
      ]),
    ),
    [],
  ),
  ModelDefinition: object(
    {
      id: string("服务实际返回的模型 ID，调用时原样使用。", {
        minLength: 1,
        maxLength: 300,
      }),
      name: string("模型显示名称。", { minLength: 1, maxLength: 300 }),
      api: ref("ModelApi"),
      reasoning: boolean(
        "是否支持思考；未匹配时缺省，保存 API 模型前必须补全。",
      ),
      thinkingLevelMap: ref("ThinkingLevelMap"),
      supportedThinkingLevels: array(
        enumeration(levels, "Pi 思考等级"),
        "只读；由 Pi 依据模型能力计算，不支持思考时为空。",
      ),
      input: array(
        enumeration(["text", "image"], "输入模态"),
        "支持的输入模态。",
      ),
      contextWindow: integer("上下文 token 上限，保存 API 模型前必填。"),
      maxTokens: integer(
        "输出 token 上限，不能超过上下文；保存 API 模型前必填。",
      ),
      metadata: object({
        status: enumeration(["matched", "partial", "unknown"], "能力匹配状态"),
        sources: array(string("Pi provider/model"), "匹配来源"),
        conflicts: array(string("存在分歧的字段"), "需要用户确认的字段"),
      }),
    },
    ["id", "name", "api", "input"],
  ),
  ModelConnection: object(
    {
      id: string("稳定连接 ID；创建后不变。", {
        pattern: "^[a-zA-Z0-9_-]+$",
        maxLength: 100,
      }),
      name: string("连接名称，不区分大小写唯一。", {
        minLength: 1,
        maxLength: 100,
      }),
      kind: enumeration(["api", "subscription"], "连接类型，保存后不可更改。"),
      revision: integer(
        "编辑/删除必须带读取到的版本；新建不传，旧版本或已删除记录拒绝覆盖。",
      ),
      providerId: string("订阅选择 Pi 提供者，每个提供者只允许一个连接。", {
        maxLength: 100,
      }),
      protocol: ref("DirectoryProtocol"),
      issue: string("只读的配置问题说明。"),
      endpoint: string(
        "HTTP(S)服务端点；可空保存，发现/调用前必填；禁止内嵌凭据、查询和片段。",
        { maxLength: 1000 },
      ),
      credential: enumeration(
        ["key", "environment", "none"],
        "凭据方式；切换会清除旧存储密钥。",
      ),
      keySaved: boolean("只读凭据存在标记，不是密钥内容。"),
      apiKey: string("仅请求可带密钥；响应固定空串。禁止命令/变量表达式。", {
        maxLength: 16000,
      }),
      clearKey: boolean("明确删除存储密钥。空密钥默认保留已保存值。"),
      environmentVariable: string(
        "后端环境变量名称，仅 environment 模式使用。",
      ),
      headers: string(
        "JSON 字符串字典；只允许字面量，禁止认证头、命令和变量表达式。",
      ),
      account: object({
        name: string("账号显示名"),
        plan: string("账号类型"),
        loggedIn: boolean("是否存在订阅凭据；实际权限需检查模型调用。"),
      }),
      models: {
        ...array(
          ref("ModelDefinition"),
          "该连接保存的模型，API 模型 ID 不能重复。",
        ),
        maxItems: 1000,
      },
    },
    [
      "id",
      "name",
      "kind",
      "endpoint",
      "credential",
      "keySaved",
      "apiKey",
      "environmentVariable",
      "headers",
      "models",
    ],
  ),
  AuthEvent: object(
    {
      type: string("Pi 通知类型"),
      message: string("提示内容"),
      url: string("授权 HTTPS URL"),
      instructions: string("操作说明"),
      userCode: string("设备码"),
      verificationUri: string("设备验证 URL"),
      expiresInSeconds: { type: "number", description: "有效期秒数" },
      intervalSeconds: { type: "number", description: "轮询间隔秒数" },
      links: array(
        object({ url: string("链接地址"), label: string("显示名") }, ["url"]),
        "授权链接",
      ),
    },
    ["type"],
  ),
  AuthPrompt: object(
    {
      id: string("当前提示 ID"),
      type: string("Pi 提示类型，如 select / secret / manual_code"),
      message: string("提示内容"),
      placeholder: string("占位提示"),
      options: array(
        object(
          {
            id: string("选项值"),
            label: string("显示名"),
            description: string("选项说明"),
          },
          ["id", "label"],
        ),
        "仅 select 提示提供",
      ),
    },
    ["id", "type", "message"],
  ),
  AuthState: object(
    {
      id: string("授权任务 ID"),
      status: enumeration(
        ["pending", "complete", "error", "cancelled"],
        "任务状态",
      ),
      connection: ref("ModelConnection"),
      error: string("安全错误说明"),
      events: array(ref("AuthEvent"), "Pi 实际通知，不含凭据"),
      prompt: ref("AuthPrompt"),
    },
    ["id", "status", "connection", "events"],
  ),
}
export function assertSchema(schema, value, path = "参数") {
  if (schema.$ref) return assertSchema(schemas[schema.$ref], value, path)
  const invalid = (message) => {
    const error = new Error(`${path}：${message}`)
    error.name = "ContractError"
    throw error
  }
  if (schema.anyOf) {
    if (
      schema.anyOf.some((option) => {
        try {
          assertSchema(option, value, path)
          return true
        } catch {
          return false
        }
      })
    )
      return
    invalid("类型不符合契约")
  }
  if (schema.enum && !schema.enum.includes(value)) invalid("不在允许选项中")
  if (schema.type === "null") {
    if (value !== null) invalid("必须为 null")
    return
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) invalid("必须为数组")
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      invalid("元素过多")
    value.forEach((item, index) =>
      assertSchema(schema.items, item, `${path}[${index}]`),
    )
    return
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      invalid("必须为对象")
    for (const key of schema.required ?? [])
      if (value[key] === undefined) invalid(`缺少 ${key}`)
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) {
        if (schema.additionalProperties === false) invalid("包含未声明字段")
        continue
      }
      if (value[key] !== undefined)
        assertSchema(schema.properties[key], value[key], `${path}.${key}`)
    }
    return
  }
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) invalid("必须为安全整数")
  } else if (typeof value !== schema.type) invalid(`必须为 ${schema.type}`)
  if (schema.minimum !== undefined && value < schema.minimum)
    invalid("低于最小值")
  if (schema.minLength !== undefined && value.length < schema.minLength)
    invalid("内容过短")
  if (schema.maxLength !== undefined && value.length > schema.maxLength)
    invalid("内容过长")
  if (schema.pattern && !new RegExp(schema.pattern).test(value))
    invalid("格式不正确")
}
