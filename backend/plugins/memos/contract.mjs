// Pure metadata. Importing this catalog must never activate the Memos plugin or perform network I/O.
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
  user: nullable(str("最近识别的 Memos 用户名")),
  checkedAt: nullable(str("最近检测时间 ISO 8601")),
  error: str("最近失败原因；正常时为空"),
})

export const memosStatus = object({
  configured: bool("是否已配置服务地址与凭据"),
  hasCredentials: bool("是否已保存 Access Token"),
  accessToken: str("已保存的 Access Token（仅本机管理页可见）"),
  credentialSummary: str("脱敏后的凭据摘要"),
  instanceUrl: str("已配置的 Memos 实例地址"),
  readOnly: bool("是否处于只读模式"),
  connection: connectionState,
  tools: { type: "array", items: toolItem, maxItems: 64 },
})

const testResult = object({
  ok: bool("连接与凭据验证是否成功"),
  user: nullable(str("识别的用户名")),
  latencyMs: int("本次探测耗时（毫秒）", 0),
  error: str("失败原因；成功时为空"),
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "Memos 插件",
  remote: false,
  effect,
  example,
  condition: "Memos 插件已启用，仅本机插件详情页可管理凭据与连通性。",
  errors:
    "实例地址无效、凭据缺失或失效、版本无法识别、服务不可达、请求取消、超时或存储失败。",
})

export const memosModule = {
  source: "backend/plugins/memos/host.mjs",
  storage: "plugins/memos/credentials.json（仅本机私有目录）",
  responsibility:
    "直连自托管 Memos HTTP API，提供读写分离的备忘录、评论、附件工具并支持对外 MCP 共享。",
}

export const memosOperations = {
  status: operation(
    "读取 Memos 插件状态与工具清单",
    object(),
    memosStatus,
    "读取当前配置摘要、凭据是否已保存、最近连通状态和工具列表。"
  ),
  setCredentials: operation(
    "保存 Memos Access Token",
    object({
      accessToken: str("Memos Personal Access Token", {
        minLength: 1,
        maxLength: 4096,
      }),
    }),
    memosStatus,
    "将 Access Token 与当前实例地址绑定并原子写入插件私有目录。",
    { accessToken: "memos_pat_example" }
  ),
  clearCredentials: operation(
    "清除 Memos Access Token",
    object(),
    memosStatus,
    "删除插件私有目录中的凭据文件并重置连接状态。"
  ),
  testConnection: operation(
    "测试 Memos 服务连接与凭据",
    object(),
    testResult,
    "读取当前实例版本与已认证用户，更新当前配置的连通状态。"
  ),
}
