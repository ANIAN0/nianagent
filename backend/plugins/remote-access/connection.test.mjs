import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { WebSocketServer } from "ws"
import { activate } from "./host.mjs"
import {
  handshake,
  finish,
  encode,
  decode,
  wireVersion,
} from "./connection.mjs"
import { generateNoiseKeyPair } from "./noise/channel.mjs"
import { requestContext } from "../../request-context.mjs"

const until = async (predicate) => {
  for (let n = 0; n < 100; n++) {
    const value = await predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error("condition not reached in 2 seconds")
}

test("真实本机WebSocket/Noise连接、RPC授权、取消、断线重连与错误分类", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-remote-"))
  const pluginDirectory = join(directory, "plugin")
  await mkdir(pluginDirectory)
  await writeFile(
    join(directory, "moon-data.json"),
    JSON.stringify({ dataSetId: "test-profile" })
  )
  const relay = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await once(relay, "listening")
  let control,
    controls = 0,
    app,
    settings,
    cancelled = false,
    accepted = false,
    finishWrite,
    writeAborted
  const peers = new Map(),
    requests = []
  relay.on("connection", (socket, request) => {
    const id = new URL(request.url, "http://localhost").searchParams.get(
      "connectionId"
    )
    if (!id) {
      control = socket
      controls++
      socket.on("message", (bytes) => {
        if (JSON.parse(bytes).type === "ping")
          socket.send(JSON.stringify({ type: "pong" }))
      })
      return
    }
    peers.set(id, socket)
  })
  t.after(async () => {
    app?.close()
    for (const socket of relay.clients) socket.terminate()
    await new Promise((resolve) => relay.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  app = await activate({
    directory: pluginDirectory,
    configuration: { origin: `http://127.0.0.1:${relay.address().port}` },
    dataRoot: () => directory,
    materials: { directory: join(directory, "materials") },
    sessions: { identity() {}, cwd: async (value) => value },
    async dispatch(operation, input, signal) {
      requests.push({ operation, context: requestContext() })
      if (operation === "workspaceList")
        return { items: [], selectedId: "local-only" }
      if (operation === "list")
        throw new Error("provider token=SECRET_SENTINEL")
      if (operation === "conversationFollow")
        return new Promise((resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              cancelled = true
              reject(signal.reason)
            },
            { once: true }
          )
        )
      if (operation === "conversationSend") {
        accepted = true
        return new Promise((resolve) => {
          finishWrite = () => {
            writeAborted = signal.aborted
            resolve({ accepted: true })
          }
        })
      }
      throw new Error("unexpected operation")
    },
  })
  await until(
    async () => (await app.operations.connection.execute()).value.online
  )
  settings = new URLSearchParams(
    new URL((await app.operations.connection.execute()).value.url).hash.slice(1)
  )
  const clientKeys = generateNoiseKeyPair()
  const open = async (wrongKey = false, keys = clientKeys) => {
    const id = "conn_" + randomUUID().replaceAll("-", "")
    control.send(JSON.stringify({ type: "connected", connectionId: id }))
    const socket = await until(() => peers.get(id))
    const state = handshake(
      "initiator",
      settings.get("server"),
      keys,
      wrongKey
        ? generateNoiseKeyPair().publicKey
        : Uint8Array.from(Buffer.from(settings.get("key"), "base64url"))
    )
    const messages = []
    let channel
    socket.on("message", (bytes) => {
      if (!channel) {
        state.readMessage(Uint8Array.from(bytes))
        socket.send(state.writeMessage())
        channel = finish(state)
        return
      }
      const plaintext = channel.openFrame(Uint8Array.from(bytes))
      if (plaintext) messages.push(decode(plaintext))
    })
    socket.send(state.writeMessage())
    if (!wrongKey) {
      await until(() => messages.find((m) => m.type === "ready"))
      assert.equal(messages[0].version, wireVersion)
    }
    return {
      socket,
      messages,
      send(packet) {
        for (const frame of channel.sealMessage(encode(packet)))
          socket.send(frame)
      },
    }
  }
  const peer = await open()
  // 设备允许表：未信任设备完成握手只进入待确认，任何远程请求被拒绝并断开。
  const pendingId = await until(async () => {
    const { value } = await app.operations.clients.execute()
    return value.items.find((item) => item.state === "pending")?.id
  })
  const secondTab = await open()
  secondTab.socket.close()
  await until(
    async () => (await app.operations.connection.execute()).value.clients === 1
  )
  assert.deepEqual((await app.operations.clients.execute()).value.items, [
    { id: pendingId, state: "pending", online: true },
  ])
  peer.send({
    type: "rpc",
    id: randomUUID(),
    operation: "workspaceList",
    input: {},
  })
  await until(
    async () => (await app.operations.connection.execute()).value.clients === 0
  )
  assert.equal(requests.length, 0)
  const trusted = await app.operations.trust.execute({ id: pendingId })
  assert.ok(
    trusted.value.items.some(
      (item) => item.id === pendingId && item.state === "trusted"
    )
  )
  const authorized = await open()
  const rpc = async (operation, input = {}) => {
    const id = randomUUID()
    authorized.send({ type: "rpc", id, operation, input })
    return until(() => authorized.messages.find((m) => m.id === id))
  }
  assert.deepEqual((await rpc("workspaceList")).result, {
    items: [],
    selectedId: null,
  })
  assert.equal(requests[0].context.source, "remote")
  assert.ok(requests[0].context.traceId)
  assert.ok((await rpc("save", {})).error)
  assert.equal(
    requests.some((r) => r.operation === "save"),
    false
  )
  const failure = await rpc("list")
  assert.ok(failure.error)
  assert.equal(JSON.stringify(failure).includes("SECRET_SENTINEL"), false)
  const cancelId = randomUUID()
  authorized.send({
    type: "rpc",
    id: cancelId,
    operation: "conversationFollow",
    input: { sessionId: "session", afterVersion: 0 },
  })
  await until(() => requests.some((r) => r.operation === "conversationFollow"))
  authorized.send({ type: "cancel", id: cancelId })
  await until(() => cancelled)
  authorized.send({
    type: "rpc",
    id: randomUUID(),
    operation: "conversationSend",
    input: {
      sessionId: "session",
      workspaceId: "workspace",
      clientRequestId: "request",
      text: "accepted",
      connectionId: "model",
      modelId: "model",
      thinking: "off",
    },
  })
  await until(() => accepted)
  authorized.socket.close()
  await until(
    async () => (await app.operations.connection.execute()).value.clients === 0
  )
  finishWrite()
  assert.equal(writeAborted, false)
  assert.match(app.status(), /normal-offline/)
  // forget：移除已信任设备后，后续握手重新进入待确认，需再次本机信任。
  await app.operations.forget.execute({ id: pendingId })
  assert.ok(
    !(await app.operations.clients.execute()).value.items.some(
      (item) => item.id === pendingId
    )
  )
  const protocol = await open()
  protocol.socket.send("not binary")
  await until(
    async () => (await app.operations.connection.execute()).value.clients === 0
  )
  assert.match(app.status(), /protocol-error/)
  await open(true)
  await until(() => app.status().includes("authentication-failed"))
  const before = controls
  control.close()
  await until(() => controls > before)
  await until(
    async () => (await app.operations.connection.execute()).value.online
  )
  assert.match(app.status(), /control-offline/)
  const beforeMalformed = controls
  control.send("invalid control packet")
  await until(() => controls > beforeMalformed)
  assert.match(app.status(), /control-protocol-error/)
  const oldServer = settings.get("server")
  await app.operations.reset.execute()
  await until(
    async () => (await app.operations.connection.execute()).value.online
  )
  const newSettings = new URLSearchParams(
    new URL((await app.operations.connection.execute()).value.url).hash.slice(1)
  )
  assert.notEqual(newSettings.get("server"), oldServer)
  assert.notEqual(newSettings.get("key"), settings.get("key"))
  // 重置身份即清空允许表：已信任与待确认设备都需凭新链接重新本机确认。
  assert.deepEqual((await app.operations.clients.execute()).value.items, [])
})
