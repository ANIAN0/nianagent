import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

const contexts = new AsyncLocalStorage()
const remoteResolvers = new Set()

/** G10：调用链关联标识——入口生成、上下文贯穿、错误与日志共用；与授权身份、operationId 正交。 */
export function newTraceId() {
  return randomUUID()
}

// Only authenticated transports call this port. Context is never taken from
// a business payload, plugin result, model argument or arbitrary RPC name.
export function withRequestContext(context, action) {
  if (
    !context ||
    !["local", "remote"].includes(context.source) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(context.clientId || "")
  )
    throw new Error("请求客户端身份无效。")
  // G10/AC14：入口自带 traceId（桌面信封原样）优先；缺失或显式 undefined 一律生成，
  // 保证链路字段始终存在（此前 ...context 展开会用 undefined 覆盖生成值，真实 RPC 六条终态为空）。
  return contexts.run(
    Object.freeze({
      ...context,
      traceId:
        typeof context.traceId === "string" && context.traceId
          ? context.traceId
          : newTraceId(),
    }),
    action
  )
}
export function requestContext() {
  const context = contexts.getStore()
  if (!context) throw new Error("forbidden：缺少认证传输上下文。")
  return context
}
/** G10：错误边界读取当前 traceId；无上下文的调用返回空串，不抛错。 */
export function currentTraceId() {
  try {
    return requestContext().traceId ?? ""
  } catch {
    return ""
  }
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
  // AC20：未知/非法来源显式拒绝（不凭兼容默认扩大权限）；缺失来源走 legacyQueue 隔离路径。
  if (
    origin !== undefined &&
    origin !== null &&
    origin.source !== undefined &&
    !["local", "remote"].includes(origin.source)
  )
    throw new Error("队列条目来源无效，已隔离保留；请在界面重新编辑后发送。")
  if (origin?.source && !/^[A-Za-z0-9_-]{1,128}$/.test(origin.clientId || ""))
    throw new Error(
      "队列条目客户端身份无效，已隔离保留；请在界面重新编辑后发送。"
    )
  if (origin?.source === "local")
    return Object.freeze({
      ...origin,
      traceId: newTraceId(),
      foreground: false,
    })
  if (origin?.source === "remote") {
    for (const resolve of remoteResolvers) {
      const context = await resolve(origin)
      if (context)
        return Object.freeze({
          ...context,
          traceId: newTraceId(),
          foreground: false,
        })
    }
    // A persisted queue item was admitted while its transport was authenticated.
    // Losing that connection prevents UI actions, not the accepted execution.
    return Object.freeze({
      ...origin,
      traceId: newTraceId(),
      foreground: false,
    })
  }
  // Pre-plugin queues have no recoverable identity and cannot execute until
  // a current authenticated user explicitly edits and submits them again.
  // G12：显式迁移边界——历史无来源队列以 legacyQueue 标记隔离（无 targets、无前台），
  // 不扩大权限；迁移条件与 owner 见整改清单 G12 行。
  return Object.freeze({
    traceId: newTraceId(),
    source: "local",
    clientId: "legacy-queue",
    foreground: false,
    legacyQueue: true,
  })
}
