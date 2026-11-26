import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkbenchStore } from "../../apps/workbench/src/server/notes/storage.mjs"
import { createV2Service } from "../../apps/workbench/src/server/notes/service.mjs"
import { validatePluginValue } from "../../backend/plugin-helpers.mjs"

async function setup(t, kind = "markdown") {
  const root = await mkdtemp(join(tmpdir(), "moon-discussion-"))
  const store = new WorkbenchStore(root)
  t.after(async () => {
    store.close()
    await rm(root, { recursive: true, force: true })
  })
  await store.open()
  const p = store.createProject("p", "A", "p")
  const d = store.createDirectory(p.id, null, "d", "A", "d")
  const draft = store.createDraft(d.id, kind, "draft", "A", "draft")
  const versions = []
  for (const n of [1, 2]) {
    const source = join(root, `source${n}`)
    await mkdir(source)
    if (kind === "markdown")
      await writeFile(join(source, "doc.md"), `# Title\n\n版本${n} 原文😀`)
    if (kind === "board")
      await writeFile(
        join(source, "board.canvas"),
        JSON.stringify({
          nodes: [
            {
              id: "group",
              type: "group",
              x: 0,
              y: 0,
              width: 500,
              height: 500,
              label: "组上下文",
            },
            {
              id: "n",
              type: "text",
              x: 10,
              y: 10,
              width: 100,
              height: 80,
              text: `版本${n}`,
            },
          ],
          edges: [{ id: "e", fromNode: "n", toNode: "n", label: "关系" }],
        })
      )
    if (kind === "ui") {
      await writeFile(
        join(source, "preview.json"),
        JSON.stringify({ routes: { "/": "index.html" } })
      )
      await writeFile(
        join(source, "index.html"),
        `<button id="target">版本${n}</button>`
      )
    }
    const staged = await store.stagePackage(source, kind, "A")
    versions.push(
      store.publishVersion(
        {
          draftId: draft.id,
          baseSequence: n - 1,
          artifactId: staged.artifactId,
          requestKey: `pub${n}`,
        },
        "A"
      ).versionId
    )
  }
  const service = createV2Service(store, { event: () => {} })
  const call = async (
    name,
    input,
    context = { source: "mcp", actorId: "B" }
  ) => {
    const operation = service.operations[`v2_${name}`]
    validatePluginValue(operation.input, input)
    return (
      await operation.execute(input, context, new AbortController().signal)
    ).value
  }
  return { store, call, draft, versions }
}

test("冻结画布跨类型同ID必须拒绝，不把连线意见误指节点", async (t) => {
  const { store, versions } = await setup(t, "board")
  const row = store.db
    .prepare("SELECT artifact_id FROM versions WHERE id = ?")
    .get(versions[0])
  const path = join(
    store.root,
    "artifacts",
    row.artifact_id,
    ".moon",
    "reading.json"
  )
  const reading = JSON.parse(await readFile(path, "utf8"))
  reading.canvas.edges[0].id = "n"
  await writeFile(path, JSON.stringify(reading))
  await assert.rejects(store.readVersionContent(versions[0]), {
    code: "storage_failure",
  })
})

test("作者筛选先于分页，包含回复作者并可与版本和状态组合", async (t) => {
  const { call, draft, versions } = await setup(t)
  let first
  for (let index = 0; index < 52; index++) {
    const created = await call("create_thread", {
      versionId: versions[0],
      target: { kind: "document" },
      body: `意见${index}`,
      requestKey: `filter-${index}`,
    })
    first ??= created.threadId
  }
  const later = await call(
    "create_thread",
    {
      versionId: versions[1],
      target: { kind: "document" },
      body: "末页作者",
      requestKey: "later",
    },
    { source: "mcp", actorId: "C" }
  )
  await call(
    "add_reply",
    { threadId: first, body: "仅回复作者", requestKey: "author-reply" },
    { source: "mcp", actorId: "A" }
  )
  const page = await call("list_threads", { draftId: draft.id })
  assert.equal(page.items.length, 50)
  assert.deepEqual(page.authorActors, ["A", "B", "C"])
  const byReply = await call("list_threads", {
    draftId: draft.id,
    authorActor: "A",
  })
  assert.deepEqual(
    byReply.items.map((item) => item.id),
    [first]
  )
  const byLater = await call("list_threads", {
    draftId: draft.id,
    authorActor: "C",
    versionId: versions[1],
    status: "open",
  })
  assert.deepEqual(
    byLater.items.map((item) => item.id),
    [later.threadId]
  )
  await call(
    "set_thread_status",
    {
      threadId: later.threadId,
      status: "resolved",
      requestKey: "resolve-later",
    },
    { source: "local" }
  )
  assert.equal(
    (
      await call("list_threads", {
        draftId: draft.id,
        authorActor: "C",
        status: "open",
      })
    ).items.length,
    0
  )
  assert.equal(
    (
      await call("list_threads", {
        draftId: draft.id,
        authorActor: "C",
        status: "resolved",
      })
    ).items[0].id,
    later.threadId
  )
  assert.equal(
    (
      await call("list_threads", {
        draftId: draft.id,
        authorActor: "C",
        versionId: versions[0],
      })
    ).items.length,
    0
  )
})

for (const kind of ["markdown", "board", "ui"]) {
  test(`${kind}定位意见固定V1，回复关联V2，权限和状态历史可读`, async (t) => {
    const { store, call, draft, versions } = await setup(t, kind)
    const target =
      kind === "markdown"
        ? { block: 1, exact: "原文😀" }
        : kind === "board"
          ? { kind: "board", objectId: "e", objectType: "edge" }
          : {
              kind: "ui",
              page: "/",
              tag: "button",
              id: "target",
              text: "版本1",
              viewport: { width: 900, height: 600 },
              attributes: { id: "target" },
            }
    const input = {
      versionId: versions[0],
      target,
      body: "请修改",
      requestKey: "comment",
    }
    const created = await call("create_thread", input)
    const original = store.readThread(created.threadId).thread
    assert.equal(original.versionId, versions[0])
    assert.equal(original.authorActor, "B")
    assert.equal(original.anchor.kind, kind)
    if (kind === "markdown") assert.equal(original.anchor.quote, "原文😀")
    if (kind === "board")
      assert.deepEqual(original.anchor.context, { from: "n", to: "n" })
    if (kind === "ui") assert.equal(original.anchor.attributes.id, "target")
    assert.equal((await call("create_thread", input)).replayed, true)
    await assert.rejects(
      () => call("create_thread", { ...input, body: "different" }),
      { code: "request_key_conflict" }
    )
    await call(
      "add_reply",
      {
        threadId: created.threadId,
        body: "已修改",
        relatedVersionId: versions[1],
        requestKey: "reply",
      },
      { source: "mcp", actorId: "A" }
    )
    const state = {
      threadId: created.threadId,
      status: "resolved",
      requestKey: "resolve",
    }
    await assert.rejects(
      () => call("set_thread_status", state, { source: "mcp", actorId: "A" }),
      { code: "identity_denied" }
    )
    await call("set_thread_status", state, { source: "local" })
    await call("set_thread_status", {
      ...state,
      status: "open",
      requestKey: "reopen",
    })
    const beforeReplay = store.reviewRevision(draft.id)
    assert.equal(
      (await call("set_thread_status", state, { source: "local" })).replayed,
      true
    )
    assert.equal(store.reviewRevision(draft.id), beforeReplay)
    store.close()
    await store.open()
    const read = await call("read_thread", { threadId: created.threadId })
    assert.equal(read.thread.status, "open")
    assert.deepEqual(read.thread.anchor, original.anchor)
    assert.equal(
      read.replies.items.find((x) => x.body === "已修改").relatedVersionId,
      versions[1]
    )
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS n FROM status_events WHERE thread_id=?")
        .get(created.threadId).n,
      2
    )
  })
}

test("线程与回复分页完整、损坏锚点显式标注、不改写持久内容", async (t) => {
  const { store, call, draft, versions } = await setup(t)
  const first = await call("create_thread", {
    versionId: versions[0],
    target: { kind: "document" },
    body: "whole",
    requestKey: "first",
  })
  for (let i = 0; i < 105; i++)
    await call("add_reply", {
      threadId: first.threadId,
      body: `reply${i}`,
      requestKey: `reply${i}`,
    })
  const read = await call("read_thread", { threadId: first.threadId })
  assert.equal(read.replies.complete, false)
  const next = await call("read_thread", {
    threadId: first.threadId,
    replyCursor: read.replies.nextCursor,
  })
  const replies = [...read.replies.items, ...next.replies.items]
  assert.equal(replies.length, 106)
  assert.equal(new Set(replies.map((r) => r.id)).size, 106)
  for (let i = 0; i < 51; i++)
    await call("create_thread", {
      versionId: versions[0],
      target: { kind: "document" },
      body: `thread${i}`,
      requestKey: `thread${i}`,
    })
  const a = await call("list_threads", { draftId: draft.id })
  const b = await call("list_threads", {
    draftId: draft.id,
    cursor: a.nextCursor,
  })
  assert.equal(new Set([...a.items, ...b.items].map((r) => r.id)).size, 52)
  store.db
    .prepare("UPDATE threads SET anchor=? WHERE id=?")
    .run("broken", first.threadId)
  assert.equal(
    (await call("read_thread", { threadId: first.threadId })).thread.anchor
      .kind,
    "corrupt"
  )
  assert.equal(
    store.db
      .prepare("SELECT anchor FROM threads WHERE id=?")
      .get(first.threadId).anchor,
    "broken"
  )
})

test("错误类型目标、缺失对象及无身份不能写入评论", async (t) => {
  const { call, versions, store } = await setup(t, "board")
  const base = { versionId: versions[0], body: "no", requestKey: "no" }
  await assert.rejects(
    () =>
      call("create_thread", {
        ...base,
        target: { kind: "ui", page: "/", tag: "button" },
      }),
    { code: "invalid_anchor" }
  )
  await assert.rejects(
    () =>
      call("create_thread", {
        ...base,
        target: { kind: "board", objectId: "missing" },
      }),
    { code: "invalid_anchor" }
  )
  await assert.rejects(
    () => call("create_thread", { ...base, target: { kind: "document" } }, {}),
    { code: "identity_denied" }
  )
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get().n, 0)
})

test("评论编辑/删除、删除线程及永久删除已归档草稿的权限与边界", async (t) => {
  const { call, draft, versions, store } = await setup(t)
  const created = await call(
    "create_thread",
    {
      versionId: versions[0],
      target: { kind: "document" },
      body: "初始意见",
      requestKey: "t-edit-1",
    },
    { source: "mcp", actorId: "B" }
  )
  const added = await call(
    "add_reply",
    {
      threadId: created.threadId,
      body: "跟进回复",
      requestKey: "r-edit-1",
    },
    { source: "local" }
  )
  // Agent 不能编辑他人回复
  await assert.rejects(
    () =>
      call(
        "update_reply",
        {
          replyId: added.replyId,
          body: "越权改写",
          requestKey: "upd-deny",
        },
        { source: "mcp", actorId: "B" }
      ),
    { code: "identity_denied" }
  )
  // 本地用户可编辑任意回复并支持幂等重放
  const updated = await call(
    "update_reply",
    {
      replyId: created.replyId,
      body: "已修订的**初始意见**",
      requestKey: "upd-ok",
    },
    { source: "local" }
  )
  assert.equal(updated.body, "已修订的**初始意见**")
  assert.equal(
    (
      await call(
        "update_reply",
        {
          replyId: created.replyId,
          body: "已修订的**初始意见**",
          requestKey: "upd-ok",
        },
        { source: "local" }
      )
    ).replayed,
    true
  )
  // 删除单条回复（线程仍有剩余回复，不删除线程）
  const delOne = await call(
    "delete_reply",
    { replyId: added.replyId, requestKey: "del-r1" },
    { source: "local" }
  )
  assert.equal(delOne.threadDeleted, false)
  // 删除最后一条回复，自动移除线程
  const delLast = await call(
    "delete_reply",
    { replyId: created.replyId, requestKey: "del-r2" },
    { source: "local" }
  )
  assert.equal(delLast.threadDeleted, true)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get().n, 0)

  // 删除整条线程
  const second = await call(
    "create_thread",
    {
      versionId: versions[0],
      target: { kind: "document" },
      body: "待删线程",
      requestKey: "t-del-2",
    },
    { source: "local" }
  )
  const delThread = await call(
    "delete_thread",
    { threadId: second.threadId, requestKey: "del-t2" },
    { source: "local" }
  )
  assert.equal(delThread.deletedReplies, 1)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get().n, 0)

  // 未归档草稿拒绝永久删除；MCP 身份也拒绝永久删除
  await assert.rejects(
    () =>
      call(
        "delete_draft",
        { draftId: draft.id, requestKey: "del-d-unarchived" },
        { source: "local" }
      ),
    { code: "validation_failed" }
  )
  await call(
    "update_draft",
    { draftId: draft.id, archived: true, requestKey: "arch-d" },
    { source: "local" }
  )
  await assert.rejects(
    () =>
      call(
        "delete_draft",
        { draftId: draft.id, requestKey: "del-d-mcp" },
        { source: "mcp", actorId: "A" }
      ),
    { code: "identity_denied" }
  )
  const deleted = await call(
    "delete_draft",
    { draftId: draft.id, requestKey: "del-d-ok" },
    { source: "local" }
  )
  assert.equal(deleted.deletedVersions, 2)
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 0)
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM versions").get().n,
    0
  )
})
