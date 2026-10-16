const parameters = {
  type: "object",
  properties: {
    arguments: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", maxLength: 65536 },
      description:
        "完整OpenCLI参数，例如browser state、browser open https://example.com、browser click 12、browser type 12 文本、browser scroll down、browser screenshot；Moon插入会话及所选连接。",
    },
  },
  required: ["arguments"],
  additionalProperties: false,
}
export const toolPolicy = (name) =>
  name === "opencli" ? { effect: "write", resource: "browser" } : undefined
export default function extension(pi, { application, context }) {
  pi.registerTool({
    name: "opencli",
    label: "OpenCLI浏览器",
    description:
      "执行官方全局OpenCLI浏览器及站点命令，返回真实CLI结果；使用已选Chrome/Edge登录环境，失联或绑定失效不换环境。截图按需调用browser screenshot。Moon插入会话和profile，不可覆盖profile/session/tab/window路由。借用用户页时，open只接受一个明确网址；analyze、站点/verify、tab和close须先由用户解绑。未绑定时保留完整站点命令，默认使用官方ephemeral会话；显式persistent是上游共享站点会话。安装、升级、卸载及后台管理只从本机插件设置触发。命令可用--help查看实际官方参数。",
    parameters,
    async execute(_id, input, signal) {
      const result = await application.execute(
        input.arguments,
        await context(),
        signal
      )
      if (
        input.arguments[0] === "browser" &&
        input.arguments[1] === "screenshot"
      ) {
        const data = result.text.replace(/^data:image\/png;base64,/, "")
        if (
          /^[A-Za-z0-9+/]+={0,2}$/.test(data) &&
          data.length < 12 * 1024 * 1024
        )
          return {
            content: [
              {
                type: "text",
                text: `实际浏览器截图；连接${result.profile}，会话${result.session}，捕获时刻${result.capturedAt}。`,
              },
              { type: "image", mimeType: "image/png", data },
            ],
            details: { source: result.profile, capturedAt: result.capturedAt },
          }
        if (/^[A-Za-z0-9+/]+={0,2}$/.test(data))
          throw new Error("浏览器截图超过接纳上限，没有作为完整图片返回。")
      }
      return {
        content: [
          {
            type: "text",
            text: result.text || "OpenCLI正常结束，未提供文字结果。",
          },
        ],
        details: { source: result.profile, capturedAt: result.capturedAt },
      }
    },
  })
}
