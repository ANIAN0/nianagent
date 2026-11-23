// @ts-check
import { readOnlyTools, toolOperations } from "./tool-catalog.mjs"

const prefix = "moon_ext__skill-workbench__"
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
    if (!tool) throw new Error(`Skill 工作台工具未装配：${name}`)
    pi.registerTool({
      name: prefix + name,
      label: tool.description,
      description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, input, signal, _onUpdate, _piContext, moon) {
        signal?.throwIfAborted()
        return await tool.execute(input, moon, signal)
      },
    })
  }
}
