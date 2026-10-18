import { WebSocket } from "ws"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { replaceJson } from "../../atomic-file.mjs"
import { withRequestContext } from "../../request-context.mjs"
import { operations, validateRequest } from "../../contract.mjs"
import { publicFailure } from "../../operation-issue.mjs"
import {
  generateNoiseKeyPair,
  noiseKeyPairFromSecret,
} from "./noise/channel.mjs"
import { NoiseMessageTransport } from "./noise/message-transport.mjs"
import {
  decode,
  encode,
  handshake,
  messageLimit,
  relayUrl,
  remoteOrigin,
  wireVersion,
} from "./connection.mjs"
import { browseDirectories } from "./directories.mjs"
import { uploadOperations } from "./uploads.mjs"

import { remoteOperations } from "./contract.mjs"

// Keep the approved current surface explicit. New contracts require an explicit
// decision here; a conversation prefix must never grant access by itself.
const safeOperations = new Set([
  "bootStatus",
  "list",
  "sessionCatalog",
  "sessionRead",
  "sessionApply",
  "materialPrepare",
  "materialCatalog",
  "materialPreview",
  "materialRestore",
  "materialUpload",
  "workspaceList",
  "workspaceGet",
  "workspaceAdd",
  "workspaceSelect",
  "pluginList",
  "pluginCall",
  "pluginResource",
  "conversationQueueEdit",
  "conversationQueueRemove",
  "conversationQueueMode",
  "conversationQueueDeliver",
  "conversationQueueReceiptRead",
  "conversationQueueItemRead",
  "conversationList",
  "conversationInfo",
  "conversationMarkRead",
  "conversationReceiptRead",
  "conversationSend",
  "conversationRead",
  "conversationStop",
  "conversationRetry",
  "conversationFollow",
  "conversationPermissionRead",
  "conversationPermissionSet",
  "conversationApprovalReply",
  "conversationCommandRun",
  "conversationCommandRead",
  "conversationFork",
  "conversationCompact",
  "conversationControlRead",
  "conversationCompactCancel",
])
for (const name of safeOperations)
  if (!Object.hasOwn(operations, name))
    throw new Error(`远程操作合同已变化：${name}不存在，请核对准入清单。`)

export async function activate(host) {
  const origin = remoteOrigin(host.configuration.origin)
  const identityFile = join(host.directory, "connection.json")
  let identity
  try {
    identity = JSON.parse(await readFile(identityFile, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error("远程连接记录无法读取；原文件保留。", { cause: error })
  }
  if (!identity) {
    const keys = generateNoiseKeyPair()
    identity = {
      serverId: randomUUID(),
      secret: Buffer.from(keys.secretKey).toString("base64"),
    }
    await replaceJson(identityFile, identity)
  }
  let keys = noiseKeyPairFromSecret(
    Uint8Array.from(Buffer.from(identity.secret, "base64"))
  )
  const profile = JSON.parse(
    await readFile(join(host.services().directory, "moon-data.json"), "utf8")
  )
  const peers = new Map(),
    selected = new Map()
  let control,
    heartbeat,
    retry,
    closed = false,
    online = false,
    attempt = 0,
    issue = "正在连接evework。"
  const closePeers = () => {
    for (const peer of peers.values()) peer.close()
    peers.clear()
  }
  const status = () => {
    const url = new URL("/moon/", origin)
    url.hash = new URLSearchParams({
      server: identity.serverId,
      key: Buffer.from(keys.publicKey).toString("base64url"),
      gateway: origin,
    }).toString()
    return {
      online,
      issue,
      clients: [...peers.values()].filter((peer) => peer.ready).length,
      url: online ? url.href : "",
    }
  }
  const openPeer = (connectionId) => {
    if (
      closed ||
      !/^conn_[a-f0-9]{32}$/.test(connectionId) ||
      peers.has(connectionId)
    )
      return
    const socket = new WebSocket(
      relayUrl(origin, "server", identity.serverId, connectionId),
      { followRedirects: false, perMessageDeflate: false, maxPayload: 70000 }
    )
    const state = handshake("responder", identity.serverId, keys)
    let channel,
      timer,
      handshakeTimer,
      context,
      lastMessage = Date.now(),
      sending = Promise.resolve(),
      queuedBytes = 0,
      queuedMessages = 0
    const controllers = new Map()
    const peer = {
      ready: false,
      close: () => {
        clearInterval(timer)
        clearTimeout(handshakeTimer)
        channel?.close()
        socket.terminate()
      },
    }
    peers.set(connectionId, peer)
    const send = (value) => {
      const bytes = encode(value)
      if (bytes.length > messageLimit)
        throw new Error("远程结果超过原通道容量。")
      if (
        queuedMessages >= 64 ||
        queuedBytes + bytes.length > messageLimit + 65536
      ) {
        peer.close()
        throw new Error("远程接收过慢，通道已关闭。")
      }
      const frames = channel.sealMessage(bytes)
      const size = frames.reduce((sum, frame) => sum + frame.length, 0)
      if (queuedBytes + size > messageLimit + 65536) {
        peer.close()
        throw new Error("远程发送队列已满，通道已关闭。")
      }
      queuedBytes += size
      queuedMessages += 1
      sending = sending
        .then(async () => {
          for (const frame of frames) {
            if (
              closed ||
              socket.readyState !== WebSocket.OPEN ||
              socket.bufferedAmount + frame.length > 2 * 1024 * 1024
            )
              throw new Error("远程发送中断。")
            await new Promise((resolve, reject) =>
              socket.send(frame, (error) => (error ? reject(error) : resolve()))
            )
          }
        })
        .catch(() => peer.close())
        .finally(() => {
          queuedBytes -= size
          queuedMessages -= 1
        })
      return sending
    }
    const dispatch = async (packet) => {
      if (packet?.type === "ping") return send({ type: "pong" })
      if (packet?.type === "pong") return
      if (packet?.type === "cancel") {
        controllers.get(packet.id)?.abort()
        return
      }
      if (
        packet?.type !== "rpc" ||
        !/^[a-f0-9-]{36}$/.test(packet.id || "") ||
        typeof packet.operation !== "string" ||
        controllers.has(packet.id) ||
        controllers.size >= 64
      )
        throw new Error("远程请求无效。")
      const controller = new AbortController()
      controller.readOnly =
        [
          "conversationRead",
          "conversationFollow",
          "conversationList",
          "conversationInfo",
          "conversationReceiptRead",
          "conversationQueueReceiptRead",
          "conversationPermissionRead",
          "conversationCommandRead",
          "conversationControlRead",
          "workspaceList",
          "workspaceGet",
          "sessionCatalog",
          "sessionRead",
          "materialCatalog",
          "materialPreview",
          "pluginList",
          "bootStatus",
          "list",
        ].includes(packet.operation) ||
        (packet.operation === "pluginCall" &&
          packet.input?.id === "file-workbench" &&
          [
            "info",
            "text",
            "bytes",
            "tree",
            "state",
            "git",
            "gitDiff",
            "view",
          ].includes(packet.input?.operation))
      controllers.set(packet.id, controller)
      try {
        if (!safeOperations.has(packet.operation))
          throw new Error("forbidden：此操作仅本机可用。")
        validateRequest(packet.operation, packet.input)
        const result = await withRequestContext(context, async () => {
          const value = await host.dispatch(
            packet.operation,
            packet.input,
            controller.signal
          )
          if (
            packet.operation === "workspaceSelect" ||
            packet.operation === "workspaceAdd"
          ) {
            selected.set(context.clientId, value.id)
            return value
          }
          if (packet.operation === "workspaceList")
            return {
              ...value,
              selectedId: selected.get(context.clientId) || null,
            }
          if (packet.operation === "list")
            return value.map((connection) => ({
              ...connection,
              headers: "{}",
              endpoint: "",
              environmentVariable: "",
              apiKey: "",
            }))
          return value
        })
        if (socket.readyState === WebSocket.OPEN)
          await send({ type: "result", id: packet.id, result })
      } catch (error) {
        if (socket.readyState === WebSocket.OPEN)
          await send({
            type: "result",
            id: packet.id,
            ...publicFailure(error, packet.operation),
          })
      } finally {
        controllers.delete(packet.id)
      }
    }
    socket.on("open", () => {
      handshakeTimer = setTimeout(() => peer.close(), 15000)
    })
    socket.on("error", () => peer.close())
    socket.on("message", (bytes, binary) => {
      try {
        if (!binary) throw new Error("Noise需要二进制帧。")
        lastMessage = Date.now()
        const frame = Uint8Array.from(bytes)
        if (!channel) {
          state.readMessage(frame)
          if (!state.complete) socket.send(state.writeMessage())
          if (state.complete) {
            const result = state.finish()
            channel = new NoiseMessageTransport(result.transport)
            context = Object.freeze({
              source: "remote",
              clientId: Buffer.from(result.remoteStaticPublicKey).toString(
                "base64url"
              ),
              connectionId,
              profileId: profile.dataSetId,
              foreground: true,
            })
            peer.ready = true
            clearTimeout(handshakeTimer)
            void send({
              type: "ready",
              version: wireVersion,
              profileId: profile.dataSetId,
            })
            timer = setInterval(() => {
              try {
                if (Date.now() - lastMessage > 35000) peer.close()
                else void send({ type: "ping" })
              } catch {
                peer.close()
              }
            }, 10000)
          }
        } else {
          const plaintext = channel.openFrame(frame)
          if (plaintext) {
            const packet = decode(plaintext)
            plaintext.fill(0)
            void dispatch(packet).catch(() => peer.close())
          }
        }
      } catch {
        peer.close()
      }
    })
    socket.on("close", () => {
      clearInterval(timer)
      clearTimeout(handshakeTimer)
      channel?.close()
      if (peers.get(connectionId) === peer) peers.delete(connectionId)
      if (context) selected.delete(context.clientId)
      for (const controller of controllers.values())
        if (controller.readOnly) controller.abort()
      // Accepted Agent work owns its original lifecycle. Disconnect ends reads,
      // never launches a replay or cancels the host's accepted run.
    })
  }
  const connect = () => {
    if (closed) return
    const socket = new WebSocket(
      relayUrl(origin, "server", identity.serverId),
      { followRedirects: false, maxPayload: 2048 }
    )
    control = socket
    let lastPong = Date.now()
    socket.on("open", () => {
      if (closed || control !== socket) return socket.terminate()
      online = true
      issue = "已连接evework"
      attempt = 0
      heartbeat = setInterval(() => {
        if (closed || control !== socket) return
        try {
          if (Date.now() - lastPong > 35000) socket.terminate()
          else
            socket.send(JSON.stringify({ type: "ping", nonce: randomUUID() }))
        } catch {
          clearInterval(heartbeat)
          socket.terminate()
        }
      }, 10000)
    })
    socket.on("message", (data) => {
      if (closed || control !== socket) return
      try {
        const frame = JSON.parse(data.toString())
        if (frame.type === "pong") lastPong = Date.now()
        else if (frame.type === "connected") openPeer(frame.connectionId)
        else if (frame.type === "disconnected")
          peers.get(frame.connectionId)?.close()
        else if (frame.type === "sync" && Array.isArray(frame.connectionIds)) {
          closePeers()
          for (const id of frame.connectionIds) openPeer(id)
        } else socket.terminate()
      } catch {
        socket.terminate()
      }
    })
    socket.on("error", () => {})
    socket.on("close", () => {
      if (closed || control !== socket) return
      clearInterval(heartbeat)
      closePeers()
      online = false
      issue = "连接已中断；正在重新连接，主机已接受的任务继续。"
      retry = setTimeout(
        connect,
        Math.min(30000, 500 * 2 ** Math.min(attempt++, 6))
      )
    })
  }
  connect()
  return {
    operations: {
      ...uploadOperations(host),
      connection: {
        ...remoteOperations.connection,
        execute: async () => ({ value: status() }),
      },
      directories: {
        ...remoteOperations.directories,
        execute: async (input, _context, signal) => ({
          value: await browseDirectories(input.path, signal),
        }),
      },
      reset: {
        ...remoteOperations.reset,
        execute: async () => {
          const nextKeys = generateNoiseKeyPair()
          const nextIdentity = {
            serverId: randomUUID(),
            secret: Buffer.from(nextKeys.secretKey).toString("base64"),
          }
          await replaceJson(identityFile, nextIdentity)
          clearTimeout(retry)
          clearInterval(heartbeat)
          closePeers()
          const previous = control
          control = undefined
          previous?.terminate()
          keys.secretKey.fill(0)
          keys = nextKeys
          identity = nextIdentity
          selected.clear()
          online = false
          issue = "原连接已重置，正在建立新连接。"
          connect()
          return { value: status() }
        },
      },
    },
    status: () => issue,
    close() {
      closed = true
      online = false
      clearTimeout(retry)
      clearInterval(heartbeat)
      closePeers()
      control?.terminate()
      keys.secretKey.fill(0)
    },
  }
}
