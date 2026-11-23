export const toolPolicy = (name) => {
  if (name === "desktop_observe") {
    return { effect: "read", resource: "desktop" }
  }
  if (name === "desktop_act") {
    return { effect: "write", resource: "desktop" }
  }
  return undefined
}

export default function extension(pi, { application, context }) {
  let chatContext
  pi.on("session_shutdown", async () => {
    if (chatContext) await application.endChatSession(chatContext)
  })
  for (const tool of application?.sharedTools || []) {
    pi.registerTool({
      name: tool.name,
      label:
        tool.name === "desktop_observe"
          ? "桌面观察（只读）"
          : "桌面控制（交互）",
      description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, input, signal) {
        signal?.throwIfAborted()
        const sessionContext =
          typeof context === "function" ? await context() : {}
        chatContext = sessionContext
        return tool.execute(input, sessionContext, signal)
      },
    })
  }
}
