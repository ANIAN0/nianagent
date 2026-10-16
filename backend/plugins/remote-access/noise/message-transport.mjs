// Reused AgentTool Noise wrapper; only the old contract constants/import path are local.
const MAX_REMOTE_MESSAGE_BYTES = 24 * 1024 * 1024
import { MAX_NOISE_PLAINTEXT_BYTES, NoiseChannelError } from "./channel.mjs"
const MAGIC = new Uint8Array([0x41, 0x54, 0x4d, 0x50])
const VERSION = 1
const HEADER_BYTES = 22
const MAX_CHUNK_BYTES = MAX_NOISE_PLAINTEXT_BYTES - HEADER_BYTES
const MAX_CHUNK_COUNT = Math.ceil(MAX_REMOTE_MESSAGE_BYTES / MAX_CHUNK_BYTES)
/**
 * 一条 RemoteMessage 可拆成多个独立 Noise transport frame；通道序号负责顺序，
 * 本层禁止消息交错并限制总明文大小，Cloud 仍只能观察每个密文帧的长度。
 */
export class NoiseMessageTransport {
  transport
  #nextMessageId = 0n
  #lastReceivedMessageId = 0n
  #pending
  constructor(transport) {
    this.transport = transport
  }
  sealMessage(message) {
    if (
      !(message instanceof Uint8Array) ||
      message.byteLength === 0 ||
      message.byteLength > MAX_REMOTE_MESSAGE_BYTES
    ) {
      throw new NoiseChannelError(
        "message_too_large",
        "Remote message 大小无效。"
      )
    }
    if (this.#nextMessageId === 0xffffffffffffffffn) {
      this.close()
      throw new NoiseChannelError(
        "transport_limit_reached",
        "Remote message 身份空间已耗尽，通道已关闭。"
      )
    }
    this.#nextMessageId += 1n
    const count = Math.ceil(message.byteLength / MAX_CHUNK_BYTES)
    if (count > MAX_CHUNK_COUNT || count > 0xffff) {
      throw new NoiseChannelError(
        "message_too_large",
        "Remote message 分片数量超限。"
      )
    }
    const frames = []
    for (let index = 0; index < count; index += 1) {
      const start = index * MAX_CHUNK_BYTES
      const payload = message.subarray(
        start,
        Math.min(start + MAX_CHUNK_BYTES, message.byteLength)
      )
      frames.push(
        this.transport.seal(
          encodeFragment({
            id: this.#nextMessageId,
            index,
            count,
            totalBytes: message.byteLength,
            payload,
          })
        )
      )
    }
    return frames
  }
  openFrame(frame) {
    let plaintext
    try {
      plaintext = this.transport.open(frame)
      const fragment = decodeFragment(plaintext)
      if (!this.#pending && fragment.id !== this.#lastReceivedMessageId + 1n) {
        throw new Error("message id sequence")
      }
      if (fragment.count === 1) {
        this.#lastReceivedMessageId = fragment.id
        return Uint8Array.from(fragment.payload)
      }
      if (!this.#pending) {
        if (fragment.index !== 0) throw new Error("first fragment index")
        this.#pending = {
          id: fragment.id,
          count: fragment.count,
          totalBytes: fragment.totalBytes,
          chunks: [],
          receivedBytes: 0,
        }
      }
      const pending = this.#pending
      if (
        pending.id !== fragment.id ||
        pending.count !== fragment.count ||
        pending.totalBytes !== fragment.totalBytes ||
        fragment.index !== pending.chunks.length
      )
        throw new Error("fragment sequence")
      pending.chunks.push(Uint8Array.from(fragment.payload))
      pending.receivedBytes += fragment.payload.byteLength
      if (pending.receivedBytes > pending.totalBytes)
        throw new Error("fragment length overflow")
      if (pending.chunks.length < pending.count) return undefined
      if (pending.receivedBytes !== pending.totalBytes)
        throw new Error("fragment total length")
      const message = new Uint8Array(pending.totalBytes)
      let offset = 0
      for (const chunk of pending.chunks) {
        message.set(chunk, offset)
        offset += chunk.byteLength
        chunk.fill(0)
      }
      this.#pending = undefined
      this.#lastReceivedMessageId = fragment.id
      return message
    } catch (error) {
      this.close()
      if (error instanceof NoiseChannelError) throw error
      throw new NoiseChannelError(
        "invalid_message_fragment",
        "Remote message 分片无效，通道已关闭。"
      )
    } finally {
      plaintext?.fill(0)
    }
  }
  close() {
    if (this.#pending) {
      for (const chunk of this.#pending.chunks) chunk.fill(0)
      this.#pending = undefined
    }
    this.transport.close()
  }
}
function encodeFragment(input) {
  const output = new Uint8Array(HEADER_BYTES + input.payload.byteLength)
  output.set(MAGIC, 0)
  output[4] = VERSION
  output[5] = 0
  const view = new DataView(output.buffer)
  view.setBigUint64(6, input.id, false)
  view.setUint16(14, input.index, false)
  view.setUint16(16, input.count, false)
  view.setUint32(18, input.totalBytes, false)
  output.set(input.payload, HEADER_BYTES)
  return output
}
function decodeFragment(value) {
  if (
    value.byteLength <= HEADER_BYTES ||
    !MAGIC.every((byte, index) => value[index] === byte) ||
    value[4] !== VERSION ||
    value[5] !== 0
  )
    throw new Error("fragment header")
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  const id = view.getBigUint64(6, false)
  const index = view.getUint16(14, false)
  const count = view.getUint16(16, false)
  const totalBytes = view.getUint32(18, false)
  const payload = value.subarray(HEADER_BYTES)
  if (
    id === 0n ||
    count === 0 ||
    count > MAX_CHUNK_COUNT ||
    index >= count ||
    totalBytes === 0 ||
    totalBytes > MAX_REMOTE_MESSAGE_BYTES ||
    count !== Math.ceil(totalBytes / MAX_CHUNK_BYTES) ||
    payload.byteLength === 0 ||
    payload.byteLength > MAX_CHUNK_BYTES ||
    (index < count - 1 && payload.byteLength !== MAX_CHUNK_BYTES) ||
    (index === count - 1 &&
      payload.byteLength !== totalBytes - (count - 1) * MAX_CHUNK_BYTES)
  ) {
    throw new Error("fragment fields")
  }
  return { id, index, count, totalBytes, payload }
}
