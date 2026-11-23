const MAX_TEXT_BYTES = 400 * 1024
const MAX_IMAGE_BASE64_BYTES = 12 * 1024 * 1024

export const OBSERVE_ACTIONS = [
  "list-devices",
  "device-info",
  "screenshot",
  "ui-tree",
  "list-apps",
]

export const ACT_ACTIONS = [
  "tap",
  "long-press",
  "swipe",
  "scroll",
  "input-text",
  "key",
  "wake",
  "sleep",
  "expand-notifications",
  "collapse-panels",
  "rotate",
  "launch-app",
  "stop-app",
  "clipboard-get",
  "clipboard-set",
  "install-apk",
  "push-file",
  "pull-file",
  "open-mirror",
  "close-mirror",
]

export const observeInputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: OBSERVE_ACTIONS,
      description:
        "只读观察动作：list-devices / device-info / screenshot / ui-tree / list-apps。",
    },
    serial: {
      type: "string",
      description: "可选目标设备序列号；未指定时自动使用默认设备或唯一在线设备。",
    },
    includeNonInteractive: {
      type: "boolean",
      description: "ui-tree 可选：是否包含无交互文本容器节点，默认 false。",
    },
    includeSystem: {
      type: "boolean",
      description: "list-apps 可选：是否包含系统应用，默认 false。",
    },
    query: {
      type: "string",
      description: "list-apps 可选：按包名关键词过滤。",
    },
  },
  required: ["action"],
  additionalProperties: false,
}

export const actInputSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ACT_ACTIONS,
      description:
        "设备交互动作：tap / long-press / swipe / scroll / input-text / key / wake / sleep / expand-notifications / collapse-panels / rotate / launch-app / stop-app / clipboard-get / clipboard-set / install-apk / push-file / pull-file / open-mirror / close-mirror。",
    },
    serial: {
      type: "string",
      description: "可选目标设备序列号；未指定时自动使用默认设备或唯一在线设备。",
    },
    ref: {
      type: "string",
      description: "tap / long-press 可选：来自 ui-tree 的控件引用，例如 @e3。",
    },
    x: { type: "number", description: "横坐标像素值。" },
    y: { type: "number", description: "纵坐标像素值。" },
    x2: { type: "number", description: "swipe 终点横坐标。" },
    y2: { type: "number", description: "swipe 终点纵坐标。" },
    durationMs: {
      type: "number",
      description: "swipe / long-press 持续时间（毫秒）。",
    },
    direction: {
      type: "string",
      enum: ["up", "down", "left", "right"],
      description: "scroll 滚动方向。",
    },
    amount: {
      type: "number",
      description: "scroll 滚动幅度（1~16，默认 4）。",
    },
    text: {
      type: "string",
      maxLength: 65536,
      description: "input-text 或 clipboard-set 的文本内容（支持中文与 Unicode）。",
    },
    paste: {
      type: "boolean",
      description: "clipboard-set 可选：写入剪贴板后是否立即触发粘贴。",
    },
    key: {
      type: "string",
      enum: [
        "back",
        "home",
        "recents",
        "enter",
        "delete",
        "power",
        "volume-up",
        "volume-down",
        "tab",
        "escape",
        "space",
      ],
      description: "key 动作的按键名称。",
    },
    packageName: {
      type: "string",
      description: "launch-app / stop-app / open-mirror 的应用包名。",
    },
    localPath: {
      type: "string",
      description: "install-apk / push-file / pull-file 的本机文件路径。",
    },
    remotePath: {
      type: "string",
      description: "push-file / pull-file 的设备端路径（如 /sdcard/Download/a.txt）。",
    },
    virtualDisplay: {
      type: "string",
      description: "open-mirror 可选：新建虚拟屏尺寸，如 1080x2400。",
    },
  },
  required: ["action"],
  additionalProperties: false,
}

export function validateAndroidPolicy({ mode, input, config }) {
  const action = String(input?.action || "").trim()
  if (!action) throw new Error("action 不能为空。")

  if (mode === "observe") {
    if (!OBSERVE_ACTIONS.includes(action)) {
      throw new Error(`动作 ${action} 不是只读观察动作，请改用 android_act。`)
    }
    return { action }
  }

  if (!ACT_ACTIONS.includes(action)) {
    throw new Error(`不支持的控制动作：${action}`)
  }

  if (config.readOnly) {
    throw new Error(
      "安卓控制当前处于「只读模式」，已禁止所有控制与写入操作。如需操作设备，请在插件详情页关闭只读模式。"
    )
  }

  if (
    (action === "clipboard-get" || action === "clipboard-set") &&
    !config.allowClipboard
  ) {
    throw new Error(
      "当前安全策略禁止访问手机剪贴板（allowClipboard=false）。如需读写剪贴板，请在插件详情页开启。"
    )
  }

  if (
    (action === "launch-app" || action === "stop-app") &&
    !config.allowAppLifecycle
  ) {
    throw new Error(
      "当前安全策略禁止启动或停止应用（allowAppLifecycle=false）。如需执行，请在插件详情页开启。"
    )
  }

  if (action === "install-apk" && !config.allowApkInstall) {
    throw new Error(
      "当前安全策略禁止安装 APK（allowApkInstall=false）。如需安装应用，请在插件详情页开启。"
    )
  }

  if (
    (action === "push-file" || action === "pull-file") &&
    !config.allowFileTransfer
  ) {
    throw new Error(
      "当前安全策略禁止文件传输（allowFileTransfer=false）。如需传输文件，请在插件详情页开启。"
    )
  }

  return { action }
}

export function formatTextToolResult(payload, details = {}) {
  let text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    text = `${text.slice(0, MAX_TEXT_BYTES)}\n... [输出超过上限已截断]`
  }
  return {
    content: [{ type: "text", text }],
    details,
  }
}

export function formatScreenshotToolResult(buffer, meta = {}) {
  const base64 = buffer.toString("base64")
  if (base64.length > MAX_IMAGE_BASE64_BYTES) {
    throw new Error(
      `截图体积超过 12 MiB 限制（${Math.round(base64.length / 1024 / 1024)} MiB）。`
    )
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(meta),
      },
      {
        type: "image",
        mimeType: "image/png",
        data: base64,
      },
    ],
    details: {
      action: "screenshot",
      serial: meta.serial,
      bytes: buffer.length,
    },
  }
}

export function summarizeAndroidControl({ toolName, input, result, error }) {
  return {
    tool: toolName,
    action: input?.action || "",
    serial: input?.serial ? String(input.serial).slice(0, 32) : "",
    ok: !error,
    transport: result?.details?.transport || "",
    error: error ? String(error.message || error).slice(0, 240) : "",
  }
}
