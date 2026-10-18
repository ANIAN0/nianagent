const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      minLength: 1,
      description: "当前会话相对路径或明确文件绝对路径",
    },
  },
  required: ["path"],
  additionalProperties: false,
}
export const toolPolicy = (name) =>
  ["open_file", "send_file_link"].includes(name)
    ? { effect: "read", resource: "file" }
    : undefined
export default function fileExtension(pi, { application, context }) {
  pi.on("tool_result", (event) => {
    if (
      event.isError ||
      !["write", "edit"].includes(event.toolName) ||
      typeof event.input?.path !== "string"
    )
      return
    const tool = pi.getAllTools().find((tool) => tool.name === event.toolName)
    if (tool?.sourceInfo?.source !== "builtin") return
    const path = event.input.path
    return {
      details: {
        ...event.details,
        moonDelivery: {
          kind: "file-change",
          version: 1,
          summary: `${event.toolName === "write" ? "写入" : "修改"}：${path}`,
          payload: JSON.stringify({ path, name: path.split(/[\\/]/).at(-1) }),
        },
      },
    }
  })
  pi.registerTool({
    name: "open_file",
    label: "打开文件",
    description:
      "请求发起客户端在仍查看当前会话时打开当前文件预览。返回请求事实，不代表客户端实际打开；不覆盖展开或重播历史。",
    parameters,
    async execute(_id, input, signal) {
      const result = await application.requestOpen(
        input,
        await context(),
        signal
      )
      return {
        content: [
          {
            type: "text",
            text: result.requested
              ? `已请求当前客户端预览：${result.path}`
              : `当前客户端未在前台查看本会话，未发送打开请求：${result.path}`,
          },
        ],
        details: undefined,
      }
    },
  })
  pi.registerTool({
    name: "send_file_link",
    label: "交付文件链接",
    description:
      "明确将文件交付给用户，在本轮末尾的文件清单展示。查看、引用或下载时读取当前文件，不保存整文件历史快照。",
    parameters,
    async execute(_id, input, signal) {
      const target = await application.documents.info(
        input,
        await context(),
        signal
      )
      signal?.throwIfAborted()
      return {
        content: [{ type: "text", text: `文件链接：${target.requested}` }],
        details: {
          moonDelivery: {
            kind: "file-link",
            version: 1,
            summary: `文件：${target.name} · ${target.requested}`,
            payload: JSON.stringify({
              path: target.requested,
              name: target.name,
            }),
          },
        },
      }
    },
  })
}
