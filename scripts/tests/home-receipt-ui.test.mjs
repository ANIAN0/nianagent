import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createServer } from "vite"
let server, cache, inspect, readReceipt, sameAttempt, observe
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-home-receipt-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  ;({ sameHomeSubmissionAttempt: sameAttempt, observeHomeReceipt: observe } =
    await server.ssrLoadModule("/src/features/home/home-receipt-check.ts"))
  ;({ inspectConversationReceipt: inspect, readConversationReceipt: readReceipt } = await server.ssrLoadModule(
    "/src/features/conversation/conversation-receipt.ts"
  ))
})
test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-home-receipt-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})
const snapshot = {
  id: "home-a",
  clientRequestId: "request-a",
  inputAccepted: true,
  phase: "completed",
}
test("a readonly receipt confirms the durable original request", () => {
  assert.equal(inspect("home-a", "request-a", snapshot).state, "accepted")
})
test("another accepted turn or another session cannot confirm the original", () => {
  assert.equal(inspect("home-a", "request-b", snapshot).state, "unknown")
  assert.equal(inspect("home-b", "request-a", snapshot).state, "unknown")
})
test("a missing legacy identity is unknown, never inferred from the latest history", () => {
  assert.equal(inspect("home-a", undefined, snapshot).state, "unknown")
})
test("a terminal snapshot without authoritative receipt evidence remains unknown", () => {
  const failed = { ...snapshot, inputAccepted: false, phase: "failed" }
  assert.equal(inspect("home-a", "request-a", failed).state, "unknown")
  assert.equal(inspect("home-a", "request-b", failed).state, "unknown")
  assert.equal(
    inspect("home-a", "request-a", { ...failed, phase: "running" }).state,
    "unknown"
  )
})
test("handled resolves only the matching original request without inventing user acceptance", () => {
  const handled = { ...snapshot, inputAccepted: false, inputDisposition: "handled" }
  assert.equal(inspect("home-a", "request-a", handled).state, "handled")
  assert.equal(inspect("home-a", "request-b", handled).state, "unknown")
  assert.equal(inspect("home-b", "request-a", handled).state, "unknown")
})
test("accepted queue IDs remain proof even when the latest turn is a different request", () => {
  assert.equal(
    inspect("home-a", "request-original", {
      ...snapshot,
      queue: { acceptedRequestIds: ["request-original"] },
    }).state,
    "accepted"
  )
})

test("late check A cannot claim a replacement B in the same session", () => {
  const a = { sessionId: "home-a", clientRequestId: "a" }
  const b = { sessionId: "home-a", clientRequestId: "b" }
  assert.equal(sameAttempt(b, a), false)
  assert.equal(sameAttempt({ ...a }, a), true)
  assert.equal(sameAttempt(undefined, a), false)
  const legacy = { sessionId: "home-a" }
  assert.equal(sameAttempt(legacy, legacy), true)
  assert.equal(sameAttempt({ ...legacy }, legacy), false)
})
test("automatic unknown observation stops after three reads and never resends", async () => {
  let reads = 0
  const controller = new AbortController()
  await assert.rejects(
    observe(
      async () => {
        reads++
        throw new Error("unknown")
      },
      () => true,
      controller.signal,
      async () => {}
    )
  )
  assert.equal(reads, 3)
})
test("definitive resolution and loss of attempt ownership stop the readonly loop", async () => {
  let reads = 0,
    owned = true
  await observe(
    async () => {
      reads++
      owned = false
      throw new Error("rejected")
    },
    () => owned,
    new AbortController().signal,
    async () => {}
  )
  assert.equal(reads, 1)
  reads = 0
  await observe(
    async () => {
      reads++
    },
    () => true,
    new AbortController().signal,
    async () => {}
  )
  assert.equal(reads, 1)
})
test("cancelled automatic observation cannot start a history read", async () => {
  const controller = new AbortController()
  controller.abort()
  let reads = 0
  await assert.rejects(
    observe(
      async () => {
        reads++
      },
      () => true,
      controller.signal
    )
  )
  assert.equal(reads, 0)
})

test("Home resolves an unaccepted preparation before any conversation row exists", async () => {
  const issue = { code: "request_not_accepted", summary: "原请求尚未接受。", recovery: "none", severity: "warning" }
  let lookups = 0, reads = 0, sends = 0
  const service = {
    receipt: async (sessionId, clientRequestId) => { lookups++; return { sessionId, clientRequestId, state: "rejected", issue } },
    read: async () => { reads++; throw new Error("row does not exist") },
    send: async () => { sends++; throw new Error("must not resend") },
  }
  const result = await readReceipt(service, "home-a", "request-a")
  assert.equal(result.state, "rejected")
  assert.deepEqual(result.issue, issue)
  assert.equal(result.snapshot, undefined)
  assert.equal(lookups, 1)
  assert.equal(reads, 0)
  assert.equal(sends, 0)
})

test("Home can confirm an earlier accepted request while showing a newer official snapshot", async () => {
  const later = { ...snapshot, clientRequestId: "later-request" }
  let reads = 0
  const result = await readReceipt({
    receipt: async () => ({ sessionId: "home-a", clientRequestId: "request-a", state: "accepted" }),
    read: async () => { reads++; return later },
  }, "home-a", "request-a")
  assert.equal(result.state, "accepted")
  assert.deepEqual(result.snapshot, later)
  assert.equal(result.clientRequestId, "request-a")
  assert.equal(reads, 1)
})
test("Home consumes a durable handled receipt by reading its conversation without resending", async () => {
  let reads = 0, sends = 0
  const handled = { ...snapshot, inputAccepted: false, inputDisposition: "handled" }
  const result = await readReceipt({
    receipt: async () => ({ sessionId: "home-a", clientRequestId: "request-a", state: "handled" }),
    read: async () => { reads++; return handled },
    send: async () => { sends++; throw new Error("must not resend") },
  }, "home-a", "request-a")
  assert.equal(result.state, "handled")
  assert.equal(result.snapshot.inputAccepted, false)
  assert.equal(result.snapshot.inputDisposition, "handled")
  assert.equal(reads, 1)
  assert.equal(sends, 0)
})
test("a started unknown ledger is not overridden by a failed snapshot containing older history", async () => {
  let reads = 0
  const result = await readReceipt({
    receipt: async () => ({ sessionId: "home-a", clientRequestId: "request-a", state: "unknown" }),
    read: async () => { reads++; return { ...snapshot, inputAccepted: false, phase: "failed", messages: [{ role: "user", text: "earlier" }] } },
  }, "home-a", "request-a")
  assert.equal(result.state, "unknown")
  assert.equal(reads, 0)
})

test("a lookup for another request cannot resolve Home's immutable attempt", async () => {
  let reads = 0
  const result = await readReceipt({
    receipt: async () => ({ sessionId: "home-a", clientRequestId: "another", state: "rejected" }),
    read: async () => { reads++; return snapshot },
  }, "home-a", "request-a")
  assert.equal(result.state, "unknown")
  assert.equal(reads, 0)
})
