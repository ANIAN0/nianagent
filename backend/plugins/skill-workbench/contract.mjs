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

const key = str("标识", { pattern: "^[a-zA-Z0-9_-]{1,128}$" })
const token = str("预览标识", { pattern: "^[0-9a-f-]{36}$" })
const summary = object({ outcome: str("状态"), reason: str("详情") })
export const skillWorkbenchOperations = {
  sharedSources: operation(
    "读取共享源登记",
    object(),
    { type: "array", items: str("共享源路径") },
    "仅读取已登记的共享目录。"
  ),
  listProjectSkills: operation(
    "列出项目 Skill 库",
    object(),
    {
      type: "array",
      items: object({
        id: key,
        name: str("名称"),
        slug: key,
        version: int("已发布版本", 0),
        source: str("共享源路径"),
      }),
    },
    "查询工作台和共享源登记。"
  ),
  previewInstall: operation(
    "预览项目 Skill 操作",
    object(
      {
        projectId: key,
        libraryId: key,
        location: {
          type: "string",
          enum: [".agents/skills", ".claude/skills"],
        },
        mode: {
          type: "string",
          enum: [
            "source",
            "link",
            "copy",
            "unlink",
            "publish",
            "detach",
            "takeover",
          ],
        },
        decisions: {
          type: "object",
          additionalProperties: { type: "string", enum: ["local", "library"] },
        },
      },
      ["projectId", "libraryId", "location", "mode"]
    ),
    {
      oneOf: [
        object({ previewId: token, diff: str("操作摘要") }),
        object({ conflicts: { type: "array", items: str("冲突文件") } }),
      ],
    },
    "检查项目目录、安装位置和共享源。"
  ),
  applyInstall: operation(
    "应用项目 Skill 操作",
    object({ previewId: token }),
    summary,
    "复核项目与共享源并更新安装关系。"
  ),
  installResult: operation(
    "读取项目 Skill 操作回执",
    object({ previewId: token }),
    summary,
    "读取原操作结果。"
  ),
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
    "端口变更先确认新监听可用，再一起切换笔记和 Skill 的地址。",
    { revision: 0, port: 19830 }
  ),
  reload: operation(
    "重启 Skill 工作台进程",
    object(),
    object({ version: int("重启后的实例版本", 0) }),
    "重启 Moon 启动的共享工作台，或重新连接匹配的服务。笔记和 Skill 会短暂中断。在线的外部工作台由原启动者重启。"
  ),
}
