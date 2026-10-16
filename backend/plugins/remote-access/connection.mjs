import {
  AgentToolNoiseHandshake,
  encodeNoisePrologue,
} from "./noise/channel.mjs"
import { NoiseMessageTransport } from "./noise/message-transport.mjs"

export const wireVersion = "moon-host-protocol-3"
export const messageLimit = 24 * 1024 * 1024
export const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
export const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
export function handshake(
  role,
  route,
  localStaticKey,
  responderStaticPublicKey
) {
  return new AgentToolNoiseHandshake({
    pattern: "XK",
    role,
    localStaticKey,
    responderStaticPublicKey,
    prologue: encodeNoisePrologue({
      context: "connection",
      deviceRouteId: route,
    }),
  })
}
export function finish(state) {
  return new NoiseMessageTransport(state.finish().transport)
}
export function relayUrl(origin, role, serverId, connectionId) {
  const result = new URL("/moon/gateway/v3", origin)
  result.protocol = result.protocol === "https:" ? "wss:" : "ws:"
  result.search = new URLSearchParams({
    v: "3",
    role,
    serverId,
    ...(connectionId ? { connectionId } : {}),
  }).toString()
  return result.href
}
export function remoteOrigin(value) {
  const result = new URL(value)
  if (
    result.username ||
    result.password ||
    result.search ||
    result.hash ||
    (result.protocol !== "https:" &&
      !(
        result.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(result.hostname)
      ))
  )
    throw new Error("远程公网地址须为HTTPS；本地HTTP仅支持回环地址。")
  return result.origin
}
