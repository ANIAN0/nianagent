// Pure metadata. Importing this module must never execute scrcpy or adb.
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
    enum: ["running", "succeeded", "failed", "cancelled", "unknown"],
  },
  phase: str("当前进度说明"),
  startedAt: str("开始时间 ISO 8601"),
  endedAt: nullable(str("结束时间 ISO 8601")),
  beforeVersion: nullable(str("操作前版本")),
  targetVersion: nullable(str("目标版本")),
  error: str("失败原因；成功时为空"),
  logs: {
    type: "array",
    items: str("实时输出日志行"),
    description: "最近输出日志",
  },
})

const deviceSchema = object({
  serial: str("设备序列号或 IP:端口"),
  state: {
    ...str("ADB 设备状态"),
    enum: ["device", "unauthorized", "offline", "unknown"],
  },
  transport: {
    ...str("连接类型"),
    enum: ["usb", "tcpip"],
  },
  model: str("设备型号"),
  androidVersion: str("Android 系统版本"),
  isDefault: bool("是否为当前默认目标设备"),
  mirroring: bool("是否正在投屏"),
  mirrorPid: nullable(num("投屏进程 PID")),
  issue: str("设备连接或权限诊断提示"),
})

const statusSchema = object({
  installation: object({
    state: {
      ...str("运行环境检测状态"),
      enum: ["ready", "partial", "not-installed", "unavailable"],
    },
    source: nullable({
      ...str("发现来源"),
      enum: ["custom", "path", "package-manager"],
    }),
    packageManager: nullable({
      ...str("可用的系统包管理器"),
      enum: ["winget", "scoop", "choco", "brew"],
    }),
    scrcpyVersion: nullable(str("scrcpy 版本")),
    adbVersion: nullable(str("ADB 版本")),
    scrcpyPath: nullable(str("scrcpy 可执行文件路径")),
    adbPath: nullable(str("adb 可执行文件路径")),
    serverPath: nullable(str("scrcpy-server 路径")),
    usable: bool("scrcpy/adb 是否可执行"),
    canMirror: bool("是否具备原生投屏与 scrcpy-server 控制能力"),
    issue: str("环境诊断"),
  }),
  devices: { type: "array", items: deviceSchema },
  defaultSerial: str("当前配置的默认设备序列号"),
  operation: nullable(job),
  issue: str("当前业务状态或诊断"),
})

const definition = (title, input, result, effect, example = {}) => ({
  title,
  input,
  output,
  documentationOutput: object({ value: result }),
  module: "安卓控制",
  remote: false,
  effect,
  example,
  condition: "安卓控制插件已启用；管理操作仅由本机用户主动触发。",
  errors: "返回实际依赖检测、ADB 连接、设备授权或策略拦截失败原因。",
})

export const androidControlManagement = ["install", "upgrade", "uninstall"]

export const androidControlOperations = {
  status: definition(
    "读取安卓控制状态",
    object({}),
    statusSchema,
    "检测 scrcpy 与 adb 环境、列出当前已连接设备及投屏状态。"
  ),
  ...Object.fromEntries(
    [
      ["install", "安装官方 scrcpy 与 ADB"],
      ["upgrade", "升级官方 scrcpy 与 ADB"],
      ["uninstall", "卸载官方 scrcpy"],
    ].map(([name, title]) => [
      name,
      definition(
        title,
        object({}),
        object({ operation: job }),
        "调用系统包管理器启动异步管理任务并立即返回任务状态。"
      ),
    ])
  ),
  "cancel-manage": definition(
    "取消当前管理任务",
    object({}),
    object({
      cancelled: bool("是否已发送取消信号"),
      operation: nullable(job),
    }),
    "中止正在进行的安装、升级或卸载子进程。"
  ),
  "refresh-devices": definition(
    "刷新安卓设备列表",
    object({}),
    object({ devices: { type: "array", items: deviceSchema } }),
    "重新枚举 ADB 在线设备并更新设备属性。"
  ),
  "connect-wireless": definition(
    "连接无线 ADB 设备",
    object({ address: str("设备 IP:端口，默认端口 5555") }),
    object({
      ok: bool("是否连接成功"),
      serial: str("设备标识"),
      message: str("结果说明"),
    }),
    "执行 adb connect 建立无线 TCP/IP 连接。"
  ),
  "pair-wireless": definition(
    "无线调试配对",
    object({
      address: str("配对界面显示的 IP:端口"),
      pairingCode: str("6 位无线配对码"),
    }),
    object({ ok: bool("是否配对成功"), message: str("结果说明") }),
    "执行 Android 11+ adb pair 完成无线调试配对。"
  ),
  "enable-tcpip": definition(
    "USB 设备一键转无线",
    object({ serial: str("USB 设备序列号"), port: num("TCP/IP 端口") }, [
      "serial",
    ]),
    object({ ok: bool("是否成功"), address: str("无线连接地址") }),
    "读取设备 Wi-Fi IP，开启 adb tcpip 并自动连接。"
  ),
  "disconnect-wireless": definition(
    "断开无线设备",
    object({ serial: str("无线设备 IP:端口") }),
    object({ ok: bool("是否成功") }),
    "执行 adb disconnect 断开指定无线设备。"
  ),
  "start-mirror": definition(
    "启动原生 scrcpy 投屏",
    object(
      {
        serial: str("目标设备序列号"),
        virtualDisplay: str("可选虚拟屏规格，如 1080x2400"),
        startApp: str("可选启动应用包名"),
      },
      []
    ),
    object({
      serial: str("设备序列号"),
      pid: num("投屏进程 PID"),
      mode: str("投屏模式"),
    }),
    "拉起并托管官方原生 scrcpy 窗口。"
  ),
  "stop-mirror": definition(
    "停止原生 scrcpy 投屏",
    object({ serial: str("目标设备序列号") }),
    object({ ok: bool("是否成功") }),
    "结束指定设备的托管 scrcpy 投屏窗口。"
  ),
  "probe-device": definition(
    "只读连通性测试",
    object({ serial: str("目标设备序列号") }, []),
    object({
      ok: bool("设备观察链路是否可用"),
      serial: str("设备序列号"),
      model: str("设备型号"),
      resolution: str("屏幕分辨率"),
      uiNodeCount: num("解析到的可交互控件数"),
      checkedAt: str("检测时间 ISO 8601"),
      issue: str("诊断信息"),
    }),
    "执行一次只读截图与 UI 控件树解析验证连通性。"
  ),
}
