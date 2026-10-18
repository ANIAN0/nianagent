export const openCliArguments = {
  type: "object",
  properties: {
    arguments: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", maxLength: 65536 },
      description:
        "OpenCLI 原生命令 argv 数组，浏览器使用 --session 和 --tab；profile 使用插件配置。",
    },
  },
  required: ["arguments"],
  additionalProperties: false,
}
export function openCliBrowserCommand(args) {
  if (args[0] !== "browser") return ""
  let index = 1
  while (args[index]?.startsWith("-")) {
    const option = args[index]
    if (option === "--") return ""
    index += ["--session", "--tab", "--window", "--format", "-f"].includes(
      option
    )
      ? 2
      : 1
  }
  return args[index] || ""
}
// Only bounded identifiers and known command names are explicitly safe. Never
// persist URLs, type text, eval scripts, page bodies, stderr or image payloads.
export function summarizeOpenCli({ phase, input, result }) {
  if (phase === "result")
    return JSON.stringify({
      content: result.content.map((block) =>
        block.type === "image"
          ? { type: "image", length: block.data.length }
          : { type: "text", length: block.text.length }
      ),
    })
  const args = input.arguments,
    safe = (value) =>
      /^[A-Za-z0-9_-]{1,64}$/.test(value || "") ? value : "未提供或省略"
  const sessionOption = args.findIndex(
    (arg) => arg === "--session" || arg.startsWith("--session=")
  )
  const tabIndex = args.findIndex(
    (arg) => arg === "--tab" || arg.startsWith("--tab=")
  )
  const commands = [
    "state",
    "open",
    "click",
    "type",
    "scroll",
    "screenshot",
    "eval",
    "extract",
    "snapshot",
    "tab",
    "close",
    "wait",
    "press",
    "hover",
    "back",
    "forward",
    "reload",
  ]
  return JSON.stringify({
    argumentCount: args.length,
    lengths: args.map((arg) => arg.length),
    surface: args[0] === "browser" ? "browser" : "网站命令或发现",
    session:
      args[0] === "browser"
        ? safe(
            sessionOption >= 0
              ? args[sessionOption].includes("=")
                ? args[sessionOption].split("=")[1]
                : args[sessionOption + 1]
              : ""
          )
        : "未提供",
    tab:
      tabIndex >= 0
        ? safe(
            args[tabIndex].includes("=")
              ? args[tabIndex].split("=")[1]
              : args[tabIndex + 1]
          )
        : "未提供",
    command: commands.includes(openCliBrowserCommand(args))
      ? openCliBrowserCommand(args)
      : "其他原生命令",
  })
}
export function toolResult(result) {
  if (
    result.screenshot &&
    result.data?.ok === true &&
    typeof result.data.data === "string"
  ) {
    const data = result.data.data
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      if (data.length >= 12 * 1024 * 1024)
        throw new Error("浏览器截图超过接纳上限，没有作为完整图片返回。")
      return {
        content: [
          {
            type: "text",
            text: `实际浏览器截图；捕获时刻${result.capturedAt}。`,
          },
          { type: "image", mimeType: "image/png", data },
        ],
      }
    }
  }
  return {
    content: [
      {
        type: "text",
        text: result.text || "OpenCLI正常结束，未提供文字结果。",
      },
    ],
  }
}
