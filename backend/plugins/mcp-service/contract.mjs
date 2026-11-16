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
const int = (description, minimum, maximum) => ({
  type: "integer",
  description,
  minimum,
  maximum,
})
export const sharedToolDescriptor = object({
  name: str("带所属插件前缀的稳定工具名"),
  plugin: str("所属插件"),
  generation: int("当前应用代次", 0),
  description: str("工具说明及外部影响"),
  inputSchema: { type: "object", additionalProperties: true },
  annotations: { type: "object", additionalProperties: { type: "boolean" } },
})
export const serviceStatus = object({
  running: { type: "boolean" },
  url: str("仅 loopback 的 /mcp 地址"),
  port: int("配置端口", 1024, 65535),
  revision: int("配置版本", 0),
  selected: { type: "array", items: str("用户授权工具名"), maxItems: 128 },
  tools: { type: "array", items: sharedToolDescriptor },
  issue: str("监听错误"),
  logIssue: str("日志写入故障"),
  identity: object({
    actors: int("登记 actor 数", 0),
    credentials: int("凭据记录数（含撤销）", 0),
    valid: int("有效（未撤销）凭据数", 0),
  }),
  protocol: str("现代协议与 SDK 原生 legacy 传输支持"),
})
export const registeredCredential = object({
  actorId: str("作者身份标识；轮换保持不变"),
  displayName: str("登记时显示名"),
  kind: str("agent 为专属 Agent 凭据，legacy 为旧共享凭据"),
  credentialId: str("本次接入凭据标识；轮换后变化"),
  createdAt: str("登记时间"),
  revokedAt: str("撤销时间；空字符串未撤销"),
  valid: { type: "boolean", description: "是否有效（未撤销）" },
})
export const registrationResult = object({
  actorId: str("作者身份标识"),
  displayName: str("登记显示名"),
  credentialId: str("凭据标识"),
  token: str("仅本次响应显示的接入 token"),
  revision: int("登记表版本", 0),
})
const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "Moon MCP 出口",
  remote: false,
  effect,
  example,
  condition:
    "MCP 服务插件已启用，仅本机插件页可管理；token 与普通插件配置分开保存。",
  errors: "端口占用、配置版本冲突、存储故障或已停止；不会静默改用随机端口。",
})
export const mcpServiceModule = {
  source: "backend/plugins/mcp-service/host.mjs",
  storage:
    "plugins/mcp-service/settings.json 与 credentials.json（actor/凭据登记表，撤销记录归档 credentials-archive.json）；日志在 data/logs",
  responsibility: "以官方 MCP SDK 暴露宿主共享工具目录及统一调用边界。",
}
export const mcpServiceOperations = {
  status: operation(
    "读取本机 MCP 服务与共享目录",
    object(),
    serviceStatus,
    "读取当前地址、授权和宿主目录，不返回 token。"
  ),
  save: operation(
    "保存端口与共享工具",
    object({
      revision: int("读取时配置版本", 0),
      port: int("固定监听端口", 1024, 65535),
      selected: {
        type: "array",
        items: str("授权工具名", {
          pattern: "^[a-z][a-z0-9-]{0,63}__[a-z][a-z0-9_]{0,47}$",
        }),
        maxItems: 128,
      },
    }),
    serviceStatus,
    "保存授权；移除立即拒绝缓存调用并取消在途执行。端口变更先确认新监听可用。",
    { revision: 0, port: 19826, selected: [] }
  ),
  reveal: operation(
    "显示旧共享凭据 token",
    object(),
    object({
      token: str(
        "仅本机显式读取的私密 token；专有 Agent 凭据只在登记/轮换响应显示一次"
      ),
    }),
    "读取旧共享凭据 token，页面按用户操作显示或复制，不写入普通配置和日志。"
  ),
  register: operation(
    "登记 Agent 专属凭据",
    object({ displayName: str("Agent 显示名", { maxLength: 64 }) }),
    registrationResult,
    "新建稳定 actor 与初始凭据；token 仅本次响应可见。有效凭据达上限时明确拒绝。",
    { displayName: "审阅 Agent A" }
  ),
  rotate: operation(
    "轮换 Agent 凭据",
    object({ actorId: str("作者身份标识", { minLength: 1 }) }),
    registrationResult,
    "撤销该 actor 当前有效凭据并签发新凭据；actorId 不变，历史归属不改写，不迁移既有 session。"
  ),
  revoke: operation(
    "撤销凭据",
    object({ credentialId: str("凭据标识", { minLength: 1 }) }),
    serviceStatus,
    "撤销立即生效于后续认证与会话归属校验，并关闭该凭据的有状态 session；已接受操作按真实生命周期收尾。"
  ),
  credentials: operation(
    "读取凭据登记表",
    object(),
    object({
      credentials: {
        type: "array",
        items: registeredCredential,
        maxItems: 256,
      },
    }),
    "列出 actor 与凭据（含已撤销），不返回 token。"
  ),
  reset: operation(
    "轮换旧共享凭据",
    object({ revision: int("读取时配置版本", 0) }),
    serviceStatus,
    "使旧共享凭据 token 失效并签发新 token，关闭其协议连接与在途调用；不迁移既有 session。",
    { revision: 0 }
  ),
}
