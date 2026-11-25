// Reused AgentTool Noise wrapper; only the old contract constants/import path are local.
/// <reference path="./noise-handshake.d.ts" />
import NoiseHandshakeState from "noise-handshake"
import NoiseCipherState from "noise-handshake/cipher.js"
import { generateKeyPair } from "noise-handshake/dh.js"
const REMOTE_PROTOCOL_VERSION = 21
export const NOISE_XK_PROTOCOL = "Noise_XK_25519_ChaChaPoly_BLAKE2b"
export const NOISE_TEST_VECTOR_VERSION = "agenttool-noise-v1"
export const MAX_NOISE_HANDSHAKE_BYTES = 4_096
export const MAX_NOISE_PLAINTEXT_BYTES = 60 * 1024
export const MAX_NOISE_TRANSPORT_SEQUENCE = 0xffff_fffe
/** 错误不附带握手包、密文、明文或密钥。 */
export class NoiseChannelError extends Error {
  code
  constructor(code, message) {
    super(message)
    this.name = "NoiseChannelError"
    this.code = code
  }
}
const HANDSHAKE_MAGIC = new Uint8Array([0x41, 0x54, 0x52, 0x48])
const TRANSPORT_MAGIC = new Uint8Array([0x41, 0x54, 0x52, 0x43])
const HANDSHAKE_HEADER_BYTES = 12
const TRANSPORT_HEADER_BYTES = 16
const NOISE_MAC_BYTES = 16
export function generateNoiseKeyPair() {
  const keyPair = generateKeyPair()
  return freezeKeyPair(keyPair)
}
export function noiseKeyPairFromSecret(secretKey) {
  requireBytes(secretKey, 32, "Noise 私钥")
  return freezeKeyPair(generateKeyPair(Uint8Array.from(secretKey)))
}
export function encodeNoisePrologue(input) {
  const route = exactRouteId(input.deviceRouteId)
  if (input.context !== "connection") {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise prologue context 无效。"
    )
  }
  return new TextEncoder().encode(
    `agenttool-remote\u0000${REMOTE_PROTOCOL_VERSION}\u0000${input.context}\u0000${route}`
  )
}
export class AgentToolNoiseHandshake {
  pattern
  role
  #state
  #phase
  #nextStep = 1
  constructor(options) {
    this.pattern = options.pattern
    this.role = options.role
    validateHandshakeConfiguration(options)
    const localStatic = options.localStaticKey
      ? mutableKeyPair(options.localStaticKey)
      : undefined
    this.#state = new NoiseHandshakeState(
      options.pattern,
      options.role === "initiator",
      localStatic
    )
    try {
      this.#state.initialise(
        Uint8Array.from(options.prologue),
        options.role === "initiator"
          ? Uint8Array.from(options.responderStaticPublicKey)
          : undefined
      )
    } catch {
      this.#phase = "failed"
      throw new NoiseChannelError("handshake_failed", "Noise 握手初始化失败。")
    }
    this.#phase = options.role === "initiator" ? "write" : "read"
  }
  get complete() {
    return this.#phase === "complete" || this.#phase === "finished"
  }
  writeMessage() {
    this.requirePhase("write")
    try {
      const payload = this.#state.send()
      const frame = encodeHandshakeFrame(
        this.pattern,
        this.role,
        this.#nextStep,
        payload
      )
      this.#nextStep += 1
      this.#phase = this.#state.complete ? "complete" : "read"
      return frame
    } catch (error) {
      this.#phase = "failed"
      if (error instanceof NoiseChannelError) throw error
      throw new NoiseChannelError("handshake_failed", "Noise 握手写入失败。")
    }
  }
  readMessage(frame) {
    this.requirePhase("read")
    const expectedSender = this.role === "initiator" ? "responder" : "initiator"
    let payload
    try {
      payload = decodeHandshakeFrame(
        frame,
        this.pattern,
        expectedSender,
        this.#nextStep
      )
      const applicationPayload = this.#state.recv(payload)
      if (applicationPayload.byteLength !== 0) {
        throw new NoiseChannelError(
          "invalid_handshake_frame",
          "Noise 握手不得携带应用 payload。"
        )
      }
      this.#nextStep += 1
      this.#phase = this.#state.complete ? "complete" : "write"
    } catch (error) {
      this.#phase = "failed"
      if (error instanceof NoiseChannelError) throw error
      throw new NoiseChannelError("handshake_failed", "Noise 握手认证失败。")
    }
  }
  finish() {
    this.requirePhase("complete")
    const sendDirection = this.role === "initiator" ? 1 : 2
    const receiveDirection = this.role === "initiator" ? 2 : 1
    const remoteStatic = this.#state.rs
      ? Uint8Array.from(this.#state.rs)
      : undefined
    const handshakeHash = Uint8Array.from(this.#state.hash)
    const sendKey = Uint8Array.from(this.#state.rx)
    const receiveKey = Uint8Array.from(this.#state.tx)
    const transport = new NoiseTransport(
      sendKey,
      receiveKey,
      sendDirection,
      receiveDirection
    )
    sendKey.fill(0)
    receiveKey.fill(0)
    this.#state.rx.fill(0)
    this.#state.tx.fill(0)
    this.#phase = "finished"
    return {
      transport,
      handshakeHash,
      ...(remoteStatic ? { remoteStaticPublicKey: remoteStatic } : {}),
    }
  }
  requirePhase(expected) {
    if (this.#phase !== expected) {
      throw new NoiseChannelError(
        "handshake_failed",
        `Noise 握手状态不允许 ${expected} 操作。`
      )
    }
  }
}
export class NoiseTransport {
  #sendCipher
  #receiveCipher
  #sendSequence = 0
  #receiveSequence = 0
  #sendDirection
  #receiveDirection
  constructor(sendKey, receiveKey, sendDirection, receiveDirection) {
    requireBytes(sendKey, 32, "Noise send key")
    requireBytes(receiveKey, 32, "Noise receive key")
    if (
      !(
        (sendDirection === 1 && receiveDirection === 2) ||
        (sendDirection === 2 && receiveDirection === 1)
      )
    ) {
      throw new NoiseChannelError(
        "invalid_configuration",
        "Noise transport 方向无效。"
      )
    }
    this.#sendCipher = new NoiseCipherState(Uint8Array.from(sendKey))
    this.#receiveCipher = new NoiseCipherState(Uint8Array.from(receiveKey))
    this.#sendDirection = sendDirection
    this.#receiveDirection = receiveDirection
  }
  get nextSendSequence() {
    return this.#sendSequence
  }
  get nextReceiveSequence() {
    return this.#receiveSequence
  }
  seal(plaintext) {
    const cipher = this.requireOpen(this.#sendCipher)
    if (
      !(plaintext instanceof Uint8Array) ||
      plaintext.byteLength === 0 ||
      plaintext.byteLength > MAX_NOISE_PLAINTEXT_BYTES
    ) {
      this.close()
      throw new NoiseChannelError(
        "invalid_transport_frame",
        "Noise 明文帧大小无效。"
      )
    }
    if (this.#sendSequence > MAX_NOISE_TRANSPORT_SEQUENCE) {
      this.close()
      throw new NoiseChannelError(
        "transport_limit_reached",
        "Noise transport 已达到 nonce 上限。"
      )
    }
    const ciphertextLength = plaintext.byteLength + NOISE_MAC_BYTES
    const header = encodeTransportHeader(
      this.#sendDirection,
      this.#sendSequence,
      ciphertextLength
    )
    try {
      cipher.setNonce(this.#sendSequence)
      const ciphertext = cipher.encrypt(plaintext, header)
      if (ciphertext.byteLength !== ciphertextLength)
        throw new Error("ciphertext length mismatch")
      this.#sendSequence += 1
      const frame = new Uint8Array(header.byteLength + ciphertext.byteLength)
      frame.set(header, 0)
      frame.set(ciphertext, header.byteLength)
      return frame
    } catch {
      this.close()
      throw new NoiseChannelError(
        "transport_authentication_failed",
        "Noise transport 加密失败，通道已关闭。"
      )
    }
  }
  open(frame) {
    const cipher = this.requireOpen(this.#receiveCipher)
    if (this.#receiveSequence > MAX_NOISE_TRANSPORT_SEQUENCE) {
      this.close()
      throw new NoiseChannelError(
        "transport_limit_reached",
        "Noise transport 已达到 nonce 上限。"
      )
    }
    let decoded
    try {
      decoded = decodeTransportFrame(
        frame,
        this.#receiveDirection,
        this.#receiveSequence
      )
    } catch (error) {
      this.close()
      if (error instanceof NoiseChannelError) throw error
      throw new NoiseChannelError(
        "invalid_transport_frame",
        "Noise transport frame 无效，通道已关闭。"
      )
    }
    try {
      cipher.setNonce(this.#receiveSequence)
      const plaintext = cipher.decrypt(decoded.ciphertext, decoded.header)
      if (
        plaintext.byteLength === 0 ||
        plaintext.byteLength > MAX_NOISE_PLAINTEXT_BYTES
      )
        throw new Error("plaintext length invalid")
      this.#receiveSequence += 1
      // Node adapter 可能返回 Buffer；显式归一化为独立 Uint8Array，避免 Buffer.slice() 的共享内存语义。
      return Uint8Array.from(plaintext)
    } catch {
      this.close()
      throw new NoiseChannelError(
        "transport_authentication_failed",
        "Noise transport 认证失败，通道已关闭。"
      )
    }
  }
  close() {
    clearCipher(this.#sendCipher)
    clearCipher(this.#receiveCipher)
    this.#sendCipher = undefined
    this.#receiveCipher = undefined
  }
  requireOpen(cipher) {
    if (!cipher)
      throw new NoiseChannelError(
        "transport_closed",
        "Noise transport 已关闭。"
      )
    return cipher
  }
}
function validateHandshakeConfiguration(options) {
  if (
    !(options.prologue instanceof Uint8Array) ||
    options.prologue.byteLength === 0 ||
    options.prologue.byteLength > 512
  ) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise prologue 无效。"
    )
  }
  if (options.role === "responder" && !options.localStaticKey) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise responder 必须提供静态密钥。"
    )
  }
  validatePrologue(options.pattern, options.prologue)
  if (options.role === "initiator") {
    requireBytes(options.responderStaticPublicKey, 32, "Noise responder 公钥")
  } else if (options.responderStaticPublicKey !== undefined) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise responder 不得配置 responder 公钥副本。"
    )
  }
  if (options.role === "initiator" && !options.localStaticKey) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise initiator 必须提供静态密钥。"
    )
  }
  if (options.localStaticKey) validateKeyPair(options.localStaticKey)
}
function encodeHandshakeFrame(pattern, sender, step, payload) {
  if (
    payload.byteLength === 0 ||
    payload.byteLength > MAX_NOISE_HANDSHAKE_BYTES
  ) {
    throw new NoiseChannelError(
      "invalid_handshake_frame",
      "Noise handshake payload 大小无效。"
    )
  }
  const frame = new Uint8Array(HANDSHAKE_HEADER_BYTES + payload.byteLength)
  frame.set(HANDSHAKE_MAGIC, 0)
  frame[4] = REMOTE_PROTOCOL_VERSION
  frame[5] = 1
  frame[6] = sender === "initiator" ? 1 : 2
  frame[7] = step
  new DataView(frame.buffer, frame.byteOffset, frame.byteLength).setUint32(
    8,
    payload.byteLength,
    false
  )
  frame.set(payload, HANDSHAKE_HEADER_BYTES)
  return frame
}
function decodeHandshakeFrame(frame, pattern, sender, step) {
  if (
    !(frame instanceof Uint8Array) ||
    frame.byteLength < HANDSHAKE_HEADER_BYTES ||
    !hasMagic(frame, HANDSHAKE_MAGIC) ||
    frame[4] !== REMOTE_PROTOCOL_VERSION ||
    frame[5] !== 1 ||
    frame[6] !== (sender === "initiator" ? 1 : 2) ||
    frame[7] !== step
  ) {
    throw new NoiseChannelError(
      "invalid_handshake_frame",
      "Noise handshake frame 头无效。"
    )
  }
  const payloadLength = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength
  ).getUint32(8, false)
  if (
    payloadLength === 0 ||
    payloadLength > MAX_NOISE_HANDSHAKE_BYTES ||
    frame.byteLength !== HANDSHAKE_HEADER_BYTES + payloadLength
  ) {
    throw new NoiseChannelError(
      "invalid_handshake_frame",
      "Noise handshake frame 长度无效。"
    )
  }
  return frame.slice(HANDSHAKE_HEADER_BYTES)
}
function encodeTransportHeader(direction, sequence, ciphertextLength) {
  const header = new Uint8Array(TRANSPORT_HEADER_BYTES)
  header.set(TRANSPORT_MAGIC, 0)
  header[4] = REMOTE_PROTOCOL_VERSION
  header[5] = 1
  header[6] = direction
  header[7] = 0
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  view.setUint32(8, sequence, false)
  view.setUint32(12, ciphertextLength, false)
  return header
}
function decodeTransportFrame(frame, expectedDirection, expectedSequence) {
  if (
    !(frame instanceof Uint8Array) ||
    frame.byteLength < TRANSPORT_HEADER_BYTES + NOISE_MAC_BYTES ||
    !hasMagic(frame, TRANSPORT_MAGIC) ||
    frame[4] !== REMOTE_PROTOCOL_VERSION ||
    frame[5] !== 1 ||
    frame[6] !== expectedDirection ||
    frame[7] !== 0
  ) {
    throw new NoiseChannelError(
      "invalid_transport_frame",
      "Noise transport frame 头无效。"
    )
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const sequence = view.getUint32(8, false)
  const ciphertextLength = view.getUint32(12, false)
  if (sequence !== expectedSequence) {
    throw new NoiseChannelError(
      "invalid_transport_frame",
      `Noise transport sequence 无效（期望 ${expectedSequence}，收到 ${sequence}）。`
    )
  }
  if (
    ciphertextLength < NOISE_MAC_BYTES + 1 ||
    ciphertextLength > MAX_NOISE_PLAINTEXT_BYTES + NOISE_MAC_BYTES ||
    frame.byteLength !== TRANSPORT_HEADER_BYTES + ciphertextLength
  ) {
    throw new NoiseChannelError(
      "invalid_transport_frame",
      `Noise transport 长度无效（声明 ${ciphertextLength}，实际 ${frame.byteLength - TRANSPORT_HEADER_BYTES}）。`
    )
  }
  return {
    header: frame.slice(0, TRANSPORT_HEADER_BYTES),
    ciphertext: frame.slice(TRANSPORT_HEADER_BYTES),
  }
}
function freezeKeyPair(keyPair) {
  validateKeyPair(keyPair)
  return Object.freeze({
    publicKey: Uint8Array.from(keyPair.publicKey),
    secretKey: Uint8Array.from(keyPair.secretKey),
  })
}
function mutableKeyPair(keyPair) {
  validateKeyPair(keyPair)
  return {
    publicKey: Uint8Array.from(keyPair.publicKey),
    secretKey: Uint8Array.from(keyPair.secretKey),
  }
}
function validateKeyPair(keyPair) {
  requireBytes(keyPair.publicKey, 32, "Noise 公钥")
  requireBytes(keyPair.secretKey, 32, "Noise 私钥")
  const derived = generateKeyPair(Uint8Array.from(keyPair.secretKey))
  const matches = equalBytes(derived.publicKey, keyPair.publicKey)
  derived.secretKey.fill(0)
  if (!matches) {
    throw new NoiseChannelError("invalid_configuration", "Noise 公私钥不匹配。")
  }
}
function validatePrologue(pattern, prologue) {
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(prologue)
  } catch {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise prologue 不是有效 UTF-8。"
    )
  }
  const context = "connection"
  const prefix = `agenttool-remote\u0000${REMOTE_PROTOCOL_VERSION}\u0000${context}\u0000`
  if (!text.startsWith(prefix)) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise pattern 与 prologue context 不匹配。"
    )
  }
  const route = exactRouteId(text.slice(prefix.length))
  if (
    !equalBytes(
      prologue,
      encodeNoisePrologue({ context, deviceRouteId: route })
    )
  ) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "Noise prologue 编码不规范。"
    )
  }
}
function requireBytes(value, length, label) {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    throw new NoiseChannelError("invalid_configuration", `${label}长度无效。`)
  }
}
function exactRouteId(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value)
  ) {
    throw new NoiseChannelError(
      "invalid_configuration",
      "device route ID 无效。"
    )
  }
  return value
}
function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= left[index] ^ right[index]
  return difference === 0
}
function hasMagic(frame, magic) {
  return magic.every((value, index) => frame[index] === value)
}
function clearCipher(cipher) {
  if (!cipher) return
  try {
    cipher._clear()
  } catch {
    /* 通道已不可用；清理失败不能重新开放密钥状态。 */
  }
}
