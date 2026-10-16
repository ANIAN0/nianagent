import type { AgentToolNoiseHandshake, NoiseKeyPair } from "./noise/channel.mjs"
import type { NoiseMessageTransport } from "./noise/message-transport.mjs"
export const wireVersion: string
export const messageLimit: number
export function encode(value: unknown): Uint8Array
export type RemotePacket =
  | { type: "ready"; version: string; profileId: string }
  | { type: "ping" | "pong" }
  | { type: "cancel"; id: string }
  | { type: "rpc"; id: string; operation: string; input: unknown }
  | { type: "result"; id: string; error?: string; issue?: unknown; result?: unknown }
export function decode(bytes: Uint8Array): RemotePacket
export function handshake(
  role: "initiator" | "responder",
  route: string,
  localStaticKey: NoiseKeyPair,
  responderStaticPublicKey?: Uint8Array
): AgentToolNoiseHandshake
export function finish(state: AgentToolNoiseHandshake): NoiseMessageTransport
export function relayUrl(
  origin: string,
  role: "server" | "client",
  serverId: string,
  connectionId?: string
): string
export function remoteOrigin(value: string): string
