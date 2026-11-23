// Pure metadata. Importing this catalog must never activate FileBrowser or perform network I/O.
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

const connectionState = object({
  state: str("最近连接检测状态", {
    enum: ["unconfigured", "unknown", "connected", "error"],
  }),
  user: nullable(str("最近登录识别的用户名")),
  checkedAt: nullable(str("最近检测时间 ISO 8601")),
  error: str("最近失败原因；正常时为空"),
})

export const filebrowserStatus = object({
  configured: bool("是否已配置服务地址与凭据"),
  hasCredentials: bool("是否已保存账号密码"),
  username: str("已保存的用户名（仅本机管理页可见）"),
  password: str("已保存的密码（仅本机管理页可见）"),
  credentialSummary: str("脱敏后的账号摘要"),
  instanceUrl: str("已配置的 FileBrowser 实例地址"),
  rootPrefix: str("远程根路径沙箱前缀"),
  readOnly: bool("是否处于只读模式"),
  connection: connectionState,
  tools: { type: "array", items: toolItem, maxItems: 64 },
})

const testResult = object({
  ok: bool("连接与登录验证是否成功"),
  user: nullable(str("登录用户名")),
  latencyMs: int("本次探测耗时（毫秒）", 0),
  error: str("失败原因；成功时为空"),
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "FileBrowser 插件",
  remote: false,
  effect,
  example,
  condition: "FileBrowser 插件已启用，仅本机插件详情页可管理凭据与连通性。",
  errors: "实例地址无效、账号密码缺失或错误、服务不可达、超时或存储失败。",
})

export const filebrowserModule = {
  source: "backend/plugins/filebrowser/host.mjs",
  storage: "plugins/filebrowser/credentials.json（仅本机私有目录）",
  responsibility:
    "兼容已归档的 filebrowser/filebrowser 既有实例，使用账号密码登录和文件 HTTP API 提供读写分离的工具及 MCP 共享。",
}

export const filebrowserOperations = {
  status: operation(
    "读取 FileBrowser 插件状态与工具清单",
    object(),
    filebrowserStatus,
    "读取当前配置摘要、凭据是否已保存、最近连通状态和工具列表。"
  ),
  setCredentials: operation(
    "保存 FileBrowser 登录凭据",
    object({
      username: str("FileBrowser 用户名", { minLength: 1, maxLength: 256 }),
      password: str("FileBrowser 密码", { minLength: 1, maxLength: 4096 }),
    }),
    filebrowserStatus,
    "将账号密码原子写入插件私有目录并重置内存 JWT，不回显密码明文。",
    { username: "admin", password: "example-password" }
  ),
  clearCredentials: operation(
    "清除 FileBrowser 登录凭据",
    object(),
    filebrowserStatus,
    "删除插件私有目录中的凭据文件并清空内存 JWT。"
  ),
  testConnection: operation(
    "测试 FileBrowser 服务连接与登录",
    object(),
    testResult,
    "使用已保存凭据登录 FileBrowser 并更新插件业务状态。测试结果不识别实例版本或文件权限。"
  ),
}
