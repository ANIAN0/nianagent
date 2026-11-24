import { READ_ONLY_TOOLS } from "./host.mjs"

const prefix = "moon_ext__filebrowser__"

export const toolPolicy = (name) => {
  if (!name.startsWith(prefix)) return undefined
  const local = name.slice(prefix.length)
  return {
    effect: READ_ONLY_TOOLS.has(local) ? "read" : "write",
    resource: "file",
  }
}

export default function extension(pi, { application, context }) {
  for (const tool of application?.sharedTools || []) {
    pi.registerTool({
      name: prefix + tool.name,
      label: `FileBrowser · ${tool.name}`,
      description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, input, signal) {
        signal?.throwIfAborted()
        const sessionContext =
          typeof context === "function" ? await context() : {}
        return tool.execute(input, sessionContext, signal)
      },
    })
  }
}
