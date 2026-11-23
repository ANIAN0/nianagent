const MAX_TEXT_BYTES = 400 * 1024
const MAX_IMAGE_BASE64_BYTES = 12 * 1024 * 1024

export const OBSERVE_COMMANDS = new Set([
  "snapshot",
  "find",
  "get",
  "is",
  "screenshot",
  "list-apps",
  "list-windows",
  "list-displays",
  "list-surfaces",
  "list-notifications",
  "status",
  "permissions",
  "version",
  "skills",
])

export const CLIPBOARD_COMMANDS = new Set([
  "clipboard-get",
  "clipboard-set",
  "clipboard-clear",
])

export const APP_LIFECYCLE_COMMANDS = new Set(["launch", "close-app"])

export const PHYSICAL_COMMANDS = new Set([
  "press",
  "focus-window",
  "open-system-surface",
  "double-click",
  "triple-click",
  "right-click",
  "focus",
  "hover",
  "drag",
  "mouse-move",
  "mouse-click",
  "mouse-wheel",
  "key-down",
  "key-up",
  "mouse-down",
  "mouse-up",
])

const ACT_COMMANDS = new Set([
  "click",
  "double-click",
  "triple-click",
  "right-click",
  "type",
  "set-value",
  "clear",
  "focus",
  "select",
  "toggle",
  "check",
  "uncheck",
  "expand",
  "collapse",
  "scroll",
  "scroll-to",
  "press",
  "key-down",
  "key-up",
  "hover",
  "drag",
  "mouse-move",
  "mouse-click",
  "mouse-down",
  "mouse-up",
  "mouse-wheel",
  "launch",
  "close-app",
  "focus-window",
  "resize-window",
  "move-window",
  "minimize",
  "maximize",
  "restore",
  "open-system-surface",
  "dismiss-notification",
  "dismiss-all-notifications",
  "notification-action",
  "wait",
  "batch",
  ...CLIPBOARD_COMMANDS,
])
const RESERVED_FLAGS = new Set([
  "--session",
  "--agent-id",
  "--trace",
  "--trace-strict",
  "--debug",
  "--screenshot",
  "--out",
  "--force",
])
const LAUNCH_FLAGS = new Set(["--arg", "--env", "--cwd", "--cdp"])
const SCREENSHOT_FLAGS = new Set(["--app", "--window-id", "--screen"])
const STDIN_COMMANDS = new Set(["type", "set-value", "clipboard-set"])

function commandIndex(args) {
  // These are the valueless global flags we accept before a command.
  return args.findIndex((arg) => !["--headed", "--verbose", "-v"].includes(arg))
}

export const observeInputSchema = {
  type: "object",
  properties: {
    arguments: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", maxLength: 65536 },
      description:
        'agent-desktop 只读观测命令 argv，例如 ["status"]、["list-windows"]、["snapshot", "--app", "Notepad", "-i", "--compact"]、["screenshot", "--app", "Notepad"]、["skills", "get", "desktop"]。宿主自动注入 --session，勿传 --session。',
    },
  },
  required: ["arguments"],
  additionalProperties: false,
}

export const actInputSchema = {
  type: "object",
  properties: {
    arguments: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", maxLength: 65536 },
      description:
        'agent-desktop 桌面交互命令 argv，例如 ["click", "@s8f3k2p9:e8"]、["set-value", "@s8f3k2p9:e9", "hello"]、["wait", "--window", "保存"]。宿主自动注入 --session 与策略守卫。',
    },
    stdinText: {
      type: "string",
      maxLength: 131072,
      description:
        "可选。当命令包含 --stdin（如 type --stdin / set-value --stdin / clipboard-set --stdin）时通过标准输入管道传入的文本，避免明文出现在进程命令行参数中。",
    },
  },
  required: ["arguments"],
  additionalProperties: false,
}

export function validateCommandPolicy({
  mode,
  args,
  config,
  stdinText,
  platform = process.platform,
}) {
  if (
    !Array.isArray(args) ||
    args.length === 0 ||
    args.length > 64 ||
    args.some(
      (arg) =>
        typeof arg !== "string" || arg.length > 65536 || arg.includes("\0")
    )
  ) {
    throw new Error("arguments 必须包含 1 至 64 个有效字符串。")
  }

  const flags = new Set(args.map((arg) => arg.split("=", 1)[0]))
  if ([...RESERVED_FLAGS].some((flag) => flags.has(flag))) {
    throw new Error("工具禁止指定会话、追踪或输出路径，也禁止使用 --force。")
  }
  const index = commandIndex(args)
  const command = args[index]
  const headed = flags.has("--headed")
  const observation = mode === "observe"
  if (!(observation ? OBSERVE_COMMANDS : ACT_COMMANDS).has(command)) {
    throw new Error(
      observation
        ? "观察工具仅接受只读命令。"
        : "交互工具仅接受已声明的桌面操作。"
    )
  }
  if (!observation && config.readOnly) {
    throw new Error("桌面控制当前处于只读模式，已拒绝写入与交互操作。")
  }

  function checkAction(name, needsHeaded) {
    const physical =
      PHYSICAL_COMMANDS.has(name) || (name === "type" && platform === "win32")
    if (!config.allowHeaded && (needsHeaded || physical)) {
      throw new Error("当前策略禁止物理键鼠输入或切换桌面焦点。")
    }
    if (CLIPBOARD_COMMANDS.has(name) && !config.allowClipboard) {
      throw new Error("当前策略禁止访问系统剪贴板。")
    }
    if (APP_LIFECYCLE_COMMANDS.has(name) && !config.allowAppLifecycle) {
      throw new Error("当前策略禁止启动或关闭应用。")
    }
  }

  if (observation && headed) {
    throw new Error("观察工具禁止使用 --headed，以免切换桌面焦点。")
  }
  if (
    command === "permissions" &&
    (flags.has("--request") || flags.has("--guide"))
  ) {
    throw new Error("系统授权与引导只能从桌面控制设置页打开。")
  }
  if (
    command === "launch" &&
    [...LAUNCH_FLAGS].some((flag) => flags.has(flag))
  ) {
    throw new Error(
      "桌面工具仅支持直接启动应用，禁止附加进程参数、环境或调试端口。"
    )
  }
  if (command === "screenshot") {
    for (let i = index + 1; i < args.length; i += 1) {
      const token = args[i]
      const [flag] = token.split("=", 1)
      if (["--verbose", "-v"].includes(token)) continue
      if (
        !SCREENSHOT_FLAGS.has(flag) ||
        (!token.includes("=") && (!args[i + 1] || args[++i].startsWith("-")))
      ) {
        throw new Error(
          "截图只接受 --app、--window-id 或 --screen，图片直接返回给调用方。"
        )
      }
    }
  }
  checkAction(
    command,
    headed || (command === "launch" && flags.has("--activate"))
  )

  if (command === "batch") {
    let entries
    try {
      entries = JSON.parse(args[index + 1])
    } catch {
      throw new Error("batch 必须提供 JSON 命令数组。")
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("batch 必须是非空数组。")
    }
    for (const entry of entries) {
      const name = entry?.command
      const params = entry?.args || {}
      if (
        (!ACT_COMMANDS.has(name) && !OBSERVE_COMMANDS.has(name)) ||
        name === "batch" ||
        name === "screenshot" ||
        Object.hasOwn(entry, "session") ||
        params.force ||
        params.stdin ||
        (name === "permissions" && (params.request || params.guide)) ||
        (name === "launch" &&
          ["args", "env", "cwd", "cdp"].some((key) =>
            Object.hasOwn(params, key)
          ))
      ) {
        throw new Error("batch 包含不允许的子命令或参数。")
      }
      checkAction(
        name,
        headed || params.headed || (name === "launch" && params.activate)
      )
    }
  }

  const usesStdin = flags.has("--stdin")
  if (
    usesStdin !== (stdinText !== undefined) ||
    (usesStdin &&
      (!STDIN_COMMANDS.has(command) ||
        typeof stdinText !== "string" ||
        stdinText.length > 131072))
  ) {
    throw new Error(
      "type、set-value 或 clipboard-set 必须同时提供 --stdin 与有效 stdinText。"
    )
  }
  return { command }
}

// 脱敏摘要：绝不落盘控件文本、窗口标题、输入内容、剪贴板或截图字节
export function summarizeDesktopControl({ phase, input, result }) {
  if (phase === "result") {
    const content = Array.isArray(result?.content) ? result.content : []
    return JSON.stringify({
      isError: Boolean(result?.isError),
      content: content.map((block) =>
        block.type === "image"
          ? { type: "image", length: block.data?.length || 0 }
          : { type: "text", length: block.text?.length || 0 }
      ),
    })
  }
  const args = Array.isArray(input?.arguments) ? input.arguments : []
  const candidate = args[commandIndex(args)]
  const command =
    OBSERVE_COMMANDS.has(candidate) || ACT_COMMANDS.has(candidate)
      ? candidate
      : "unknown"
  return JSON.stringify({
    command,
    argumentCount: args.length,
    headed: args.includes("--headed"),
    hasStdinText:
      typeof input?.stdinText === "string" && input.stdinText.length > 0,
  })
}

export async function formatDesktopToolResult({
  stdout,
  stderr,
  code,
  command,
}) {
  const trimmed = (stdout || "").trim()
  let parsed = null
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      /* raw output */
    }
  }

  if (command === "screenshot" && code === 0) {
    const image = parsed?.data
    if (
      parsed?.ok &&
      image?.format === "png" &&
      typeof image.data === "string" &&
      image.data.length <= MAX_IMAGE_BASE64_BYTES
    ) {
      return {
        content: [
          {
            type: "text",
            text: `截图已捕获（${image.width}x${image.height}）。`,
          },
          { type: "image", mimeType: "image/png", data: image.data },
        ],
      }
    }
    if (parsed?.ok || !parsed) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "截图超过 12 MiB 编码上限或返回格式无效，请缩小截取范围后重试。",
          },
        ],
      }
    }
  }

  const rawText =
    trimmed || (stderr || "").trim() || `agent-desktop 退出码 ${code}`
  const bounded =
    rawText.length <= MAX_TEXT_BYTES
      ? rawText
      : `${rawText.slice(0, MAX_TEXT_BYTES)}\n\n[结果超过 400 KiB 已截断，请使用 --skeleton 或 --root 缩小树范围]`

  const isError =
    code !== 0 || (parsed && typeof parsed.ok === "boolean" && !parsed.ok)

  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: bounded }],
  }
}
