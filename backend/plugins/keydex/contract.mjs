// Pure metadata. Importing this catalog must never activate the Keydex plugin or perform network/process I/O.
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
const bool = (description) => ({ type: "boolean", description })
const int = (description, minimum = 0, maximum) => ({
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

const projectSummary = object({
  key: str("项目标识 key"),
  name: str("项目名称"),
})

const connectionState = object({
  state: str("最近连接检测状态", {
    enum: ["unknown", "connected", "error"],
  }),
  baseUrl: str("最近识别或使用的 Keydex 服务地址"),
  source: str("地址来源", { enum: ["none", "configured", "discovered"] }),
  pid: nullable(int("自动发现的 agent-server 进程 PID", 1)),
  identityUser: nullable(str("Keydex 已登录用户名称")),
  pmState: str("PM 平台登录状态"),
  pmUser: nullable(str("PM 平台登录用户名称")),
  projectCount: int("当前可见 PM 项目数", 0),
  projects: { type: "array", items: projectSummary, maxItems: 100 },
  checkedAt: nullable(str("最近检测时间 ISO 8601")),
  error: str("最近失败原因；正常时为空"),
})

export const keydexStatus = object({
  installDir: str("配置的 Keydex 安装目录"),
  baseUrl: str("配置的固定覆盖地址；空表示自动发现"),
  timeoutSeconds: int("请求超时（秒）", 5, 120),
  readOnly: bool("是否处于只读模式"),
  connection: connectionState,
  tools: { type: "array", items: toolItem, maxItems: 64 },
})

const testResult = object({
  ok: bool("本机 Keydex 服务连通性探测是否成功"),
  baseUrl: str("实际探测的 Keydex 服务地址"),
  identityUser: nullable(str("Keydex 登录用户")),
  pmState: str("PM 平台登录状态"),
  pmUser: nullable(str("PM 平台登录用户")),
  projectCount: int("当前可见 PM 项目数", 0),
  latencyMs: int("本次探测耗时（毫秒）", 0),
  error: str("失败原因；成功时为空"),
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "Keydex 插件",
  remote: false,
  effect,
  example,
  condition: "Keydex 插件已启用，仅本机插件详情页可探测连接与查看状态。",
  errors:
    "未发现运行中的 Keydex agent-server 进程、地址无效、服务不可达、请求取消或超时。",
})

export const keydexModule = {
  source: "backend/plugins/keydex/host.mjs",
  storage: "无额外私有存储（配置保存在 Moon 插件配置中）",
  responsibility:
    "自动发现并直连本机 Keydex agent-server HTTP 接口，提供读写分离的 PM、知识库、协作事项与通知工具，并支持对外 MCP 共享。",
}

export const keydexOperations = {
  status: operation(
    "读取 Keydex 插件状态与工具清单",
    object(),
    keydexStatus,
    "读取当前配置摘要、最近连通状态、PM 项目概览与可用工具清单。"
  ),
  testConnection: operation(
    "探测本机 Keydex 服务连接",
    object(),
    testResult,
    "自动发现或连接配置的 Keydex agent-server 地址，检查身份与 PM 平台登录状态。"
  ),
}
