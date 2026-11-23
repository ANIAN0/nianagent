import { strict as assert } from "node:assert"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { ConversationCatalogService } from "./conversation-catalog.mjs"
import { ConversationPermissions } from "./conversation-permissions.mjs"
import { ConversationStore } from "./conversation-store.mjs"

function fixture(t) {
  const record = {
    id: "pending-test",
    status: "running",
    runId: "run",
    revision: 3,
  }
  const state = { record }
  const permissions = new ConversationPermissions(".", { touch() {} })
  const store = {
    list: async () => [record],
    get: async (id) => (id === record.id ? record : null),
  }
  const catalog = new ConversationCatalogService(store, () =>
    permissions.pendingBySession()
  )
  t.after(() => permissions.cancel(state))
  return { record, state, permissions, catalog, store }
}

test("目录独立显示工具审批和插件问答，并在应答与停止后清除", async (t) => {
  const { record, state, permissions, catalog } = fixture(t)
  const tool = permissions.ask(state, { kind: "tool", title: "工具" })
  const answer = permissions.ui(state, "example").select("选择", ["甲"])
  const [approval] = permissions.pendingFor(record.id)
  const [summary] = await catalog.list()
  assert.deepEqual(summary.pending, { approvals: 1, answers: 1 })
  assert.equal(summary.status, "running")
  assert.equal(summary.revision, 3)

  permissions.reply(record.id, approval.id, record.runId, "deny")
  assert.equal(await tool, "deny")
  assert.deepEqual((await catalog.info(record.id)).pending, {
    approvals: 0,
    answers: 1,
  })

  record.status = "stopping"
  assert.deepEqual((await catalog.info(record.id)).pending, {
    approvals: 0,
    answers: 0,
  })
  permissions.cancel(state)
  assert.equal(await answer, undefined)
})

test("过期、失效运行和重启不会留下可处理的目录提示", async (t) => {
  const { record, state, permissions, catalog, store } = fixture(t)
  const expired = permissions.ask(state, { kind: "tool" }, { timeout: 10 })
  const [old] = permissions.pendingFor(record.id)
  assert.equal(await expired, "cancel")
  assert.deepEqual((await catalog.info(record.id)).pending, {
    approvals: 0,
    answers: 0,
  })
  assert.throws(
    () => permissions.reply(record.id, old.id, record.runId, "allow"),
    /过期/
  )

  const previousRun = permissions.ask(state, { kind: "tool" })
  const [stale] = permissions.pendingFor(record.id)
  const afterRestart = new ConversationCatalogService(store, () => new Map())
  assert.deepEqual((await afterRestart.info(record.id)).pending, {
    approvals: 0,
    answers: 0,
  })
  record.runId = "next-run"
  assert.deepEqual((await catalog.info(record.id)).pending, {
    approvals: 0,
    answers: 0,
  })
  assert.throws(
    () => permissions.reply(record.id, stale.id, stale.runId, "allow"),
    /当前运行/
  )
  permissions.cancel(state)
  assert.equal(await previousRun, "cancel")
})

test("归档与启动提交互斥，旧运行确认无法改变新运行归档状态", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-archive-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ConversationStore(directory)
  const id = "archive-test"
  await store.create({
    id,
    workspaceId: "workspace",
    cwd: directory,
    title: "归档",
  })
  await store.update(id, { status: "running", runId: "run-one" })
  await store.update(id, { status: "stopping" })
  await assert.rejects(
    store.setArchived(id, true, undefined, { expectedRunId: "run-one" }),
    /尚未停止/
  )
  await store.update(id, { status: "idle" })
  await store.update(id, { status: "running", runId: "run-two" })
  await store.update(id, { status: "idle" })
  await assert.rejects(
    store.setArchived(id, true, undefined, { expectedRunId: "run-one" }),
    /其他运行/
  )
  const archived = await store.setArchived(id, true, undefined, {
    expectedRunId: "run-two",
  })
  assert.equal(archived.archived, true)
  await assert.rejects(
    store.update(id, { status: "running", runId: "run-three" }),
    /已归档/
  )
  assert.equal((await store.get(id)).runId, "run-two")
  assert.equal((await store.setArchived(id, false)).archived, false)
})
