import { Buffer } from "buffer"
import {
  generateNoiseKeyPair,
  noiseKeyPairFromSecret,
} from "./noise/channel.mjs"
import {
  decode,
  encode,
  finish,
  handshake,
  messageLimit,
  relayUrl,
  remoteOrigin,
  wireVersion,
} from "./connection.mjs"
import {
  setRemoteTransport,
  clearRemoteTransport,
  type RemoteCall,
} from "@/lib/rpc/remote-transport"
import {
  bindRemoteStorage,
  profileSessionStorage,
} from "@/lib/rpc/profile-storage"

export type ConnectionInfo = { server: string; key: string; gateway: string }
export function readConnection(value: string): ConnectionInfo {
  if (!value.trim()) throw new Error("请先输入Moon连接链接。")
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error("请输入有效的Moon连接链接。", { cause: error })
  }
  const fields = new URLSearchParams(url.hash.slice(1))
  const server = fields.get("server") || "",
    key = fields.get("key") || ""
  if (!/^[a-f0-9-]{36}$/.test(server) || !/^[A-Za-z0-9_-]{43}$/.test(key))
    throw new Error("连接链接缺少有效电脑身份。")
  return {
    server,
    key,
    gateway: remoteOrigin(fields.get("gateway") || url.origin),
  }
}
export async function connectRemote(
  info: ConnectionInfo,
  status: (ready: boolean, issue: string) => void
) {
  ;(window as Window & { Buffer?: typeof Buffer }).Buffer = Buffer
  const storageKey = `moon.remote.client.${info.server}`
  const saved = sessionStorage.getItem(storageKey)
  const keys = saved
    ? noiseKeyPairFromSecret(Uint8Array.from(Buffer.from(saved, "base64")))
    : generateNoiseKeyPair()
  sessionStorage.setItem(
    storageKey,
    Buffer.from(keys.secretKey).toString("base64")
  )
  let socket: WebSocket | undefined,
    channel: ReturnType<typeof finish> | undefined,
    timer: ReturnType<typeof setInterval> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined,
    retry: ReturnType<typeof setTimeout> | undefined
  let closed = false,
    ready = false,
    attempt = 0,
    lastMessage = Date.now(),
    outgoing = Promise.resolve(),
    queuedBytes = 0,
    queuedMessages = 0,
    fatalIssue = "",
    connectionIssue = ""
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: unknown) => void
      cleanup: () => void
    }
  >()
  const rejectPending = () => {
    for (const item of pending.values()) {
      item.cleanup()
      item.reject(new Error("连接中断，原请求结果未知；未自动重做。"))
    }
    pending.clear()
  }
  const send = (value: unknown) => {
    if (!channel || !socket || socket.readyState !== WebSocket.OPEN)
      throw new Error("远程通道未就绪。")
    const bytes = encode(value)
    if (bytes.length > messageLimit) throw new Error("请求超过原通道容量。")
    if (
      queuedMessages >= 64 ||
      queuedBytes + bytes.length > messageLimit + 65536
    ) {
      socket.close()
      throw new Error("远程发送队列已满，请恢复连接后核对原请求。")
    }
    const frames = channel.sealMessage(bytes),
      current = socket
    const size = frames.reduce((sum, frame) => sum + frame.length, 0)
    if (queuedBytes + size > messageLimit + 65536) {
      current.close()
      throw new Error("远程接收过慢，通道已关闭。")
    }
    queuedBytes += size
    queuedMessages += 1
    outgoing = outgoing
      .then(async () => {
        for (const frame of frames) {
          if (current !== socket || current.readyState !== WebSocket.OPEN)
            throw new Error("远程发送已中断。")
          const deadline = Date.now() + 15000
          while (current.bufferedAmount + frame.length > 2 * 1024 * 1024) {
            if (Date.now() > deadline || current.readyState !== WebSocket.OPEN)
              throw new Error("远程接收过慢。")
            await new Promise((resolve) => setTimeout(resolve, 10))
          }
          current.send(Uint8Array.from(frame))
        }
      })
      .catch(() => current.close())
      .finally(() => {
        queuedBytes -= size
        queuedMessages -= 1
      })
  }
  const call: RemoteCall = (operation, input, signal) =>
    new Promise((resolve, reject) => {
      signal?.throwIfAborted()
      if (!ready || pending.size >= 64) {
        reject(new Error("远程连接未就绪或请求繁忙。"))
        return
      }
      const id = crypto.randomUUID()
      const abort = () => {
        pending.delete(id)
        cleanup()
        try {
          send({ type: "cancel", id })
        } catch {
          /* Original result remains unknown. */
        }
        reject(signal?.reason)
      }
      const expiry = setTimeout(() => {
        pending.delete(id)
        signal?.removeEventListener("abort", abort)
        reject(new Error("原请求等待超时；未重做未知操作。"))
      }, 180000)
      const cleanup = () => {
        clearTimeout(expiry)
        signal?.removeEventListener("abort", abort)
      }
      pending.set(id, {
        resolve: (value) => {
          if (operation === "workspaceSelect" || operation === "workspaceAdd")
            profileSessionStorage.setItem(
              "moon.remote.workspace",
              (value as { id: string }).id
            )
          if (operation === "workspaceList") {
            const result = value as {
              items: { id: string }[]
              selectedId: string | null
            }
            const chosen = profileSessionStorage.getItem(
              "moon.remote.workspace"
            )
            if (chosen && result.items.some((item) => item.id === chosen))
              result.selectedId = chosen
          }
          resolve(value as never)
        },
        reject,
        cleanup,
      })
      signal?.addEventListener("abort", abort, { once: true })
      try {
        send({ type: "rpc", id, operation, input })
      } catch (error) {
        pending.delete(id)
        cleanup()
        reject(error)
      }
    })
  const open = () => {
    if (closed) return
    ready = false
    status(
      false,
      connectionIssue
        ? `${connectionIssue} 正在重新连接…`
        : "正在与本机Moon建立加密连接…"
    )
    const current = new WebSocket(relayUrl(info.gateway, "client", info.server))
    socket = current
    current.binaryType = "arraybuffer"
    const state = handshake(
      "initiator",
      info.server,
      keys,
      Uint8Array.from(
        Buffer.from(
          info.key.replaceAll("-", "+").replaceAll("_", "/"),
          "base64"
        )
      )
    )
    channel = undefined
    outgoing = Promise.resolve()
    timeout = setTimeout(() => {
      if (closed || socket !== current || ready) return
      connectionIssue = "连接本机Moon等待超时，请检查主机和远程插件。"
      status(false, connectionIssue)
      current.close()
    }, 15000)
    current.onopen = () => {
      if (closed || socket !== current) return current.close()
      current.send(Uint8Array.from(state.writeMessage()))
    }
    current.onmessage = (event) => {
      if (closed || socket !== current) {
        current.close()
        return
      }
      try {
        if (
          !(event.data instanceof ArrayBuffer) ||
          event.data.byteLength > 70000
        )
          throw new Error("远程帧无效。")
        lastMessage = Date.now()
        if (!channel) {
          state.readMessage(new Uint8Array(event.data))
          current.send(Uint8Array.from(state.writeMessage()))
          channel = finish(state)
        } else {
          const plaintext = channel.openFrame(new Uint8Array(event.data))
          if (!plaintext) return
          const packet = decode(plaintext)
          plaintext.fill(0)
          if (packet.type === "ready") {
            if (packet.version !== wireVersion)
              throw new Error("Moon主机版本不兼容，请更新后重新连接。")
            if (!bindRemoteStorage({ ...info, profileId: packet.profileId })) {
              closed = true
              clearRemoteTransport(call)
              rejectPending()
              status(false, "主机数据集已变化，正在重新打开工作台。")
              current.close()
              window.location.reload()
              return
            }
            clearTimeout(timeout)
            ready = true
            connectionIssue = ""
            attempt = 0
            setRemoteTransport(call)
            status(true, "已连接本机Moon")
            timer = setInterval(() => {
              if (closed || socket !== current) return
              try {
                if (Date.now() - lastMessage > 35000) current.close()
                else send({ type: "ping" })
              } catch {
                clearInterval(timer)
                connectionIssue = "远程心跳发送中断，正在恢复连接。"
                current.close()
              }
            }, 10000)
          } else if (packet.type === "ping") send({ type: "pong" })
          else if (packet.type === "pong") {
            /* Application lease renewed in both directions. */
          } else if (packet.type === "result") {
            const item = pending.get(packet.id)
            if (!item) return
            pending.delete(packet.id)
            item.cleanup()
            if (typeof packet.error === "string")
              item.reject(
                Object.assign(new Error(packet.error), {
                  remoteRejected: true,
                  issue: packet.issue,
                })
              )
            else item.resolve(packet.result)
          } else throw new Error("远程业务版本不兼容。")
        }
      } catch (error) {
        fatalIssue =
          error instanceof Error && /版本不兼容/.test(error.message)
            ? error.message
            : "连接身份或协议验证失败，请重新确认连接链接。"
        closed = true
        current.close()
      }
    }
    current.onerror = () => {
      if (closed || socket !== current) return
      connectionIssue = "无法连接本机Moon；检查主机和远程插件。"
      status(false, connectionIssue)
    }
    current.onclose = () => {
      if (socket !== current) return
      clearInterval(timer)
      clearTimeout(timeout)
      channel?.close()
      ready = false
      clearRemoteTransport(call)
      rejectPending()
      connectionIssue ||= "连接已中断；主机已接受的任务继续，重连后读取原状态。"
      status(false, fatalIssue || connectionIssue)
      if (!closed)
        retry = setTimeout(
          open,
          Math.min(30000, 500 * 2 ** Math.min(attempt++, 6))
        )
    }
  }
  open()
  return () => {
    closed = true
    clearTimeout(retry)
    clearTimeout(timeout)
    clearInterval(timer)
    clearRemoteTransport(call)
    rejectPending()
    socket?.close()
    channel?.close()
    keys.secretKey.fill(0)
  }
}
