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
  protocol: str("现代协议与 SDK 原生 legacy 传输支持"),
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
    "plugins/mcp-service/settings.json 与独立 token.json；日志在 data/logs",
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
    "显示独立 MCP token",
    object(),
    object({ token: str("仅本机显式读取的私密 token") }),
    "读取私密 token，页面按用户操作显示或复制，不写入普通配置和日志。"
  ),
  reset: operation(
    "重置 MCP token",
    object({ revision: int("读取时配置版本", 0) }),
    serviceStatus,
    "使旧 token 失效，关闭 SDK 协议连接并取消在途调用；浏览器原生 session 保留。",
    { revision: 0 }
  ),
}
