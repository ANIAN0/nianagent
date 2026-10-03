import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConversationControls } from "../conversation-controls.mjs"

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-controls-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const entries = [
    { id: "entry-start", type: "message", message: { role: "user" } },
  ]
  let done
  let fail
  let calls = 0
  const state = {
    record: {
      id: "session-test",
      cwd: directory,
      modelId: "connection/model",
      thinking: "off",
    },
    entry: { busy: false },
    phase: "completed",
    controls: [],
    controlsLoaded: true,
    manager: {
      getBranch: () => entries,
      getEntries: () => entries,
      getLeafId: () => entries.at(-1).id,
    },
    session: {
      isIdle: true,
      compact: () => {
        calls++
        return new Promise((resolve, reject) => {
          done = resolve
          fail = reject
        })
      },
      abortCompaction: () => done(),
      dispose() {},
    },
  }
  let gate = Promise.resolve()
  const host = {
    ensureOpen() {},
    touch() {},
    persistence: new WeakMap(),
    selection: async () => ({}),
    store: { get: async () => state.record },
    restore: async () => state,
    active: new Map([[state.record.id, state]]),
    sessions: {
      active: new Map(),
      exclusive(id, action) {
        const result = gate.then(action)
        gate = result.catch(() => {})
        return result
      },
    },
  }
  const service = new ConversationControls(host, directory)
  return {
    service,
    state,
    entries,
    host,
    calls: () => calls,
    finish: () => done(),
    fail: (error) => fail(error),
  }
}
test("manual compact reserves the common gate and repeated identity never invokes Pi twice", async (t) => {
  const f = await fixture(t)
  await f.service.compactStart("session-test", "compact-one", "保留目标")
  assert.equal(f.state.entry.busy, true)
  await f.service.compactStart("session-test", "compact-one", "保留目标")
  assert.equal(f.calls(), 1)
  await assert.rejects(
    f.service.compactStart("session-test", "compact-two", ""),
    /正在处理/
  )
  f.entries.push({
    type: "compaction",
    id: "entry-summary",
    summary: "真实摘要",
    firstKeptEntryId: "entry-start",
    tokensBefore: 120,
    timestamp: new Date().toISOString(),
  })
  f.finish()
  await Promise.allSettled([...f.service.tasks.values()])
  assert.equal(
    (await f.service.read("session-test", "compact-one")).status,
    "completed"
  )
  assert.equal(f.state.entry.busy, false)
})
test("pending queue prevents Pi.compact aborting unrelated work", async (t) => {
  const f = await fixture(t)
  f.state.queue = {
    items: [{ status: "failed" }],
    paused: true,
    mode: "single",
  }
  await assert.rejects(
    f.service.compactStart("session-test", "compact-one", ""),
    /待发送/
  )
  assert.equal(f.calls(), 0)
})
test("missing receipt can be reconciled without repeating the operation", async (t) => {
  const f = await fixture(t)
  assert.equal(await f.service.read("session-test", "missing"), null)
  assert.equal(f.calls(), 0)
})
test("cancelled and failed compact receipts never claim a later successful summary", async (t) => {
  for (const result of ["cancelled", "failed"]) {
    await t.test(result, async (t) => {
      const f = await fixture(t)
      await f.service.compactStart("session-test", "compact-a", "")
      if (result === "cancelled")
        await f.service.compactCancel("session-test", "compact-a")
      else f.fail(new Error("provider unavailable"))
      await Promise.allSettled([...f.service.tasks.values()])
      const original = await f.service.read("session-test", "compact-a")
      assert.equal(original.status, result)
      await f.service.compactStart("session-test", "compact-b", "")
      f.entries.push({
        type: "compaction",
        id: "summary-b",
        summary: "B summary",
        firstKeptEntryId: "entry-start",
        tokensBefore: 120,
        timestamp: new Date().toISOString(),
      })
      f.finish()
      await Promise.allSettled([...f.service.tasks.values()])
      assert.equal(
        (await f.service.read("session-test", "compact-b")).compactionEntryId,
        "summary-b"
      )
      assert.deepEqual(
        await f.service.read("session-test", "compact-a"),
        original
      )
    })
  }
})
test("uncertain Pi append with an unreadable file never exposes an uncommitted summary", async (t) => {
  const f = await fixture(t)
  await f.service.compactStart("session-test", "compact-write-failed", "")
  const damaged = new Error("invalid partial JSONL")
  f.host.fileManager = async () => {
    throw damaged
  }
  f.host.persistence.set(f.state.manager, { error: new Error("append failed") })
  f.entries.push({
    type: "compaction",
    id: "not-saved",
    summary: "not persisted",
    firstKeptEntryId: "entry-start",
    tokensBefore: 120,
    timestamp: new Date().toISOString(),
  })
  f.fail(new Error("append failed"))
  await Promise.allSettled([...f.service.tasks.values()])
  assert.equal(f.state.historyError, damaged)
  assert.equal(f.state.entry.busy, false)
  assert.equal(
    f.state.manager.getBranch().some((entry) => entry.type === "compaction"),
    false
  )
  assert.equal(
    (await f.service.read("session-test", "compact-write-failed")).status,
    "failed"
  )
})
test("cancellation after the authoritative Pi commit retains successful completion", async (t) => {
  const f = await fixture(t)
  await f.service.compactStart("session-test", "compact-committed", "")
  f.entries.push({
    type: "compaction",
    id: "saved-before-cancel",
    summary: "saved summary",
    firstKeptEntryId: "entry-start",
    tokensBefore: 120,
    timestamp: new Date().toISOString(),
  })
  await f.service.compactCancel("session-test", "compact-committed")
  await Promise.allSettled([...f.service.tasks.values()])
  const result = await f.service.read("session-test", "compact-committed")
  assert.equal(result.status, "completed")
  assert.equal(result.compactionEntryId, "saved-before-cancel")
  assert.deepEqual(
    await f.service.compactCancel("session-test", "compact-committed"),
    result
  )
  assert.equal(f.calls(), 1)
})
test("identical operation IDs in different sessions retain their own cancel task", async (t) => {
  const f = await fixture(t)
  const other = await fixture(t)
  other.state.record.id = "other-session"
  const states = new Map([
    [f.state.record.id, f.state],
    [other.state.record.id, other.state],
  ])
  f.host.store.get = async (id) => states.get(id)?.record
  f.host.restore = async (record) => states.get(record.id)
  await f.service.compactStart("session-test", "shared-operation", "")
  await f.service.compactStart("other-session", "shared-operation", "")
  assert.equal(f.service.tasks.size, 2)
  await f.service.compactCancel("session-test", "shared-operation")
  // Wait for only the first operation; the other still owns its task.
  await f.service.tasks.get("session-test:shared-operation")
  await f.service.compactCancel("other-session", "shared-operation")
  await Promise.allSettled([...f.service.tasks.values()])
  assert.equal(f.state.controls[0].status, "cancelled")
  assert.equal(other.state.controls[0].status, "cancelled")
})
