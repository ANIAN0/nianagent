import { AsyncLocalStorage } from "node:async_hooks"

const contexts = new AsyncLocalStorage()
const remoteResolvers = new Set()

// Only authenticated transports call this port. Context is never taken from
// a business payload, plugin result, model argument or arbitrary RPC name.
export function withRequestContext(context, action) {
  if (
    !context ||
    !["local", "remote"].includes(context.source) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(context.clientId || "")
  )
    throw new Error("请求客户端身份无效。")
  return contexts.run(Object.freeze({ ...context }), action)
}
export function requestContext() {
  const context = contexts.getStore()
  if (!context) throw new Error("forbidden：缺少认证传输上下文。")
  return context
}
export function rememberRequestContext(context = requestContext()) {
  const {
    source,
    clientId,
    connectionId = "",
    viewGeneration = 0,
    profileId = "",
    targets = {},
  } = context
  return {
    source,
    clientId,
    connectionId,
    viewGeneration,
    profileId,
    targets: structuredClone(targets),
  }
}
export function registerRemoteContextResolver(resolve) {
  remoteResolvers.add(resolve)
  return () => remoteResolvers.delete(resolve)
}
export async function restoreRequestContext(origin) {
  if (origin?.source === "local")
    return Object.freeze({ ...origin, foreground: false })
  if (origin?.source === "remote") {
    for (const resolve of remoteResolvers) {
      const context = await resolve(origin)
      if (context) return Object.freeze({ ...context, foreground: false })
    }
    // A persisted queue item was admitted while its transport was authenticated.
    // Losing that connection prevents UI actions, not the accepted execution.
    return Object.freeze({ ...origin, foreground: false })
  }
  // Existing pre-plugin local queues retain execution authority, but no target
  // client can receive an automatic UI action after a restart or migration.
  return Object.freeze({
    source: "local",
    clientId: "legacy-queue",
    foreground: false,
  })
}
