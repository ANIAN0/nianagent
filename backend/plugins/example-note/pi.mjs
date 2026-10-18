export const toolPolicy = () => ({ effect: "read", resource: "record" })
export default function extension(pi, { configuration }) {
  pi.registerTool({
    name: "moon_ext__example_note__note",
    label: "生成短记录",
    description: "将给定文字作为短记录交付给用户。",
    parameters: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, maxLength: 2000 } },
      required: ["text"],
      additionalProperties: false,
    },
    async execute(_id, input, signal) {
      signal?.throwIfAborted()
      const data = { title: configuration.prefix, text: input.text }
      const summary = `${data.title}：${data.text}`
      return {
        content: [{ type: "text", text: summary }],
        details: {
          moonDelivery: {
            kind: "note",
            version: 1,
            payload: JSON.stringify(data),
            summary,
          },
        },
      }
    },
  })
}
