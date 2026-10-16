export type NoiseKeyPair = Readonly<{
  publicKey: Uint8Array
  secretKey: Uint8Array
}>
export function generateNoiseKeyPair(): NoiseKeyPair
export function noiseKeyPairFromSecret(secretKey: Uint8Array): NoiseKeyPair
export function encodeNoisePrologue(input: {
  context: "connection"
  deviceRouteId: string
}): Uint8Array
export class NoiseTransport {
  seal(plaintext: Uint8Array): Uint8Array
  open(frame: Uint8Array): Uint8Array
  close(): void
}
export class AgentToolNoiseHandshake {
  constructor(options: {
    pattern: "XK"
    role: "initiator" | "responder"
    localStaticKey: NoiseKeyPair
    responderStaticPublicKey?: Uint8Array
    prologue: Uint8Array
  })
  readonly complete: boolean
  readMessage(frame: Uint8Array): void
  writeMessage(): Uint8Array
  finish(): {
    transport: NoiseTransport
    handshakeHash: Uint8Array
    remoteStaticPublicKey?: Uint8Array
  }
}
