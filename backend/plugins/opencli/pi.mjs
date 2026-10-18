import { openCliArguments, toolResult } from "./tool-result.mjs"
export const toolPolicy = (name) =>
  name === "opencli" ? { effect: "write", resource: "browser" } : undefined
export default function extension(pi, { application, context }) {
  pi.registerTool({
    name: "opencli",
    label: "OpenCLI",
    description:
      "调用官方OpenCLI网站命令与浏览器操作，可读取、下载、点击、填表、执行脚本或关闭页面，具有写入影响。用list发现命令，用具体命令--help读取参数。Moon为内部聊天注入原生session与已配置profile；浏览器参数为browser <command>，保留--tab。安装和后台管理从插件详情操作。",
    parameters: {
      ...openCliArguments,
      properties: {
        arguments: {
          ...openCliArguments.properties.arguments,
          description:
            "Moon内部简写argv，例如browser state、browser open https://example.com、browser screenshot；Moon自动注入当前聊天的原生session，不传--session或--profile。",
        },
      },
    },
    async execute(_id, input, signal) {
      const result = await application.execute(
        input.arguments,
        await context(),
        signal
      )
      return {
        ...toolResult(result),
        details: { source: result.profile, capturedAt: result.capturedAt },
      }
    },
  })
}
