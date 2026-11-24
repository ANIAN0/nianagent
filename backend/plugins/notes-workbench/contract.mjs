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
  url: str("仅 loopback 的工作台地址"),
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
  module: "Moon 笔记工作台",
  remote: false,
  effect,
  example,
  condition:
    "笔记工作台插件已启用，仅本机插件页与 Pi 工具可操作；数据保存在插件数据目录。",
  errors: "名称冲突、条目缺失、存储故障或服务已停止；不会静默重建数据。",
})

export const notesWorkbenchOperations = {
  status: operation(
    "读取工作台运行状态",
    object(),
    serviceStatus,
    "读取端口与运行状态。"
  ),
  save: operation(
    "保存工作台端口",
    object({
      revision: int("读取时配置版本", 0),
      port: int("固定监听端口", 1024, 65535),
    }),
    serviceStatus,
    "端口变更先确认新监听可用，再一起切换笔记和 Skill 的地址。",
    { revision: 0, port: 19830 }
  ),
  reload: operation(
    "重启或重新连接笔记工作台",
    object(),
    object({ version: int("完成重启或连接的时间戳", 0) }),
    "重启 Moon 启动的工作台，或重新连接匹配的服务。笔记和 Skill 会短暂中断。在线的外部工作台由原启动者重启。"
  ),
}
