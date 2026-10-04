import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import filesystem from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve, basename, sep } from "node:path"
import { createHash } from "node:crypto"
import { ConversationQueue } from "../conversation-queue.mjs"
import { SessionService } from "../sessions.mjs"
import { ModelService } from "../models.mjs"
import { operations, assertSchema } from "../contract.mjs"

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-queue-operation-"))
  const sessions = new SessionService(directory, {})
  let restores = 0
  let starts = 0
  const state = {
    record: { id: "session-test", workspaceId: "workspace-test", modelId: "connection/model", thinking: "off" },
    manager: { getBranch: () => [] }, entry: { busy: false }, phase: "completed", controlBusy: false,
  }
  const host = {
    epoch: "original-host", sessions, closed: false, touch() {}, ensureOpen() {},
    store: { get: async (id) => id === state.record.id ? state.record : null },
    restore: async () => { restores++; return state },
    active: new Map([[state.record.id, state]]),
    snapshot: () => ({ queue: queue.snapshot(state), inputAccepted: false, phase: state.phase }),
    start: async () => { starts++; return { inputAccepted: false } },
  }
  const queue = new ConversationQueue(directory, host)
  await queue.load(state)
  await queue.commit(state, (document) => {
    document.paused = true
    for (const id of ["first-item", "second-item"]) document.items.push({ id, clientRequestId: `input-${id}`, text: "原始输入", fingerprint: "original-input", materials: [], status: "pending", delivery: "followUp", error: "", createdAt: new Date().toISOString() })
  })
  t.after(async () => {
    await queue.close()
    await sessions.close()
    assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + sep), true)
    assert.equal(basename(directory).startsWith("moon-queue-operation-"), true)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return { queue, state, host, directory, file: join(queue.directory, "session-test.json"), restores: () => restores, starts: () => starts, receipt: (id) => queue.readReceipt(state.record.id, id) }
}

test("missing original ID may be explicitly restored; delayed original and recovery adopt only once and committed deliver never resumes again", async (t) => {
  const f = await fixture(t)
  const baseRevision = f.state.queue.revision
  const before = await readFile(f.file)
  assert.deepEqual(await f.receipt("original-deliver"), { sessionId: "session-test", operationRequestId: "original-deliver", state: "unknown", retryOriginalAllowed: true })
  assert.deepEqual(await readFile(f.file), before)
  assert.equal(f.restores(), 0)
  assert.equal(f.starts(), 0)
  await Promise.all([
    f.queue.deliver("session-test", "first-item", baseRevision, undefined, "original-deliver"),
    f.queue.deliver("session-test", "first-item", baseRevision, undefined, "original-deliver"),
  ])
  assert.equal(f.state.queue.revision, baseRevision + 1)
  assert.equal(f.starts(), 1)
  const adopted = await f.receipt("original-deliver")
  assert.deepEqual(adopted, { sessionId: "session-test", operationRequestId: "original-deliver", operation: "conversationQueueDeliver", baseRevision, revision: baseRevision + 1, itemId: "first-item", state: "committed" })
  assert.equal(f.queue.snapshot(f.state).items[0].status, "pending")
  assert.equal(f.host.snapshot().inputAccepted, false)
  await f.queue.deliver("session-test", "first-item", baseRevision, undefined, "original-deliver")
  assert.equal(f.starts(), 1)
  assert.equal(f.state.queue.revision, baseRevision + 1)
  await assert.rejects(f.queue.deliver("session-test", "second-item", baseRevision, undefined, "original-deliver"), (error) => error.issue.code === "queue_operation_identity_conflict")
  assert.equal(f.starts(), 1)
})

test("mode/removal receipts preserve original CAS and later state; same-ID conflicts cannot mutate a different target", async (t) => {
  const f = await fixture(t)
  const baseRevision = f.state.queue.revision
  await f.queue.mode("session-test", "all", baseRevision, undefined, "original-mode")
  assert.deepEqual(await f.receipt("original-mode"), { sessionId: "session-test", operationRequestId: "original-mode", operation: "conversationQueueMode", baseRevision, revision: baseRevision + 1, mode: "all", state: "committed" })
  await f.queue.mode("session-test", "single", baseRevision + 1, undefined, "later-mode")
  const before = await readFile(f.file)
  await f.queue.mode("session-test", "all", baseRevision, undefined, "original-mode")
  assert.equal(f.state.queue.mode, "single")
  assert.equal(f.state.queue.revision, baseRevision + 2)
  assert.deepEqual(await readFile(f.file), before)
  await assert.rejects(f.queue.remove("session-test", "first-item", baseRevision, undefined, "original-mode"), (error) => error.issue.code === "queue_operation_identity_conflict")
  const removeRevision = f.state.queue.revision
  await f.queue.remove("session-test", "first-item", removeRevision, undefined, "original-remove")
  await f.queue.remove("session-test", "first-item", removeRevision, undefined, "original-remove")
  assert.equal(f.state.queue.revision, removeRevision + 1)
  assert.equal(f.state.queue.items[0].status, "removed")
  assert.equal(f.state.queue.items[1].status, "pending")
  assert.equal((await f.receipt("original-remove")).itemId, "first-item")
  assert.equal((await f.receipt("original-remove")).baseRevision, removeRevision)
})

test("CAS rejection and cancellation before commit have durable rejected receipts without applying the requested mutation", async (t) => {
  const f = await fixture(t)
  const baseRevision = f.state.queue.revision
  await assert.rejects(f.queue.mode("session-test", "all", 99, undefined, "stale-mode"), /队列已变化/)
  assert.equal((await f.receipt("stale-mode")).state, "rejected")
  assert.equal((await f.receipt("stale-mode")).baseRevision, 99)
  assert.equal(f.state.queue.revision, baseRevision)
  const cancellation = new AbortController()
  const write = f.queue.write.bind(f.queue)
  let attempts = 0
  f.queue.write = (...args) => { if (++attempts === 2) cancellation.abort(); return write(...args) }
  await assert.rejects(f.queue.remove("session-test", "first-item", baseRevision, cancellation.signal, "cancelled-remove"), { name: "AbortError" })
  f.queue.write = write
  const cancelled = await f.receipt("cancelled-remove")
  assert.equal(cancelled.state, "rejected")
  assert.equal(cancelled.operation, "conversationQueueRemove")
  assert.equal(cancelled.itemId, "first-item")
  assert.equal(cancelled.baseRevision, baseRevision)
  assert.equal(cancelled.issue.code, "cancelled")
  assert.equal(f.state.queue.items[0].status, "pending")
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).items[0].status, "pending")
  await assert.rejects(f.queue.remove("session-test", "first-item", baseRevision, undefined, "cancelled-remove"), (error) => error.issue.code === "cancelled")
})

test("failed atomic rename rejects the original operation while a lost post-commit response remains committed and classified unknown", async (t) => {
  const f = await fixture(t)
  const rename = filesystem.rename
  let renames = 0
  const mocked = t.mock.method(filesystem, "rename", async (...args) => {
    if (args[1] === f.file && ++renames === 2) throw Object.assign(new Error("PRIVATE_STORAGE_BODY"), { code: "ENOSPC", syscall: "rename" })
    return rename(...args)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(f.queue.mode("session-test", "all", f.state.queue.revision, undefined, "failed-rename"), /PRIVATE_STORAGE_BODY/)
  } finally { mocked.mock.restore(); syncBuiltinESMExports() }
  assert.equal((await f.receipt("failed-rename")).state, "rejected")
  assert.equal(f.state.queue.mode, "single")
  assert.equal(JSON.stringify(await f.receipt("failed-rename")).includes("PRIVATE_STORAGE_BODY"), false)
  const snapshot = f.host.snapshot
  f.host.snapshot = () => { throw new Error("POST_COMMIT_RESPONSE_FAILED") }
  await assert.rejects(f.queue.mode("session-test", "all", f.state.queue.revision, undefined, "committed-lost-response"), (error) => error.issue.code === "result_unknown" && error.issue.recovery === "check")
  assert.equal((await f.receipt("committed-lost-response")).state, "committed")
  await assert.rejects(f.queue.mode("session-test", "all", (await f.receipt("committed-lost-response")).baseRevision, undefined, "committed-lost-response"), (error) => error.issue.code === "result_unknown")
  f.host.snapshot = snapshot
  assert.equal(f.state.queue.mode, "all")
  const restore = f.host.restore
  f.host.restore = () => { throw new Error("CONVERSATION_RESTORE_FAILED") }
  await assert.rejects(f.queue.mode("session-test", "all", (await f.receipt("committed-lost-response")).baseRevision, undefined, "committed-lost-response"), (error) => error.issue.code === "result_unknown")
  f.host.restore = restore
  assert.equal((await f.receipt("committed-lost-response")).state, "committed")
})

test("current preparation disallows restoration, cold preparation proves rejection, and queries preserve bytes and never activate Pi", async (t) => {
  const f = await fixture(t)
  const id = "preparing-operation"
  const baseRevision = f.state.queue.revision
  f.state.queue.operationReceipts = { [id]: {
    sessionId: "session-test", operationRequestId: id, operation: "conversationQueueMode", baseRevision, mode: "all",
    ownerEpoch: f.queue.ownerEpoch, status: "preparing", updatedAt: new Date().toISOString(),
    fingerprint: createHash("sha256").update(JSON.stringify(["conversationQueueMode", "session-test", baseRevision, null, "all"])).digest("hex"),
  } }
  await f.queue.save(f.state)
  const before = await readFile(f.file)
  const current = await f.receipt(id)
  assert.equal(current.state, "unknown")
  assert.equal(current.retryOriginalAllowed, undefined)
  await assert.rejects(f.queue.mode("session-test", "all", baseRevision, undefined, id), (error) => error.issue.code === "result_unknown")
  const cold = new ConversationQueue(f.directory, { ...f.host, epoch: "new-host", restore: () => { throw new Error("Must not restore") }, start: () => { throw new Error("Must not start") } })
  const restored = await cold.readReceipt("session-test", id)
  assert.equal(restored.state, "rejected")
  assert.equal(restored.operation, "conversationQueueMode")
  assert.equal(restored.mode, "all")
  assert.equal(restored.baseRevision, baseRevision)
  assert.equal(restored.retryOriginalAllowed, undefined)
  assert.deepEqual(await readFile(f.file), before)
  assert.equal(f.starts(), 0)
})

test("legacy documents remain readable, damaged ledgers remain untouched, and the registered read RPC requires no Pi session", async (t) => {
  const f = await fixture(t)
  assert.equal((await f.queue.document("session-test")).operationReceipts, undefined)
  const damaged = JSON.stringify({ ...f.state.queue, operationReceipts: { bad: { status: "committed" } } })
  await writeFile(f.file, damaged)
  await assert.rejects(f.receipt("bad"), /回执记录损坏/)
  assert.equal(await readFile(f.file, "utf8"), damaged)
  const service = new ModelService(join(f.directory, "formal-service"))
  await service.initialize()
  try {
    service.conversations.restore = () => { throw new Error("Read must not restore") }
    service.sessions.create = () => { throw new Error("Read must not create session") }
    const result = await service.dispatch("conversationQueueReceiptRead", { sessionId: "not-created", operationRequestId: "not-received" })
    assert.deepEqual(result, { sessionId: "not-created", operationRequestId: "not-received", state: "unknown", retryOriginalAllowed: true })
    assertSchema(operations.conversationQueueReceiptRead.response, result)
    for (const name of ["conversationQueueRemove", "conversationQueueMode", "conversationQueueDeliver"]) {
      assert.equal(operations[name].queueReceipt, true)
      assert.ok(operations[name].args.includes("operationRequestId"))
      assert.equal(operations[name].request.required.includes("operationRequestId"), false)
    }
  } finally { await service.close() }
})
