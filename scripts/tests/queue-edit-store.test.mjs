import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import { randomUUID } from "node:crypto"

// Exercise the actual dependency-free store in memory, with no Vite cache or
// generated test files. A new module gives each test a genuine cold owner.
const source = stripTypeScriptTypes(
  await readFile(
    new URL(
      "../../src/features/conversation/queue-edit-store.ts",
      import.meta.url
    ),
    "utf8"
  )
)
const loadStore = () =>
  import(`data:text/javascript,${encodeURIComponent(source)}#${randomUUID()}`)
function storageFixture(t) {
  const records = new Map()
  let denied
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return records.size
      },
      key: (index) => [...records.keys()][index] ?? null,
      getItem: (key) => records.get(key) ?? null,
      setItem: (key, value) => {
        if (denied === "write") throw new Error("write denied")
        records.set(key, value)
      },
      removeItem: (key) => {
        if (denied === "remove") throw new Error("remove denied")
        records.delete(key)
      },
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
    records.clear()
  })
  return {
    records,
    deny: (operation) => {
      denied = operation
    },
  }
}
function record(sessionId = "session-a") {
  const draft = {
    workspaceId: "workspace-a",
    text: "修改后的消息",
    model: "connection/model",
    thinking: "中等",
    materials: [
      {
        id: "material-a",
        name: "验收.md",
        kind: "文件引用",
        type: "file",
        status: "ready",
        source: "H:/workspace/验收.md",
      },
    ],
    session: { toolIds: ["read"], instructionScope: "directory" },
  }
  return {
    sessionId,
    id: "item-a",
    revision: 12,
    draft,
    originalDraft: { ...structuredClone(draft), text: "原消息" },
    originalStatus: "pending",
    submitted: {
      token: "edit-client-a",
      revision: 12,
      draft: structuredClone(draft),
    },
  }
}
test("edit receipt requires original CAS and exact client identity in every delivery state", async () => {
  const store = await loadStore()
  const submitted = record().submitted
  for (const status of [
    "pending",
    "dispatching",
    "failed",
    "delivered",
    "removed",
  ])
    assert.equal(
      store.matchesQueueEditReceipt(submitted, {
        status,
        editBaseRevision: 12,
        editRequestId: "edit-client-a",
      }),
      true
    )
  assert.equal(
    store.matchesQueueEditReceipt(submitted, {
      editBaseRevision: 12,
      editRequestId: "edit-other-client",
    }),
    false
  )
  assert.equal(
    store.matchesQueueEditReceipt(submitted, {
      editBaseRevision: 13,
      editRequestId: "edit-client-a",
    }),
    false
  )
  assert.equal(
    store.matchesQueueEditReceipt(submitted, {
      editBaseRevision: 12,
    }),
    false
  )
  assert.equal(store.matchesQueueEditReceipt(submitted, undefined), false)
})
test("one stable external owner exposes full frozen edit and only notifies its subscribers", async (t) => {
  storageFixture(t)
  const store = await loadStore()
  let ownerNotifications = 0
  let otherNotifications = 0
  const unsubscribe = store.subscribeQueueEdits("session-a", () => {
    ownerNotifications++
  })
  const unsubscribeOther = store.subscribeQueueEdits("session-b", () => {
    otherNotifications++
  })
  t.after(unsubscribe)
  t.after(unsubscribeOther)
  const empty = store.getQueueEditOwnerSnapshot("session-a")
  assert.equal(empty, store.getQueueEditOwnerSnapshot("session-a"))
  store.saveQueueEdit(record())
  const saved = store.getQueueEditOwnerSnapshot("session-a")
  assert.notEqual(empty, saved)
  assert.equal(saved, store.getQueueEditOwnerSnapshot("session-a"))
  assert.deepEqual(saved.record.draft.materials, record().draft.materials)
  assert.deepEqual(saved.record.submitted, record().submitted)
  assert.equal(ownerNotifications, 1)
  assert.equal(otherNotifications, 0)
  store.clearQueueEdit("session-a", "item-a")
  assert.equal(store.getQueueEditOwnerSnapshot("session-a").record, undefined)
  assert.equal(ownerNotifications, 2)
})
test("write and remove failure retain the source and publish nearby storage feedback", async (t) => {
  const storage = storageFixture(t)
  const store = await loadStore()
  storage.deny("write")
  assert.throws(() => store.saveQueueEdit(record()), /write denied/)
  store.setQueueEditStorageIssue("session-a", {
    message: "草稿保存失败",
    recovery: "retry",
  })
  const failedWrite = store.getQueueEditOwnerSnapshot("session-a")
  assert.deepEqual(failedWrite.record.submitted, record().submitted)
  assert.equal(failedWrite.storageIssue.message, "草稿保存失败")
  assert.equal(storage.records.size, 0)
  storage.deny(undefined)
  store.saveQueueEdit(failedWrite.record)
  store.setQueueEditStorageIssue("session-a")
  storage.deny("remove")
  const beforeRemove = store.getQueueEditOwnerSnapshot("session-a")
  assert.throws(
    () => store.clearQueueEdit("session-a", "item-a"),
    /remove denied/
  )
  assert.equal(store.getQueueEditOwnerSnapshot("session-a"), beforeRemove)
  assert.equal(storage.records.size, 1)
  storage.deny(undefined)
  store.clearQueueEdit("session-a", "item-a")
  assert.equal(store.getQueueEditOwnerSnapshot("session-a").record, undefined)
  assert.equal(storage.records.size, 0)
})
test("a cold restore preserves materials, original revision and unknown submission identity", async (t) => {
  storageFixture(t)
  const first = await loadStore()
  first.saveQueueEdit(record())
  const restarted = await loadStore()
  restarted.restoreQueueEdits("session-a")
  const restored = restarted.getQueueEditOwnerSnapshot("session-a").record
  assert.deepEqual(restored, record())
  assert.equal(
    restarted.matchesQueueEditReceipt(restored.submitted, {
      editBaseRevision: 12,
      editRequestId: "edit-client-a",
      status: "failed",
    }),
    true
  )
})
