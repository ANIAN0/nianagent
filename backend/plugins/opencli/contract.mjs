// Pure metadata. Importing the catalog must never activate OpenCLI or connect a daemon.
const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const str = (description) => ({ type: "string", description })
const bool = (description) => ({ type: "boolean", description })
const num = (description) => ({ type: "integer", description })
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] })
const output = object({ value: { type: "object", additionalProperties: true } })
const job = object({
  id: str("本次管理任务标识"),
  action: {
    ...str("管理动作"),
    enum: ["install", "uninstall", "upgrade", "start", "stop"],
  },
  state: {
    ...str("任务状态；unknown 表示中断后结果需核对"),
    enum: ["running", "succeeded", "failed", "unknown"],
  },
  phase: str("当前进度说明"),
  startedAt: str("开始时间 ISO 8601"),
  endedAt: nullable(str("结束时间 ISO 8601")),
  beforeVersion: nullable(str("操作前版本")),
  targetVersion: nullable(str("目标版本")),
  error: str("失败原因；成功时为空"),
})
const profile = {
  ...object(
    {
      contextId: str("官方 Browser Bridge 连接标识"),
      extensionVersion: str("扩展版本；由官方状态提供时返回"),
      aliases: { type: "array", items: str("官方配置中的连接别名") },
    },
    ["contextId", "aliases"]
  ),
  additionalProperties: true,
  description:
    "官方profiles条目展开透传，Moon补充aliases；这里列出已知字段，保留外部版本的额外字段。",
}
const status = object({
  installation: object({
    state: {
      ...str("安装检测状态"),
      enum: ["installed", "not-installed", "unavailable"],
    },
    source: nullable({
      ...str("安装来源；external 表示来自外部兼容引用"),
      enum: ["npm-global", "external"],
    }),
    ...Object.fromEntries(
      [
        "version",
        "path",
        "cliPath",
        "daemonPath",
        "license",
        "npmPath",
        "nodePath",
        "latestVersion",
      ].map((key) => [
        key,
        nullable(
          str(
            {
              version: "全局安装版本",
              path: "官方包目录",
              cliPath: "CLI 入口",
              daemonPath: "后台入口",
              license: "官方许可证",
              npmPath: "npm 程序路径",
              nodePath: "Node 程序路径",
              latestVersion: "已检测的最新版本",
            }[key]
          )
        ),
      ])
    ),
    usable: bool("当前安装是否可调用"),
    issue: str("安装诊断"),
    latestIssue: str("版本检查诊断"),
  }),
  daemon: object({
    state: {
      ...str("后台实际检测状态"),
      enum: ["running", "stopped", "unknown"],
    },
    pid: nullable(num("后台进程号")),
    version: nullable(str("运行中后台版本")),
    owned: bool("是否为当前 Moon 启动的后台"),
  }),
  bridge: object({
    connected: bool("至少一个 Browser Bridge 已连接"),
    profileRequired: bool("需要显式选择连接"),
    profiles: { type: "array", items: profile },
  }),
  operation: nullable(job),
  browserSupport: nullable(
    object({
      supported: bool("官方版本是否支持 Moon 所需接口"),
      issue: str("不支持原因"),
    })
  ),
  version: nullable(str("当前安装版本")),
  status: nullable({
    type: "object",
    additionalProperties: true,
    description:
      "官方 /status 原始响应，版本由外部 OpenCLI 决定；Moon 只识别 pid、daemonVersion、extensionConnected、profiles、contextId、profileRequired、profileDisconnected，额外字段原样保留。",
  }),
  issue: str("当前业务状态或诊断"),
})
const managementInput = object(
  {
    expectedDaemonPid: { type: "integer", minimum: 1 },
    expectedDaemonVersion: { type: "string", maxLength: 100 },
  },
  []
)
const definition = (title, input, result, effect, example = {}, scope) => ({
  title,
  input,
  output,
  documentationOutput: object({ value: result }),
  module: "OpenCLI 浏览器",
  remote: false,
  ...(scope ? { scope } : {}),
  effect,
  example,
  condition:
    "OpenCLI 应用插件已启用；操作复用官方全局安装和 Browser Bridge，管理只由本机主动触发。后台与浏览器环境配置由宿主管理。",
  errors:
    "返回实际安装、连接、任务占用或资源释放失败原因；管理中断后读取 status 核对，未自动重做。",
})
export const openCliModule = {
  source: "backend/plugins/opencli/host.mjs",
  storage: "官方全局包与后台；Moon 命名会话及当前管理任务在内存中",
  responsibility:
    "检测和管理官方 OpenCLI 安装、后台以及网站与通用浏览器工具接入。",
}
export const openCliManagement = [
  "install",
  "uninstall",
  "upgrade",
  "start",
  "stop",
]
export const openCliOperations = {
  ...Object.fromEntries(
    [
      ["install", "安装官方 OpenCLI"],
      ["uninstall", "卸载官方 OpenCLI"],
      ["upgrade", "升级官方 OpenCLI"],
      ["start", "启动官方后台"],
      ["stop", "停止官方后台"],
    ].map(([name, title]) => [
      name,
      definition(
        title,
        managementInput,
        object({ operation: job }),
        "开始管理任务并立即返回任务身份；全局安装/后台可能影响其他使用者，卸载保留配置。",
        {}
      ),
    ])
  ),
  status: definition(
    "读取安装、后台与任务状态",
    object(),
    status,
    "读取真实全局安装、官方后台与连接状态，不安装或停止后台。"
  ),
  connect: definition(
    "连接或启动官方后台",
    object(),
    status,
    "复用可识别后台，或启动当前安装版本；返回安装、连接及任务状态。"
  ),
}
