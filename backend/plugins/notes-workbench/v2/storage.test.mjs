// @ts-check
// S2a 核心存储回归测试（实现方案 §11 R1：Q03/Q05/Q07/Q08 反例固化）。
// 全部使用隔离临时目录，不触真实用户数据；每次运行自建自清理。
import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkbenchStore, WorkbenchError } from "./storage.mjs"

/** 建立隔离数据根 + 已发布一条 Markdown 版本的 store；返回句柄供用例断言。 */
async function setup(t, markdown = "# 标题\n\n第一段。\n\n第一段。\n") {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-store-"))
  const store = new WorkbenchStore(join(root, "v2"))
  const stores = [store]
  t.after(async () => {
    for (const s of stores) {
      try {
        s.close()
      } catch {
        // 重复关闭容错：清理路径不因已关闭的库失败
      }
    }
    // Windows 关闭句柄后锁释放存在短暂延迟；有界重试仅用于测试清理
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(root, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  })
  const source = join(root, "src")
  await mkdir(source)
  await writeFile(join(source, "doc.md"), markdown)
  await store.open()
  const actor = "agentA"
  const project = store.createProject("项目", actor, "req-project-1")
  const directory = store.createDirectory(
    project.id,
    null,
    "目录",
    actor,
    "req-directory-1"
  )
  const draft = store.createDraft(
    directory.id,
    "markdown",
    "草稿",
    actor,
    "req-draft-1"
  )
  const staged = await store.stagePackage(source, "markdown", actor)
  const published = store.publishVersion(
    {
      draftId: draft.id,
      baseSequence: 0,
      artifactId: staged.artifactId,
      requestKey: "req-publish-1",
    },
    actor
  )
  return {
    root,
    store,
    stores,
    source,
    actor,
    project,
    directory,
    draft,
    staged,
    published,
  }
}

const workbenchCode = (error) => error instanceof WorkbenchError && error.code

/** 独立建库用例统一清理：先关库再删目录（Windows 锁释放有延迟，有界重试仅用于测试清理）。 */
async function openIsolated(t, root) {
  const store = new WorkbenchStore(join(root, "v2"))
  await store.open()
  t.after(async () => {
    try {
      store.close()
    } catch {
      // 重复关闭容错：清理路径不因已关闭的库失败
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(root, { recursive: true, force: true })
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  })
  return store
}

// ---- Q03：评论锚点持久化 ----

test("Q03 定位评论锚点持久化：读回与重启后完全一致", async (t) => {
  const { store, stores, published } = await setup(t)
  const anchor = {
    kind: "markdown",
    block: 1,
    start: 0,
    end: 4,
    quote: "第一段。",
  }
  const created = store.createThread(
    published.versionId,
    anchor,
    "请核对这段",
    "req-thread-1",
    "agentA"
  )
  const readBack = store.readThread(created.threadId)
  assert.deepEqual(readBack.thread.anchor, anchor)
  const reopened = new WorkbenchStore(store.root)
  await reopened.open()
  stores.push(reopened)
  const afterRestart = reopened.readThread(created.threadId)
  assert.deepEqual(afterRestart.thread.anchor, anchor)
})

test("Q03 整篇评论（document 锚点）持久化", async (t) => {
  const { store, published } = await setup(t)
  const anchor = { kind: "document" }
  const created = store.createThread(
    published.versionId,
    anchor,
    "整体结论",
    "req-thread-doc-1",
    "agentA"
  )
  const readBack = store.readThread(created.threadId)
  assert.deepEqual(readBack.thread.anchor, { kind: "document" })
})

test("Q03 跨块锚点（segments，各段含 quote）持久化", async (t) => {
  const { store, published } = await setup(
    t,
    "# 标题\n\n第一段。\n\n第二段。\n"
  )
  const anchor = {
    kind: "markdown",
    segments: [
      { block: 1, start: 0, end: 4, quote: "第一段。" },
      { block: 2, start: 0, end: 4, quote: "第二段。" },
    ],
  }
  const created = store.createThread(
    published.versionId,
    anchor,
    "跨块意见",
    "req-thread-cross-1",
    "agentA"
  )
  const readBack = store.readThread(created.threadId)
  assert.deepEqual(readBack.thread.anchor, anchor)
})

// ---- Q05：幂等完整请求签名 ----

test("Q05 发布重放：同键但 artifactId 不同 → request_key_conflict", async (t) => {
  const { store, draft, actor, source } = await setup(t)
  const staged2 = await store.stagePackage(source, "markdown", actor)
  assert.throws(
    () =>
      store.publishVersion(
        {
          draftId: draft.id,
          baseSequence: 1,
          artifactId: staged2.artifactId,
          requestKey: "req-publish-1",
        },
        actor
      ),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 发布重放：同键但 actor 不同 → 不得冒认原请求", async (t) => {
  const { store, draft, staged } = await setup(t)
  assert.throws(
    () =>
      store.publishVersion(
        {
          draftId: draft.id,
          baseSequence: 0,
          artifactId: staged.artifactId,
          requestKey: "req-publish-1",
        },
        "agentB"
      ),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 评论重放：同键但正文不同 → request_key_conflict", async (t) => {
  const { store, published } = await setup(t)
  const anchor = { kind: "document" }
  store.createThread(
    published.versionId,
    anchor,
    "原评论",
    "req-thread-2",
    "agentA"
  )
  assert.throws(
    () =>
      store.createThread(
        published.versionId,
        anchor,
        "不同正文",
        "req-thread-2",
        "agentA"
      ),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 评论重放：同键但 actor 不同 → request_key_conflict", async (t) => {
  const { store, published } = await setup(t)
  const anchor = { kind: "document" }
  store.createThread(
    published.versionId,
    anchor,
    "原评论",
    "req-thread-3",
    "agentA"
  )
  assert.throws(
    () =>
      store.createThread(
        published.versionId,
        anchor,
        "原评论",
        "req-thread-3",
        "agentB"
      ),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 评论重放：同键但锚点不同 → request_key_conflict", async (t) => {
  const { store, published } = await setup(t)
  store.createThread(
    published.versionId,
    { kind: "document" },
    "正文",
    "req-thread-4",
    "agentA"
  )
  assert.throws(
    () =>
      store.createThread(
        published.versionId,
        { kind: "markdown", block: 1, start: 0, end: 4, quote: "第一段。" },
        "正文",
        "req-thread-4",
        "agentA"
      ),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 回复重放：同键但正文不同 → request_key_conflict", async (t) => {
  const { store, published } = await setup(t)
  const thread = store.createThread(
    published.versionId,
    { kind: "document" },
    "首评",
    "req-thread-5",
    "agentA"
  )
  store.addReply(thread.threadId, "原回复", null, "req-reply-1", "agentA")
  assert.throws(
    () =>
      store.addReply(
        thread.threadId,
        "不同回复",
        null,
        "req-reply-1",
        "agentA"
      ),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 产物记录导入者 imported_by", async (t) => {
  const { store, staged, actor } = await setup(t)
  const row = store.db
    .prepare("SELECT imported_by FROM artifacts WHERE id = ?")
    .get(staged.artifactId)
  assert.equal(row.imported_by, actor)
})

test("Q05 createProject/createDirectory/createDraft 携带请求身份并可重放", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-store-"))
  const store = await openIsolated(t, root)
  const first = store.createProject("项目", "agentA", "req-create-project-9")
  const replayed = store.createProject("项目", "agentA", "req-create-project-9")
  assert.equal(replayed.id, first.id)
  assert.equal(replayed.replayed, true)
  assert.throws(
    () => store.createProject("其他名称", "agentA", "req-create-project-9"),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
  assert.throws(
    () => store.createProject("其他名称", "agentB", "req-create-project-9"),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

test("Q05 set_thread_status 携带请求身份：重放返回原事件，同键异输入拒绝", async (t) => {
  const { store, published } = await setup(t)
  const thread = store.createThread(
    published.versionId,
    { kind: "document" },
    "首评",
    "req-thread-6",
    "agentA"
  )
  const changed = store.setThreadStatus(
    thread.threadId,
    "resolved",
    "local-user",
    {
      isUser: true,
      requestKey: "req-status-1",
    }
  )
  assert.equal(changed.changed, true)
  const replayed = store.setThreadStatus(
    thread.threadId,
    "resolved",
    "local-user",
    {
      isUser: true,
      requestKey: "req-status-1",
    }
  )
  assert.equal(replayed.replayed, true)
  assert.throws(
    () =>
      store.setThreadStatus(thread.threadId, "open", "local-user", {
        isUser: true,
        requestKey: "req-status-1",
      }),
    (error) => workbenchCode(error) === "request_key_conflict"
  )
})

// ---- Q07：资源路径边界 ----

test("Q07 readAsset 拒绝字符串前缀兄弟目录（无分隔符边界）", async (t) => {
  const { store, published, staged } = await setup(t)
  // 手工放置与当前产物同前缀的兄弟目录及秘密文件，模拟核查反例
  const sibling = `${staged.artifactId}-sibling`
  await mkdir(join(store.root, "artifacts", sibling), { recursive: true })
  await writeFile(
    join(store.root, "artifacts", sibling, "secret.txt"),
    "AUDIT_ONLY"
  )
  await assert.rejects(
    () => store.readAsset(published.versionId, `../${sibling}/secret.txt`),
    (error) => workbenchCode(error) === "not_found"
  )
})

test("Q07 readAsset 拒绝符号链接逃逸", async (t) => {
  const { store, published, staged } = await setup(t)
  const outside = join(store.root, "outside")
  await mkdir(outside)
  await writeFile(join(outside, "leak.txt"), "SECRET")
  let linked = true
  try {
    // Windows 目录 junction 无需管理员权限
    await symlink(
      outside,
      join(store.root, "artifacts", staged.artifactId, "link"),
      "junction"
    )
  } catch {
    linked = false
  }
  if (!linked) {
    t.skip("当前环境无法创建 junction，跳过符号链接用例")
    return
  }
  await assert.rejects(
    () => store.readAsset(published.versionId, "link/leak.txt"),
    (error) => workbenchCode(error) === "not_found"
  )
})

// ---- Q08：坏库保护与导入有效性 ----

test("Q08 已存在的零字节库明确失败且原文件保留", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-store-"))
  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}))
  const dbFile = join(root, "v2", "workbench.db")
  await mkdir(join(root, "v2"), { recursive: true })
  await writeFile(dbFile, "")
  const store = new WorkbenchStore(join(root, "v2"))
  await assert.rejects(
    () => store.open(),
    (error) => workbenchCode(error) === "storage_failure"
  )
  const after = await readFile(dbFile)
  assert.equal(after.length, 0, "坏库文件不得被重置或改写")
  store.close()
})

test("Q08 markdown 包缺少正文入口被拒绝导入", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-store-"))
  const source = join(root, "src")
  await mkdir(source)
  await writeFile(join(source, "image.png"), "png")
  const store = await openIsolated(t, root)
  await assert.rejects(
    () => store.stagePackage(source, "markdown", "agentA"),
    (error) => workbenchCode(error) === "validation_failed"
  )
})

test("Q08 markdown 包正文入口不唯一被拒绝导入", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-v2-store-"))
  const source = join(root, "src")
  await mkdir(source)
  await writeFile(join(source, "a.md"), "# A")
  await writeFile(join(source, "b.md"), "# B")
  const store = await openIsolated(t, root)
  await assert.rejects(
    () => store.stagePackage(source, "markdown", "agentA"),
    (error) => workbenchCode(error) === "validation_failed"
  )
})

test("Q08 读取版本使用冻结表示（入口固定，不猜测非 md 文件）", async (t) => {
  const { store, published } = await setup(t)
  const data = await store.readMarkdownVersion(published.versionId)
  assert.equal(data.entry, "doc.md")
  // 冻结表示：管线版本与块投影来自封存包内派生文件，而非每次重新解析
  assert.ok(data.reading && Number.isInteger(data.reading.pipeline))
  assert.ok(
    Array.isArray(data.reading.blocks) && data.reading.blocks.length > 0
  )
})
