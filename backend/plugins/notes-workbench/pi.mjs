import { readOnlyTools, toolOperations } from "./v2/tool-catalog.mjs"

const prefix = "moon_ext__notes-workbench__"
const names = new Set(toolOperations.map((pair) => pair.split(":")[1]))

export const toolPolicy = (name) => {
  const operation = name.startsWith(prefix) ? name.slice(prefix.length) : ""
  if (!names.has(operation)) return undefined
  return {
    effect: readOnlyTools.has(operation) ? "read" : "write",
    resource: "record",
  }
}

export default function extension(pi, { application }) {
  const shared = new Map(
    (application?.sharedTools || []).map((tool) => [tool.name, tool])
  )
  for (const name of names) {
    const tool = shared.get(name)
    if (!tool) throw new Error(`工作台工具未装配：${name}`)
    pi.registerTool({
      name: prefix + name,
      label: tool.description,
      description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, input, signal, _onUpdate, _piContext, moon) {
        signal?.throwIfAborted()
        // 身份只取 PluginHost 注入的第六参数，不消费模型输入中的作者声明。
        const result = await tool.execute(input, moon, signal)
        if (
          !result?.isError &&
          (name === "publish_version" || name === "open_version") &&
          typeof result?.content?.[0]?.text === "string"
        ) {
          const data = JSON.parse(result.content[0].text)
          if (typeof data?.draftId === "string" && data.draftId) {
            const title =
              typeof data.title === "string" && data.title
                ? data.title
                : data.draftId
            const summaryText =
              typeof input?.summary === "string" && input.summary
                ? input.summary
                : typeof data.sequence === "number"
                  ? `v${data.sequence}`
                  : data.versionId || ""
            return {
              ...result,
              details: {
                ...result.details,
                moonDelivery: {
                  kind: "notes-page",
                  version: 1,
                  summary: summaryText ? `${title} · ${summaryText}` : title,
                  payload: JSON.stringify({
                    draftId: data.draftId,
                    versionId: data.versionId,
                    title,
                    summary: summaryText || undefined,
                  }),
                },
              },
            }
          }
        }
        return result
      },
    })
  }
}
