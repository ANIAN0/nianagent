import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join, relative, isAbsolute } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"

const storageKey = "moon.configuration-recovery.v1"
const storePath = "/src/features/models/configuration-recovery-store.ts"

// A fresh Vite SSR graph reinitializes the actual module, including its
// createdHere/finishedHere owners. It does not replace its persistence logic.
async function loadOwner(t) {
  const cache = await mkdtemp(join(tmpdir(), "moon-config-recovery-"))
  let server
  t.after(async () => {
    await server?.close()
    const boundary = relative(resolve(tmpdir()), resolve(cache))
    assert.ok(boundary && !boundary.startsWith("..") && !isAbsolute(boundary))
    assert.ok(boundary.startsWith("moon-config-recovery-"))
    await rm(cache, { recursive: true, force: true })
  })
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  return {
    server,
    store: await server.ssrLoadModule(storePath),
    receipt: await server.ssrLoadModule(
      "/src/features/models/settings-write-recovery.ts"
    ),
  }
}

function storageFixture(t, initial = []) {
  const values = new Map(
    initial.length ? [[storageKey, JSON.stringify(initial)]] : []
  )
  let fault
  const accesses = []
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) {
        accesses.push(["read", key])
        if (fault === "read" || fault === "all")
          throw new Error("read unavailable")
        return values.get(key) ?? null
      },
      setItem(key, value) {
        accesses.push(["write", key])
        if (fault === "write" || fault === "all")
          throw new Error("quota exceeded")
        values.set(key, value)
      },
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  return {
    values,
    accesses,
    deny: (value) => {
      fault = value
    },
    saved: () => JSON.parse(values.get(storageKey) ?? "[]"),
  }
}

function identity(operation = "save", id = "original-a", target = "target-a") {
  return { operation, operationRequestId: id, targetId: target, revision: 3 }
}

test("only canonical request metadata is persisted for authoritative write operations and OAuth", async (t) => {
  const fixture = storageFixture(t)
  const { store, server } = await loadOwner(t)
  const { receiptOperationNames } = await server.ssrLoadModule(
    "/src/features/models/model-contract.generated.ts"
  )
  for (const [index, operation] of [
    ...receiptOperationNames,
    "authStart",
  ].entries()) {
    const expected = identity(operation, `original-${index}`)
    store.retainConfigurationAttempt({
      ...expected,
      apiKey: "must-never-persist-key",
      headers: { Authorization: "must-never-persist-header" },
      connection: { apiKey: "must-never-persist-nested-key" },
      configuration: "must-never-persist-configuration",
      draft: "must-never-persist-input",
      prompt: "must-never-persist-oauth-prompt",
    })
    assert.deepEqual(fixture.saved().at(-1), expected)
  }
  assert.deepEqual([...fixture.values.keys()], [storageKey])
  assert.doesNotMatch(fixture.values.get(storageKey), /must-never-persist/)
  const before = fixture.values.get(storageKey)
  assert.throws(() => store.retainConfigurationAttempt(identity("discover")))
  assert.throws(() =>
    store.retainConfigurationAttempt({ ...identity(), revision: -1 })
  )
  assert.equal(fixture.values.get(storageKey), before)
})

test("a current-process attempt never becomes a restored recovery-pane candidate", async (t) => {
  const fixture = storageFixture(t)
  const { store } = await loadOwner(t)
  const attempt = identity()
  store.retainConfigurationAttempt(attempt)
  assert.equal(store.isRestoredConfigurationAttempt(fixture.saved()[0]), false)
  store.retainConfigurationAttempt(attempt)
  assert.equal(fixture.saved().length, 1)
  assert.equal(store.isRestoredConfigurationAttempt(attempt), false)
})

test("a fresh application owner restores only original metadata and never replays the write", async (t) => {
  const fixture = storageFixture(t)
  const first = await loadOwner(t)
  first.store.retainConfigurationAttempt(identity())
  const writes = fixture.accesses.filter(([kind]) => kind === "write").length
  const restarted = await loadOwner(t)
  assert.equal(restarted.store.recheckConfigurationRecoveryStore(), true)
  const restored = fixture.saved()
  assert.deepEqual(restored, [identity()])
  assert.equal(
    restarted.store.isRestoredConfigurationAttempt(restored[0]),
    true
  )
  assert.equal(
    fixture.accesses.filter(([kind]) => kind === "write").length,
    writes
  )
})

test("quota prevents the actual model-editor caller from crossing its service boundary", async (t) => {
  const fixture = storageFixture(t)
  const { store, server } = await loadOwner(t)
  const { useConnectionEditor } = await server.ssrLoadModule(
    "/src/features/models/use-connection-editor.ts"
  )
  const { blankConnection } = await server.ssrLoadModule(
    "/src/features/models/model-types.ts"
  )
  const initial = { ...blankConnection("api"), name: "Local endpoint" }
  let editor
  let rpcCalls = 0
  let accepted = 0
  const service = {
    async save(connection, signal, operationRequestId) {
      signal.throwIfAborted()
      rpcCalls++
      assert.equal(fixture.saved()[0].operationRequestId, operationRequestId)
      return { ...connection, revision: 1 }
    },
  }
  function Probe() {
    editor = useConnectionEditor({
      initial,
      connections: [],
      service,
      onSaved: () => accepted++,
      onClose() {},
    })
    return null
  }
  // React owns the real hook state/refs; browser effects and layout are separate
  // acceptance. The imperative save boundary itself does not require a DOM.
  renderToString(createElement(Probe))
  fixture.deny("write")
  editor.save()
  await new Promise(setImmediate)
  assert.equal(rpcCalls, 0)
  assert.equal(accepted, 0)
  assert.deepEqual(fixture.saved(), [])
  fixture.deny(undefined)
  assert.equal(store.recheckConfigurationRecoveryStore(), true)
  editor.recoverStorage()
  editor.save()
  await new Promise(setImmediate)
  assert.equal(rpcCalls, 1)
  assert.equal(accepted, 1)
  assert.deepEqual(fixture.saved(), [])
})

for (const state of ["committed", "rejected"])
  test(`${state} clears only the original operation and request identity`, async (t) => {
    const original = identity("save", "shared-id", "target-a")
    const differentOperation = identity("remove", "shared-id", "target-a")
    const differentRequest = identity("save", "other-id", "target-a")
    const fixture = storageFixture(t, [
      original,
      differentOperation,
      differentRequest,
    ])
    const { store, receipt } = await loadOwner(t)
    const readCalls = []
    const result = await receipt.readSettingsWriteReceipt(
      async (operation, operationRequestId) => {
        readCalls.push([operation, operationRequestId])
        return { ...original, state }
      },
      original,
      new AbortController().signal
    )
    assert.equal(result.state, state)
    store.finishConfigurationAttempt(
      result.operation,
      result.operationRequestId
    )
    assert.deepEqual(readCalls, [["save", "shared-id"]])
    assert.deepEqual(fixture.saved(), [differentOperation, differentRequest])
  })

test("unknown or mismatched authoritative receipts preserve every original identity", async (t) => {
  const original = identity()
  const fixture = storageFixture(t, [original])
  const { store, receipt } = await loadOwner(t)
  const result = await receipt.readSettingsWriteReceipt(
    async () => ({ ...original, targetId: "", state: "unknown" }),
    original,
    new AbortController().signal
  )
  assert.equal(result.state, "unknown")
  for (const mismatch of [
    { operationRequestId: "different-original" },
    { operation: "remove" },
    { targetId: "different-target" },
  ])
    await assert.rejects(
      receipt.readSettingsWriteReceipt(
        async () => ({ ...original, state: "committed", ...mismatch }),
        original,
        new AbortController().signal
      ),
      (error) => error.issue.code === "result_unknown"
    )
  assert.equal(store.recheckConfigurationRecoveryStore(), true)
  assert.deepEqual(fixture.saved(), [original])
})

test("known cleanup failure recovers through a local reread without deleting unknown requests", async (t) => {
  const known = identity()
  const unresolved = identity("mcpSave", "original-b", "service-b")
  const fixture = storageFixture(t, [known, unresolved])
  const { store } = await loadOwner(t)
  fixture.deny("write")
  store.finishConfigurationAttempt(known.operation, known.operationRequestId)
  assert.deepEqual(fixture.saved(), [known, unresolved])
  assert.equal(store.recheckConfigurationRecoveryStore(), false)
  fixture.deny(undefined)
  assert.equal(store.recheckConfigurationRecoveryStore(), true)
  assert.deepEqual(fixture.saved(), [unresolved])
  assert.equal(store.isRestoredConfigurationAttempt(unresolved), true)
})

test("damaged recovery storage is preserved and cannot be replaced by a new write", async (t) => {
  const fixture = storageFixture(t)
  fixture.values.set(storageKey, "{not valid JSON")
  const { store } = await loadOwner(t)
  assert.throws(
    () => store.retainConfigurationAttempt(identity()),
    (error) => error.issue.code === "recovery_storage_unavailable"
  )
  assert.equal(store.recheckConfigurationRecoveryStore(), false)
  assert.equal(fixture.values.get(storageKey), "{not valid JSON")
  assert.equal(fixture.accesses.filter(([kind]) => kind === "write").length, 0)
})

test("demo mutations and terminal cleanup never read or write formal recovery storage", async (t) => {
  const fixture = storageFixture(t, [identity()])
  fixture.deny("all")
  const { store } = await loadOwner(t)
  store.retainConfigurationAttempt(identity("mcpSave", "demo-id"), true)
  store.finishConfigurationAttempt("save", "original-a", true)
  store.finishConfigurationAttempt("save", "original-a", true, true)
  assert.deepEqual(fixture.accesses, [])
  assert.deepEqual(fixture.saved(), [identity()])
})
