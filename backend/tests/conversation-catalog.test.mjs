import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { ConversationStore } from "../conversation-store.mjs"
import { ConversationCatalogService } from "../conversation-catalog.mjs"

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-conversation-catalog-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ConversationStore(directory)
  await store.initialize()
  const catalog = new ConversationCatalogService(store)
  const record = {
    id: "session-1",
    workspaceId: "workspace-1",
    cwd: directory,
    title: "检查首页布局",
    modelId: "model-1",
    thinking: "medium",
  }
  return { directory, store, catalog, record }
}

test("conversation metadata persists, filters and exposes no internal Pi paths or request fingerprints", async (t) => {
  const { directory, store, catalog, record } = await fixture(t)
  assert.deepEqual(await catalog.list(), [])
  assert.equal(await catalog.info("missing"), null)
  const first = await store.create(record)
  assert.equal(first.revision, 1)
  await store.update(record.id, {
    sessionFile: join(directory, "real-session.jsonl"),
    lastRequestId: "req-1",
    lastRequestFingerprint: "a".repeat(64),
    lastMessage: "页面颜色已检查",
    status: "completed",
    unread: true,
  })
  const reloaded = new ConversationStore(directory)
  await reloaded.initialize()
  const results = await new ConversationCatalogService(reloaded).list({
    workspaceId: record.workspaceId,
    query: "颜色",
  })
  assert.equal(results.length, 1)
  assert.equal(results[0].title, record.title)
  for (const field of [
    "sessionFile",
    "lastRequestId",
    "lastRequestFingerprint",
  ])
    assert.equal(Object.hasOwn(results[0], field), false)
  assert.equal((await catalog.list({ query: "首页" })).length, 1)
  assert.equal((await catalog.list({ workspaceId: "other" })).length, 0)
})

test("markRead is revision bounded and preserves terminal state, concurrent fields and ordering", async (t) => {
  const { store, record } = await fixture(t)
  await store.create(record)
  const old = await store.update(record.id, {
    status: "completed",
    unread: true,
  })
  const latest = await store.update(record.id, {
    status: "failed",
    unread: true,
    lastError: "调用失败",
  })
  const staleRead = await store.markRead(record.id, old.revision)
  assert.equal(staleRead.unread, true)
  assert.equal(staleRead.revision, latest.revision)
  const read = await store.markRead(record.id, latest.revision)
  assert.equal(read.unread, false)
  assert.equal(read.status, "failed")
  assert.equal(read.lastError, "调用失败")
  assert.equal(read.updatedAt, latest.updatedAt)
  assert.equal(
    (await store.markRead(record.id, latest.revision)).revision,
    read.revision
  )
  await Promise.all([
    store.update(record.id, { modelId: "next-model" }),
    store.update(record.id, { lastMessage: "下一轮" }),
  ])
  const merged = await store.get(record.id)
  assert.equal(merged.modelId, "next-model")
  assert.equal(merged.lastMessage, "下一轮")
})

test("cancelled write waiting for the metadata lock never commits", async (t) => {
  const { store, record } = await fixture(t)
  const original = await store.create(record)
  const unlock = await lockfile.lock(store.directory, { realpath: false })
  const controller = new AbortController()
  const pending = store.update(
    record.id,
    { title: "不应保存" },
    controller.signal
  )
  controller.abort()
  try {
    await assert.rejects(pending, { name: "AbortError" })
  } finally {
    await unlock()
  }
  assert.deepEqual(await store.get(record.id), original)
})

test("only explicit startup recovery marks interrupted runs; duplicate create is idempotent", async (t) => {
  const { directory, store, record } = await fixture(t)
  await store.create(record)
  await store.update(record.id, {
    status: "running",
    runId: "run-1",
    lastMessage: "保留历史",
  })
  const observer = new ConversationStore(directory)
  await observer.initialize()
  assert.equal((await observer.get(record.id)).status, "running")
  await observer.initialize({ recoverInterrupted: true })
  const recovered = await observer.get(record.id)
  assert.equal(recovered.status, "failed")
  assert.equal(recovered.unread, true)
  assert.match(recovered.lastError, /中断/)
  assert.equal(recovered.lastMessage, "保留历史")
  const repeated = await observer.create(record)
  assert.equal(repeated.revision, recovered.revision)
  await assert.rejects(
    observer.create({ ...record, workspaceId: "wrong-workspace" }),
    /其他工作区/
  )
})

test("corrupt metadata is reported without replacing the original file", async (t) => {
  const { store, record } = await fixture(t)
  await store.create(record)
  const corrupted = "{ damaged conversation data"
  await writeFile(store.file, corrupted)
  await assert.rejects(store.list(), /损坏/)
  await assert.rejects(store.create({ ...record, id: "new" }), /损坏/)
  assert.equal(await readFile(store.file, "utf8"), corrupted)
})
