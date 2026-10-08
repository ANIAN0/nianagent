import { Type } from "@earendil-works/pi-ai"

// A disabled-by-default development example exercises the public host contract.
// Its implementation has no access to Pi, SessionManager, credentials or drafts.
export default {
  apiVersion: 1,
  id: "example-note",
  version: "1.0.0",
  name: "扩展接入示例",
  description: "用于开发验证的短记录工具；默认停用，不读取或修改用户文件。",
  configurationSchema: Type.Object(
    {
      prefix: Type.String({
        title: "记录前缀",
        description: "结果标题中的简短前缀",
        default: "记录",
        minLength: 1,
        maxLength: 24,
      }),
    },
    { additionalProperties: false }
  ),
  defaultConfiguration: { prefix: "记录" },
  resultKinds: [
    {
      kind: "moon.note",
      version: 1,
      schema: Type.Object(
        {
          title: Type.String({ maxLength: 64 }),
          text: Type.String({ maxLength: 2000 }),
        },
        { additionalProperties: false }
      ),
    },
  ],
  tools: [
    {
      id: "note",
      label: "生成短记录",
      description:
        "将给定文字转成短记录。开发验收时可指定等待时间或失败，不读取和写入文件。",
      parameters: Type.Object(
        {
          text: Type.String({
            description: "记录正文",
            minLength: 1,
            maxLength: 2000,
          }),
          delayMs: Type.Optional(
            Type.Integer({
              minimum: 0,
              maximum: 30000,
              description: "开发验证取消时的等待毫秒数",
            })
          ),
          fail: Type.Optional(
            Type.Boolean({ description: "开发验证错误隔离，默认false" })
          ),
        },
        { additionalProperties: false }
      ),
      async execute({ arguments: input, configuration, signal }) {
        signal.throwIfAborted()
        if (input.delayMs)
          await new Promise((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer)
              signal.removeEventListener("abort", abort)
              reject(signal.reason)
            }
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", abort)
              resolve()
            }, input.delayMs)
            signal.addEventListener("abort", abort, { once: true })
            if (signal.aborted) abort()
          })
        signal.throwIfAborted()
        if (input.fail) throw new Error("Requested example failure")
        const data = { title: configuration.prefix, text: input.text }
        return {
          content: [{ type: "text", text: `${data.title}：${data.text}` }],
          presentation: { kind: "moon.note", version: 1, data },
        }
      },
    },
  ],
}
