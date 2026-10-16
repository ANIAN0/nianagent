import type { NoiseTransport } from "./channel.mjs"
export class NoiseMessageTransport {
  constructor(transport: NoiseTransport)
  sealMessage(message: Uint8Array): Uint8Array[]
  openFrame(frame: Uint8Array): Uint8Array | undefined
  close(): void
}
