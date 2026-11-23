export const toolPolicy = (name) => {
  if (name === "android_observe") {
    return { effect: "read", resource: "android" }
  }
  if (name === "android_act") {
    return { effect: "write", resource: "android" }
  }
  return undefined
}

export default function extension(pi, { application, context }) {
  for (const tool of application?.sharedTools || []) {
    pi.registerTool({
      name: tool.name,
      label:
        tool.name === "android_observe"
          ? "安卓观察（只读）"
          : "安卓控制（交互）",
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
