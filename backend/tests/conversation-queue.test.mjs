import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import filesystem from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConversationQueue } from "../conversation-queue.mjs"

test("a failed mode transaction cannot leak through a concurrent durable Pi receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-queue-transaction-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const queue = new ConversationQueue(directory, { touch() {} })
  const item = {
    id: "queue-item",
    clientRequestId: "submitted-input",
    fingerprint: "signature",
    text: "保留要求",
    materials: [],
    status: "dispatching",
    delivery: "followUp",
    error: "",
    createdAt: new Date().toISOString(),
  }
  const state = {
    record: { id: "session-test" },
    manager: { getBranch: () => [] },
  }
  await queue.load(state)
  await queue.commit(state, (document) => document.items.push(item))
  const value = { item }
  state.queuePrepared.set(item.id, value)
  const rename = filesystem.rename
  let failed = false
  const mocked = t.mock.method(filesystem, "rename", async (...args) => {
    if (!failed && args[1] === join(queue.directory, "session-test.json")) {
      failed = true
      // The real user history has succeeded while the configuration write is pending.
      queue.afterInput(state, value)
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" })
    }
    return rename(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  await assert.rejects(
    queue.commit(state, (document) => {
      document.mode = "all"
    }),
    /ENOSPC/
  )
  await queue.close()
  const saved = JSON.parse(
    await readFile(join(queue.directory, "session-test.json"), "utf8")
  )
  assert.equal(state.queue.mode, "single")
  assert.equal(saved.mode, "single")
  assert.equal(saved.items[0].status, "delivered")
  assert.equal(state.queue.items[0].status, "delivered")
  assert.equal(state.queue.paused, true)
})

async function durableFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-queue-feedback-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const host = {
    touch() {},
    closed: false,
    start: async () => ({ inputAccepted: false }),
  }
  const queue = new ConversationQueue(directory, host)
  const state = {
    record: {
      id: "session-test",
      workspaceId: "workspace-test",
      modelId: "connection/model",
      thinking: "off",
    },
    manager: { getBranch: () => [] },
    entry: { busy: false },
  }
  await queue.load(state)
  await queue.commit(state, (document) => {
    document.items.push({
      id: "queue-item",
      clientRequestId: "pending-input",
      fingerprint: "signature",
      text: "保留要求",
      materials: [],
      status: "pending",
      delivery: "followUp",
      error: "",
      createdAt: new Date().toISOString(),
    })
  })
  return {
    queue,
    state,
    host,
    file: join(queue.directory, "session-test.json"),
  }
}

test("committed queue edits never clean the temporary path consumed by rename or roll back memory", async (t) => {
  const { queue, state, file } = await durableFixture(t)
  const originalRemove = filesystem.rm
  let cleanupAttempts = 0
  const mocked = t.mock.method(filesystem, "rm", async (...args) => {
    if (String(args[0]).startsWith(join(queue.directory, ".session-test-"))) {
      cleanupAttempts++
      throw Object.assign(new Error("EPERM cleanup"), { code: "EPERM" })
    }
    return originalRemove(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  await queue.commit(state, (document) => {
    document.mode = "all"
    document.items[0].text = "已经提交的新要求"
  })
  const saved = JSON.parse(await readFile(file, "utf8"))
  assert.equal(cleanupAttempts, 0)
  assert.equal(state.queue.mode, "all")
  assert.equal(saved.mode, state.queue.mode)
  assert.equal(saved.items[0].text, "已经提交的新要求")
  assert.equal(saved.revision, state.queue.revision)
  assert.equal(state.queueError, undefined)
})

test("a successful durable retry clears only the queue storage failure", async (t) => {
  const { queue, state, file } = await durableFixture(t)
  const originalRename = filesystem.rename
  const mocked = t.mock.method(filesystem, "rename", async (...args) => {
    if (args[1] === file)
      throw Object.assign(new Error("ENOSPC write"), { code: "ENOSPC" })
    return originalRename(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  await assert.rejects(
    queue.commit(state, (document) => {
      document.mode = "all"
    }),
    /ENOSPC/
  )
  assert.equal(state.queueIssue.code, "queue_storage")
  assert.equal(state.queue.paused, true)
  assert.equal(state.queue.mode, "single")
  mocked.mock.restore()
  syncBuiltinESMExports()
  await queue.commit(state, (document) => {
    document.mode = "all"
  })
  assert.equal(JSON.parse(await readFile(file, "utf8")).mode, "all")
  assert.equal(state.queueError, undefined)
  assert.equal(state.queueIssue, undefined)

  queue.failure(
    state,
    new Error("模型仍不可用"),
    "queue_resume_failed",
    "队列尚未启动"
  )
  await queue.commit(state, (document) => {
    document.mode = "single"
  })
  assert.equal(state.queueIssue.code, "queue_resume_failed")
  assert.equal(state.queueError, "队列尚未启动")
})

test("queue reconciliation keeps a storage failure until the repaired state is actually persisted", async (t) => {
  const { queue, state, file } = await durableFixture(t)
  const originalRename = filesystem.rename
  const mocked = t.mock.method(filesystem, "rename", async (...args) => {
    if (args[1] === file)
      throw Object.assign(new Error("EPERM write"), { code: "EPERM" })
    return originalRename(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  await assert.rejects(
    queue.commit(state, (document) => {
      document.items[0].text = "失败的编辑"
    }),
    /EPERM/
  )
  await assert.rejects(queue.reconcile(state), /EPERM/)
  assert.equal(state.queueIssue.code, "queue_storage")
  assert.equal(state.queue.items[0].text, "保留要求")
  mocked.mock.restore()
  syncBuiltinESMExports()
  await queue.reconcile(state)
  const saved = JSON.parse(await readFile(file, "utf8"))
  assert.equal(saved.items[0].text, "保留要求")
  assert.equal(saved.revision, state.queue.revision)
  assert.equal(state.queueError, undefined)
  assert.equal(state.queueIssue, undefined)
})

test("saving queue options cannot clear a start failure until a Pi input receipt is accepted", async (t) => {
  const { queue, state, host } = await durableFixture(t)
  queue.failure(
    state,
    new Error("连接暂不可用"),
    "queue_resume_failed",
    "队列尚未启动"
  )
  await queue.resume(state)
  assert.equal(state.queueIssue.code, "queue_resume_failed")
  host.start = async () => ({ inputAccepted: true })
  await queue.resume(state)
  assert.equal(state.queueError, undefined)
  assert.equal(state.queueIssue, undefined)
})

test("a cancelled queue commit preserves the prior pause state and does not create an error", async (t) => {
  const { queue, state, file } = await durableFixture(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    queue.commit(
      state,
      (document) => {
        document.mode = "all"
      },
      controller.signal
    ),
    { name: "AbortError" }
  )
  assert.equal(state.queue.mode, "single")
  assert.equal(state.queue.paused, false)
  assert.equal(state.queueError, undefined)
  assert.equal(state.queueIssue, undefined)
  assert.equal(JSON.parse(await readFile(file, "utf8")).mode, "single")
})

async function editableFixture(t, resolveMaterials) {
  const value = await durableFixture(t)
  Object.assign(value.host, {
    ensureOpen() {}, sessions: { exclusive: (_id, action) => action() },
    store: { get: async () => value.state.record },
    restore: async () => value.state,
    snapshot: (state) => structuredClone(state.queue),
    models: { materials: { resolveForPrompt: resolveMaterials } },
  })
  value.state.record.cwd = "fixture-cwd"
  value.state.session = { model: { id: "fixture-model" } }
  return value
}
test("queue edit replaces materials and text in the same durable original item", async (t) => {
  const { queue, state, file } = await editableFixture(t, async ({ materials }) => ({ displayMaterials: materials }))
  const before = structuredClone(state.queue.items[0])
  const baseRevision = state.queue.revision
  const material = { id: "file-id", name: "replacement.md", kind: "file", type: "file", status: "ready", source: "fixture-source" }
  await queue.edit("session-test", "queue-item", "new", state.queue.revision, [material], undefined, "edit-b")
  const saved = JSON.parse(await readFile(file, "utf8"))
  assert.equal(saved.items[0].id, before.id)
  assert.equal(saved.items[0].clientRequestId, before.clientRequestId)
  assert.equal(saved.items[0].fingerprint, before.fingerprint)
  assert.equal(saved.items[0].text, "new")
  assert.deepEqual(saved.items[0].materials, [material])
  assert.equal(saved.items[0].editBaseRevision, baseRevision)
  assert.equal(saved.items[0].editRequestId, "edit-b")
  await queue.commit(state, () => { state.queue.items[0].status = "failed" })
  const failed = queue.snapshot(state).items[0]
  assert.equal(failed.editRequestId, "edit-b")
  assert.equal(failed.editBaseRevision, baseRevision)
  await queue.commit(state, () => { state.queue.items[0].status = "delivered" })
  const retired = queue.snapshot(state).retiredItems[0]
  assert.equal(retired.editBaseRevision, baseRevision)
  assert.equal(retired.editRequestId, "edit-b")
  assert.notEqual(retired.editRequestId, "edit-a")
  assert.equal(retired.id, before.id)
  assert.equal(retired.status, "delivered")
  assert.equal("text" in retired, false)
  assert.equal("materials" in retired, false)
})
test("invalid edited materials cannot clear the original text, materials or revision", async (t) => {
  const { queue, state, file } = await editableFixture(t, async () => { throw new Error("expired material") })
  const before = structuredClone(state.queue)
  await assert.rejects(queue.edit("session-test", "queue-item", "new", state.queue.revision, []), /expired/)
  assert.deepEqual(state.queue, before)
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).items, before.items)
})
test("cancellation after material validation but before commit preserves the queue", async (t) => {
  const controller = new AbortController()
  const { queue, state } = await editableFixture(t, async ({ materials }) => { controller.abort(); return { displayMaterials: materials } })
  const before = structuredClone(state.queue)
  await assert.rejects(queue.edit("session-test", "queue-item", "new", state.queue.revision, [], controller.signal), { name: "AbortError" })
  assert.deepEqual(state.queue, before)
})

test("a Pi receipt advancing the queue while edited materials prepare cannot be overwritten", async (t) => {
  let state
  const value = await editableFixture(t, async ({ materials }) => {
    state.queue.revision++
    return { displayMaterials: materials }
  })
  state = value.state
  const before = structuredClone(state.queue.items[0])
  await assert.rejects(value.queue.edit("session-test", "queue-item", "new", state.queue.revision, []), /队列已变化/)
  assert.deepEqual(state.queue.items[0], before)
})
