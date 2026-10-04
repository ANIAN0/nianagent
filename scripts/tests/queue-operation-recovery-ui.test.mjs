import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"

let server, cache, recovery, useLive
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-queue-recovery-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  recovery = await server.ssrLoadModule(
    "/src/features/conversation/queue-operation-recovery.ts"
  )
  ;({ useLiveConversation: useLive } = await server.ssrLoadModule(
    "/src/features/conversation/use-live-conversation.ts"
  ))
})
test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-queue-recovery-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// Real hook methods, storage boundary and formal modelCall are exercised here.
// SSR does not run polling effects or reactive DOM updates; those remain part
// of final browser/native acceptance, together with real Pi queue delivery.
function storage(t, fail = () => false) {
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const store = {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail("set", key)) throw new Error("quota")
      values.set(key, value)
    },
    removeItem: (key) => {
      if (fail("remove", key)) throw new Error("quota")
      values.delete(key)
    },
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  return { store, values }
}
function probe() {
  let chat
  function Probe() {
    chat = useLive(undefined)
    return null
  }
  renderToString(createElement(Probe))
  return chat
}
const original = (operation = "conversationQueueMode") => ({
  sessionId: "queue-session",
  operationRequestId: "queue-original-request",
  operation,
  revision: 7,
  ...(operation === "conversationQueueMode"
    ? { mode: "all" }
    : { itemId: "queue-item" }),
})
const snapshot = (revision = 8) => ({
  id: "queue-session",
  epoch: "queue-epoch",
  version: revision,
  phase: "completed",
  runId: "queue-run",
  inputAccepted: true,
  queue: { revision, mode: "all", items: [], acceptedRequestIds: [] },
})
const receipt = (record, state, extra = {}) => ({
  sessionId: record.sessionId,
  operationRequestId: record.operationRequestId,
  state,
  operation: record.operation,
  baseRevision: record.revision,
  ...(record.mode ? { mode: record.mode } : { itemId: record.itemId }),
  ...extra,
})
const missing = (record, retryOriginalAllowed = true) => ({
  sessionId: record.sessionId,
  operationRequestId: record.operationRequestId,
  state: "unknown",
  retryOriginalAllowed,
})
const issue = {
  code: "queue_stale",
  summary: "队列版本已变化，请重新读取。",
  severity: "warning",
  recovery: "reload",
}
const readFailure = {
  code: "host_version",
  summary: "当前宿主不支持原队列回执，请更新并重启。",
  severity: "error",
  recovery: "restart",
}
function fixture(t, handler) {
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const operation = String(url).split("/").at(-1)
    const input = JSON.parse(options.body)
    calls.push({ operation, input })
    return handler(operation, input, calls)
  })
  return calls
}
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test("recovery storage explicitly excludes drafts, materials, credentials and host strings", (t) => {
  const { values } = storage(t)
  const record = recovery.saveQueueOperation({
    ...original(),
    text: "private draft",
    materials: [{ body: "private file" }],
    apiKey: "private key",
    headers: { authorization: "secret" },
    cwd: "private path",
  })
  assert.deepEqual(record, original())
  assert.equal(Object.isFrozen(record), true)
  assert.deepEqual(JSON.parse([...values.values()][0]), original())
  assert.equal([...values.values()][0].includes("private"), false)
})

test("same original identity cannot be overwritten or cleaned with a different target/revision", (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(original())
  assert.throws(
    () => recovery.saveQueueOperation({ ...record, mode: "single" }),
    /已变化/
  )
  assert.throws(
    () => recovery.clearQueueOperation({ ...record, revision: 9 }),
    /已变化/
  )
  assert.deepEqual(recovery.restoreQueueOperations().records, [original()])
})

test("unreadable or corrupt recovery metadata is preserved and blocks queue writes", async (t) => {
  const { values } = storage(t)
  recovery.saveQueueOperation(original())
  const key = [...values.keys()][0]
  values.set(key, "{corrupt")
  const calls = fixture(t, () =>
    assert.fail("a storage fault must never call RPC")
  )
  const chat = probe()
  await assert.rejects(chat.queueMode("queue-session", "single"), /损坏/)
  assert.equal(values.get(key), "{corrupt")
  assert.equal(calls.length, 0)
})

test("metadata must persist before any remove/mode/deliver RPC", async (t) => {
  storage(t, (action) => action === "set")
  const calls = fixture(t, () =>
    assert.fail("failed local persistence must not reach host")
  )
  const chat = probe()
  await assert.rejects(
    chat.queueRemove("queue-session", "queue-item"),
    /尚未发送/
  )
  await assert.rejects(chat.queueMode("queue-session", "all"), /尚未发送/)
  await assert.rejects(
    chat.queueDeliver("queue-session", "queue-item"),
    /尚未发送/
  )
  assert.equal(calls.length, 0)
})

test("lost queue response retains original ID and blocks new queue/edit/send without RPC", async (t) => {
  storage(t)
  const calls = fixture(t, () => {
    throw new Error("lost response")
  })
  const chat = probe()
  await assert.rejects(chat.queueDeliver("queue-session", "queue-item"))
  const [record] = recovery.restoreQueueOperations().records
  assert.equal(record.operationRequestId, calls[0].input.operationRequestId)
  assert.equal(record.operation, "conversationQueueDeliver")
  await assert.rejects(
    chat.queueDeliver("queue-session", "queue-item"),
    /先核对/
  )
  await assert.rejects(
    chat.queueRemove("queue-session", "another-item"),
    /先核对/
  )
  await assert.rejects(
    chat.queueEdit("queue-session", "queue-item", "new text"),
    /先核对/
  )
  const nextDraft = {
    workspaceId: "workspace",
    model: "conn/model",
    thinking: "关闭",
    materials: [],
    text: "next draft",
    session: { toolIds: [], instructionScope: "none" },
  }
  await assert.rejects(chat.send("queue-session", nextDraft, []), /先核对/)
  assert.equal(
    localStorage
      .getItem("moon.chat.draft.v1.queue-session")
      .includes("next draft"),
    true
  )
  assert.equal(calls.length, 1)
})

test("reload restores unknown routing metadata and reads only the original receipt", async (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(
    original("conversationQueueRemove")
  )
  const calls = fixture(t, (op, input) => {
    assert.equal(op, "conversationQueueReceiptRead")
    assert.deepEqual(input, {
      sessionId: record.sessionId,
      operationRequestId: record.operationRequestId,
    })
    return Response.json({ result: missing(record, false) })
  })
  const chat = probe()
  assert.ok(chat.queueRecoveryReason[record.sessionId])
  assert.equal(
    chat.queueIssues[record.sessionId]["queue-remove:queue-item"].recovery,
    "check"
  )
  await chat.checkQueueReceipts(record.sessionId)
  await chat.checkQueueReceipts(record.sessionId)
  assert.equal(calls.length, 2)
  assert.equal(recovery.restoreQueueOperations().records.length, 1)
  await assert.rejects(
    chat.retryQueueOriginal(record.sessionId, "queue-remove:queue-item"),
    /尚不可恢复/
  )
})

test("ordinary snapshot appearance cannot confirm an unknown mode/remove/deliver operation", async (t) => {
  storage(t)
  for (const operation of [
    "conversationQueueMode",
    "conversationQueueRemove",
    "conversationQueueDeliver",
  ])
    recovery.saveQueueOperation({
      ...original(operation),
      operationRequestId: operation,
    })
  const calls = fixture(t, (op) => {
    if (op === "conversationReceiptRead")
      return Response.json({
        result: {
          sessionId: "queue-session",
          clientRequestId: "old-send",
          state: "accepted",
        },
      })
    assert.equal(op, "conversationRead")
    return Response.json({ result: snapshot(50) })
  })
  const chat = probe()
  await chat.inspectReceipt("queue-session", "old-send")
  assert.equal(recovery.restoreQueueOperations().records.length, 3)
  await assert.rejects(chat.queueMode("queue-session", "single"), /先核对/)
  assert.equal(calls.length, 2)
})

for (const state of ["committed", "rejected"]) {
  test(`only a matching ${state} original receipt releases its boundary without repeating RPC`, async (t) => {
    storage(t)
    const record = recovery.saveQueueOperation(
      original("conversationQueueDeliver")
    )
    const calls = fixture(t, (op) => {
      if (op === "conversationQueueReceiptRead")
        return Response.json({
          result: receipt(record, state, state === "rejected" ? { issue } : {}),
        })
      assert.equal(op, "conversationQueueMode")
      return Response.json({ result: snapshot() })
    })
    const chat = probe()
    await chat.checkQueueReceipts(record.sessionId)
    assert.deepEqual(recovery.restoreQueueOperations().records, [])
    assert.equal(calls.length, 1)
    await chat.queueMode(record.sessionId, "single")
    assert.equal(
      calls.length,
      2,
      "a terminal receipt unlocks a new ordinary action"
    )
  })
}

test("mismatching receipt target/revision cannot clear the original or enable recovery", async (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(
    original("conversationQueueRemove")
  )
  fixture(t, () =>
    Response.json({
      result: receipt(record, "committed", {
        itemId: "other-item",
        baseRevision: 8,
        retryOriginalAllowed: true,
      }),
    })
  )
  const chat = probe()
  await chat.checkQueueReceipts(record.sessionId)
  assert.deepEqual(recovery.restoreQueueOperations().records, [record])
  await assert.rejects(
    chat.retryQueueOriginal(record.sessionId, "queue-remove:queue-item"),
    /尚不可恢复/
  )
})

test("missing-only explicit recovery uses SAME ID, target and base revision after newer snapshot", async (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(
    original("conversationQueueDeliver")
  )
  const calls = fixture(t, (op, input) => {
    if (op === "conversationQueueReceiptRead")
      return Response.json({ result: missing(record) })
    if (op === "conversationReceiptRead")
      return Response.json({
        result: {
          sessionId: record.sessionId,
          clientRequestId: "previous",
          state: "accepted",
        },
      })
    if (op === "conversationRead")
      return Response.json({ result: snapshot(50) })
    assert.equal(op, record.operation)
    assert.deepEqual(input, {
      sessionId: record.sessionId,
      operationRequestId: record.operationRequestId,
      itemId: record.itemId,
      revision: 7,
    })
    return Response.json({ result: snapshot(51) })
  })
  const chat = probe()
  await chat.checkQueueReceipts(record.sessionId)
  assert.equal(calls.length, 1, "checking missing must not automatically retry")
  await chat.inspectReceipt(record.sessionId, "previous")
  await chat.retryQueueOriginal(record.sessionId, "queue-deliver:queue-item")
  assert.equal(
    calls.filter((call) => call.operation === record.operation).length,
    1
  )
  assert.deepEqual(recovery.restoreQueueOperations().records, [])
})

test("registered preparing or unsupported receipt capability never permits original retry", async (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(original())
  let unsupported = false
  const calls = fixture(t, () =>
    unsupported
      ? Response.json({ error: readFailure.summary, issue: readFailure })
      : Response.json({
          result: receipt(record, "unknown", { retryOriginalAllowed: false }),
        })
  )
  const chat = probe()
  await chat.checkQueueReceipts(record.sessionId)
  await assert.rejects(
    chat.retryQueueOriginal(record.sessionId, "mode"),
    /尚不可恢复/
  )
  unsupported = true
  await chat.checkQueueReceipts(record.sessionId)
  await assert.rejects(
    chat.retryQueueOriginal(record.sessionId, "mode"),
    /尚不可恢复/
  )
  assert.equal(calls.length, 2)
  assert.deepEqual(recovery.restoreQueueOperations().records, [record])
})

test("multiple originals for one target require the exact original ID and never overwrite another", async (t) => {
  storage(t)
  const first = recovery.saveQueueOperation(original())
  const second = recovery.saveQueueOperation({
    ...original(),
    operationRequestId: "queue-second-original",
    revision: 8,
    mode: "single",
  })
  const calls = fixture(t, (op, input) => {
    if (op === "conversationQueueReceiptRead")
      return Response.json({ result: missing(input) })
    assert.equal(op, "conversationQueueMode")
    assert.equal(input.operationRequestId, second.operationRequestId)
    assert.equal(input.revision, second.revision)
    assert.equal(input.mode, second.mode)
    return Response.json({ result: snapshot(9) })
  })
  const chat = probe()
  await chat.checkQueueReceipts(first.sessionId)
  await assert.rejects(
    chat.retryQueueOriginal(first.sessionId, "mode"),
    /尚不可恢复/
  )
  await chat.retryQueueOriginal(
    second.sessionId,
    "mode",
    second.operationRequestId
  )
  assert.deepEqual(recovery.restoreQueueOperations().records, [first])
  assert.equal(
    calls.filter((call) => call.operation === "conversationQueueMode").length,
    1
  )
})

test("a known result with failed local cleanup remains readonly and never retries the write", async (t) => {
  let failCleanup = true
  storage(t, (action) => action === "remove" && failCleanup)
  const calls = fixture(t, () => Response.json({ result: snapshot() }))
  const chat = probe()
  await chat.queueMode("queue-session", "all")
  assert.equal(recovery.restoreQueueOperations().records.length, 1)
  await assert.rejects(
    chat.retryQueueOriginal("queue-session", "mode"),
    /尚不可恢复/
  )
  failCleanup = false
  await chat.checkQueueReceipts("queue-session")
  assert.deepEqual(recovery.restoreQueueOperations().records, [])
  assert.equal(
    calls.length,
    1,
    "already-confirmed local cleanup requires no host write or lookup"
  )
})

test("formal rejection cleans identity while aborted transport retains it for readonly checking", async (t) => {
  storage(t)
  let aborted = false
  fixture(t, () => {
    if (aborted) throw new DOMException("cancelled transport", "AbortError")
    return Response.json({ error: issue.summary, issue })
  })
  const chat = probe()
  await assert.rejects(chat.queueRemove("queue-session", "queue-item"))
  assert.deepEqual(recovery.restoreQueueOperations().records, [])
  aborted = true
  await assert.rejects(chat.queueRemove("queue-session", "queue-item"))
  assert.equal(recovery.restoreQueueOperations().records.length, 1)
})

test("duplicate readonly checks share one owner and an aborted late receipt cannot release", async (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(original())
  const entered = deferred(),
    response = deferred()
  const calls = fixture(t, () => {
    entered.resolve()
    return response.promise
  })
  const chat = probe()
  const controller = new AbortController()
  const first = chat.checkQueueReceipts(record.sessionId, controller.signal)
  const rejected = assert.rejects(first, { name: "AbortError" })
  await entered.promise
  assert.equal(
    chat.checkQueueReceipts(record.sessionId, controller.signal),
    first
  )
  controller.abort()
  response.resolve(Response.json({ result: receipt(record, "committed") }))
  await rejected
  assert.equal(calls.length, 1)
  assert.deepEqual(recovery.restoreQueueOperations().records, [record])
})

test("Stop and unrelated session remain reachable while a queue operation needs recovery", async (t) => {
  storage(t)
  const record = recovery.saveQueueOperation(original())
  const calls = fixture(t, (op, input) => {
    if (op === "conversationReceiptRead")
      return Response.json({
        result: {
          sessionId: record.sessionId,
          clientRequestId: "old-send",
          state: "accepted",
        },
      })
    if (op === "conversationRead")
      return Response.json({ result: { ...snapshot(), phase: "running" } })
    if (op === "conversationStop")
      return Response.json({ result: { ...snapshot(9), phase: "stopping" } })
    assert.equal(op, "conversationQueueMode")
    assert.equal(input.sessionId, "other-session")
    return Response.json({ result: { ...snapshot(), id: "other-session" } })
  })
  const chat = probe()
  await chat.inspectReceipt(record.sessionId, "old-send")
  await chat.stop(record.sessionId)
  await chat.queueMode("other-session", "single")
  assert.deepEqual(recovery.restoreQueueOperations().records, [record])
  assert.equal(
    calls.filter((call) => call.operation === "conversationStop").length,
    1
  )
})
