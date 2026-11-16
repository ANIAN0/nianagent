import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WorkbenchStore } from "./storage.mjs"

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "moon-domain-"))
  const store = new WorkbenchStore(root)
  t.after(async () => {
    store.close()
    await rm(root, { recursive: true, force: true })
  })
  await store.open()
  const p = store.createProject("p", "A", "p")
  const a = store.createDirectory(p.id, null, "a", "A", "a")
  const b = store.createDirectory(p.id, null, "b", "A", "b")
  const draft = store.createDraft(a.id, "markdown", "draft", "A", "draft")
  return { store, root, p, a, b, draft }
}

test("创建目录在项目归档后重放仍返回原结果", async (t) => {
  const { store, p, a } = await setup(t)
  store.updateProject(p.id, { archived: true }, "A", "archive")
  const replay = store.createDirectory(p.id, null, "a", "A", "a")
  assert.equal(replay.id, a.id)
  assert.equal(replay.replayed, true)
})

test("创建草稿在目录归档后重放仍返回原结果", async (t) => {
  const { store, a, draft } = await setup(t)
  store.updateDirectory(a.id, { archived: true }, "A", "archive")
  const replay = store.createDraft(a.id, "markdown", "draft", "A", "draft")
  assert.equal(replay.id, draft.id)
  assert.equal(replay.replayed, true)
})

test("移动目录重放不重新套用后来拓扑，也不会形成环", async (t) => {
  const { store, a, b } = await setup(t)
  const first = store.updateDirectory(a.id, { parentId: b.id }, "A", "move")
  store.updateDirectory(a.id, { parentId: null }, "A", "root")
  store.updateDirectory(b.id, { parentId: a.id }, "A", "reverse")
  const replay = store.updateDirectory(a.id, { parentId: b.id }, "A", "move")
  assert.equal(replay.parentId, first.parentId)
  assert.equal(replay.replayed, true)
  assert.equal(
    store.db.prepare("SELECT parent_id FROM directories WHERE id=?").get(a.id)
      .parent_id,
    null
  )
})

test("parentId缺省与显式null不是同一个写请求", async (t) => {
  const { store, a, b } = await setup(t)
  store.updateDirectory(a.id, { parentId: b.id }, "A", "move")
  store.updateDirectory(a.id, { name: "renamed" }, "A", "rename")
  assert.throws(
    () =>
      store.updateDirectory(
        a.id,
        { name: "renamed", parentId: null },
        "A",
        "rename"
      ),
    { code: "request_key_conflict" }
  )
})

test("草稿移动重放先于目标目录后来归档的检查", async (t) => {
  const { store, a, b, draft } = await setup(t)
  store.updateDraft(draft.id, { directoryId: b.id }, "A", "move", 0)
  store.updateDraft(draft.id, { directoryId: a.id }, "A", "back", 1)
  store.updateDirectory(b.id, { archived: true }, "A", "archive")
  const replay = store.updateDraft(
    draft.id,
    { directoryId: b.id },
    "A",
    "move",
    0
  )
  assert.equal(replay.replayed, true)
  assert.equal(replay.directoryId, b.id)
  assert.equal(store.draft(draft.id).directoryId, a.id)
})

test("父级归档与恢复集合互斥，跨项目父级与目录环拒绝", async (t) => {
  const { store, p, a, b, draft } = await setup(t)
  const other = store.createProject("other", "B", "other")
  const foreign = store.createDirectory(
    other.id,
    null,
    "foreign",
    "B",
    "foreign"
  )
  assert.throws(() =>
    store.updateDirectory(a.id, { parentId: foreign.id }, "A", "wrong")
  )
  store.updateDirectory(b.id, { parentId: a.id }, "A", "child")
  assert.throws(() =>
    store.updateDirectory(a.id, { parentId: b.id }, "A", "cycle")
  )
  store.updateProject(p.id, { archived: true }, "A", "archive")
  assert.equal(
    store.listDrafts().items.some((x) => x.id === draft.id),
    false
  )
  assert.equal(
    store.listDrafts({ archived: true }).items.some((x) => x.id === draft.id),
    true
  )
  store.updateProject(p.id, { archived: false }, "A", "restore")
  assert.equal(
    store.listDrafts().items.some((x) => x.id === draft.id),
    true
  )
  assert.equal(
    store.listDrafts({ archived: true }).items.some((x) => x.id === draft.id),
    false
  )
})

test("发布CAS竞争、响应丢失重放、同键不同作者均保持唯一版本", async (t) => {
  const { store, root, draft } = await setup(t)
  const source = join(root, "source")
  await mkdir(source)
  await writeFile(join(source, "doc.md"), "# V1")
  const artifact = await store.stagePackage(source, "markdown", "A")
  const input = {
    draftId: draft.id,
    baseSequence: 0,
    artifactId: artifact.artifactId,
    requestKey: "pub",
  }
  const first = store.publishVersion(input, "A")
  assert.equal(store.publishVersion(input, "A").versionId, first.versionId)
  assert.throws(() => store.publishVersion(input, "B"), {
    code: "request_key_conflict",
  })
  const second = await store.stagePackage(source, "markdown", "B")
  assert.throws(
    () =>
      store.publishVersion(
        { ...input, artifactId: second.artifactId, requestKey: "pub-b" },
        "B"
      ),
    { code: "version_conflict" }
  )
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM versions").get().n,
    1
  )
})

test("项目目录草稿keyset在相同时间戳下翻页不漏不重", async (t) => {
  const { store, p, a } = await setup(t)
  for (let i = 0; i < 55; i++) {
    store.createProject(`project${i}`, "A", `project${i}`)
    store.createDirectory(p.id, null, `dir${i}`, "A", `dir${i}`)
    store.createDraft(a.id, "markdown", `doc${i}`, "A", `doc${i}`)
  }
  for (const table of ["projects", "directories", "drafts"]) {
    store.db
      .prepare(`UPDATE ${table} SET created_at=?`)
      .run("2026-01-01T00:00:00.000Z")
  }
  for (const [expected, page] of [
    [56, (cursor) => store.listProjects(cursor, 10)],
    [57, (cursor) => store.listDirectories(p.id, cursor, 10)],
    [56, (cursor) => store.listDrafts({}, cursor, 10)],
  ]) {
    let cursor
    const ids = []
    do {
      const result = page(cursor)
      ids.push(...result.items.map((row) => row.id))
      cursor = result.nextCursor
      if (result.complete) break
      assert.ok(cursor)
    } while (ids.length <= expected)
    assert.equal(ids.length, expected)
    assert.equal(new Set(ids).size, expected)
  }
})

test("元数据CAS拒绝过期新请求，但原请求在重启后仍返回原回执", async (t) => {
  const { store, draft } = await setup(t)
  const first = store.updateDraft(draft.id, { title: "first" }, "A", "first", 0)
  store.updateDraft(draft.id, { title: "second" }, "B", "second", 1)
  assert.throws(
    () => store.updateDraft(draft.id, { title: "stale" }, "A", "stale", 0),
    { code: "metadata_revision_conflict" }
  )
  store.close()
  await store.open()
  const replay = store.updateDraft(
    draft.id,
    { title: "first" },
    "A",
    "first",
    0
  )
  assert.equal(replay.metadataRevision, first.metadataRevision)
  assert.equal(replay.replayed, true)
  assert.equal(store.draft(draft.id).title, "second")
  assert.throws(
    () => store.updateDraft(draft.id, { title: "first" }, "B", "first", 0),
    { code: "request_key_conflict" }
  )
})
