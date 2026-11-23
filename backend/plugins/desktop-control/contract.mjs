// Pure metadata. Importing the catalog must never execute agent-desktop or touch OS accessibility APIs.
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
    enum: ["install", "upgrade", "uninstall"],
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

const permissionEntry = object(
  {
    state: {
      ...str("权限状态"),
      enum: ["granted", "denied", "not_required", "unknown"],
    },
    suggestion: str("修复建议"),
  },
  ["state"]
)

const status = object({
  installation: object({
    state: {
      ...str("安装检测状态"),
      enum: ["installed", "not-installed", "unavailable"],
    },
    source: nullable({ ...str("安装来源"), enum: ["npm", "path"] }),
    version: nullable(str("已安装版本")),
    path: nullable(str("包目录")),
    cliPath: nullable(str("CLI 入口路径")),
    license: nullable(str("许可证")),
    npmPath: nullable(str("npm 程序路径")),
    nodePath: nullable(str("Node 程序路径")),
    usable: bool("当前安装是否可调用"),
    launcherFallback: bool("是否直接使用 npm 包内的备用原生入口"),
    issue: str("安装诊断"),
    latestVersion: nullable(str("已检测的最新版本")),
    latestIssue: str("版本检查诊断"),
  }),
  environment: object({
    platform: str("当前操作系统平台"),
    ok: bool("运行环境与无障碍总线是否就绪"),
    supportedSurfaces: { type: "array", items: str("支持的无障碍表面") },
    permissions: nullable(
      object({
        accessibility: permissionEntry,
        screen_recording: permissionEntry,
        automation: permissionEntry,
      })
    ),
    stateRoot: str("Moon 托管的 AGENT_DESKTOP_HOME 目录"),
    issue: str("环境诊断"),
  }),
  sessions: object({
    activeCount: num("活跃托管会话数"),
    endedCount: num("已结束托管会话数"),
    latestSessionId: nullable(str("默认导出的会话 ID，无追踪时为最近会话")),
    latestTraceAvailable: bool("默认会话是否可导出追踪"),
  }),
  operation: nullable(job),
  issue: str("当前业务状态或诊断"),
})

const definition = (title, input, result, effect, example = {}) => ({
  title,
  input,
  output,
  documentationOutput: object({ value: result }),
  module: "桌面控制",
  remote: false,
  effect,
  example,
  condition: "桌面控制插件已启用；管理操作仅由本机用户主动触发。",
  errors: "返回实际安装、权限、命令拦截或系统调用失败原因。",
})

export const desktopControlManagement = ["install", "upgrade", "uninstall"]

export const desktopControlOperations = {
  status: definition(
    "读取桌面控制状态",
    object({}),
    status,
    "检测 agent-desktop CLI 安装、OS 权限、支持表面及托管会话统计。"
  ),
  ...Object.fromEntries(
    [
      ["install", "安装官方 agent-desktop CLI"],
      ["upgrade", "升级官方 agent-desktop CLI"],
      ["uninstall", "卸载官方 agent-desktop CLI"],
    ].map(([name, title]) => [
      name,
      definition(
        title,
        object({}),
        object({ operation: job }),
        "启动异步 CLI 管理任务并立即返回任务状态。"
      ),
    ])
  ),
  "probe-windows": definition(
    "检测可见桌面窗口",
    object({}),
    object({
      ok: bool("探测是否成功"),
      windowCount: num("可见窗口数"),
      appCount: num("运行中 GUI 应用数"),
      checkedAt: str("检测时间 ISO 8601"),
      issue: str("探测失败说明"),
    }),
    "执行只读 list-windows 与 list-apps 验证无障碍树可读性。"
  ),
  "request-permissions": definition(
    "请求系统辅助功能权限",
    object({}),
    object({
      accessibility: permissionEntry,
      screen_recording: permissionEntry,
      automation: permissionEntry,
    }),
    "在 macOS 上触发系统授权提示；其他平台拒绝。"
  ),
  "guide-permissions": definition(
    "打开系统权限设置引导",
    object({}),
    object({
      accessibility: permissionEntry,
      screen_recording: permissionEntry,
      automation: permissionEntry,
    }),
    "在 macOS 上打开系统设置引导页；其他平台返回不支持说明。"
  ),
  "export-trace": definition(
    "导出托管会话操作追踪",
    object({ sessionId: str("可选会话 ID，省略时导出最近有追踪的会话") }, []),
    object({ sessionId: str("导出的会话 ID"), path: str("HTML 追踪文件路径") }),
    "调用 agent-desktop trace export 生成单文件 HTML 追踪报告。"
  ),
  "gc-sessions": definition(
    "清理已结束的托管会话",
    object({}),
    object({ removedCount: num("清理的会话数量") }),
    "仅清理 Moon 私有 AGENT_DESKTOP_HOME 下已结束的会话与追踪。"
  ),
}
