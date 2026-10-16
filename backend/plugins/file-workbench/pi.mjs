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
        details: {
          moonPresentation: {
            kind: "file-link",
            version: 1,
            payload: JSON.stringify({
              path: result.requestedPath,
              name: result.name,
            }),
          },
        },
      }
    },
  })
  pi.registerTool({
    name: "send_file_link",
    label: "交付文件链接",
    description:
      "在当前工具结果提供文件路径链接。用户查看、引用或下载时读取当前文件；文件后续变化不保留历史文件版本。",
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
          moonPresentation: {
            kind: "file-link",
            version: 1,
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
