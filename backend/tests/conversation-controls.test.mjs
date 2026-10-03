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
  let calls = 0
  const state = {
    record: {
      id: "session-test",
      modelId: "connection/model",
      thinking: "off",
    },
    entry: { busy: false },
    phase: "completed",
    controls: [],
    controlsLoaded: true,
    manager: { getBranch: () => entries, getLeafId: () => entries.at(-1).id },
    session: {
      isIdle: true,
      compact: () => {
        calls++
        return new Promise((resolve) => {
          done = resolve
        })
      },
      abortCompaction: () => done(),
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
      exclusive(id, action) {
        const result = gate.then(action)
        gate = result.catch(() => {})
        return result
      },
    },
  }
  const service = new ConversationControls(host, directory)
  return { service, state, entries, calls: () => calls, finish: () => done() }
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
