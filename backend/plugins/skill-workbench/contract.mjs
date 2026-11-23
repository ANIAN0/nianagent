// @ts-check
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

const serviceStatus = object({
  running: { type: "boolean" },
  url: str("仅 loopback 的 Skill 工作台地址"),
  port: int("配置端口", 1024, 65535),
  revision: int("配置版本", 0),
  issue: str("监听错误"),
  logIssue: str("日志写入故障"),
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "Moon Skill 工作台",
  remote: false,
  effect,
  example,
  condition:
    "Skill 工作台插件已启用，仅本机插件页与 Pi 工具可操作；数据保存在插件数据目录。",
  errors: "名称冲突、条目缺失、存储故障或服务已停止；不会静默重建数据。",
})

export const skillWorkbenchOperations = {
  status: operation(
    "读取 Skill 工作台运行状态",
    object(),
    serviceStatus,
    "读取端口与运行状态。"
  ),
  save: operation(
    "保存 Skill 工作台端口",
    object({
      revision: int("读取时配置版本", 0),
      port: int("固定监听端口", 1024, 65535),
    }),
    serviceStatus,
    "端口变更先确认新监听可用，再切换监听地址。",
    { revision: 0, port: 19832 }
  ),
  reload: operation(
    "重启 Skill 工作台进程",
    object(),
    object({ version: int("重启后的实例版本", 0) }),
    "重启独立 Skill 工作台子进程；配置与 Skill 数据不受影响。"
  ),
}
