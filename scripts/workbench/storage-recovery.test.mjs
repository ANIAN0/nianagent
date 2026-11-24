import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { syncBuiltinESMExports } from "node:module"
import { DatabaseSync } from "node:sqlite"
import { WorkbenchStore } from "../../apps/workbench/src/server/notes/storage.mjs"

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), "moon-recovery-"))
  const store = new WorkbenchStore(root)
  t.after(async () => {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  })
  await store.open()
  store.createProject("before", "agent-a", "before")
  const backupId = await store.backupNow()
  store.createProject("after", "agent-a", "after")
  store.close()
  return { root, store, backupId }
}

test("导入和暂存清理同时失败时保留两项原因，明确拒绝且不封存产物", async (t) => {
  const { root, store } = await fixture(t)
  await store.open()
  const source = join(root, "cleanup-source")
  await fs.mkdir(source)
  await fs.writeFile(join(source, "doc.md"), "# content")
  const copyFailure = Object.assign(new Error("injected copy failure"), {
    code: "ENOSPC",
  })
  const cleanupFailure = Object.assign(new Error("injected cleanup failure"), {
    code: "EACCES",
  })
  t.mock.method(fs, "copyFile", async () => {
    throw copyFailure
  })
  const remove = fs.rm
  t.mock.method(fs, "rm", async (path, options) => {
    if (String(path).startsWith(join(root, "staging"))) throw cleanupFailure
    return remove(path, options)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(
      store.stagePackage(source, "markdown", "agent-a"),
      (error) => {
        assert.equal(error.code, "storage_failure")
        assert.deepEqual(error.cause.errors, [copyFailure, cleanupFailure])
        return true
      }
    )
    assert.equal(
      store.db.prepare("SELECT COUNT(*) n FROM artifacts").get().n,
      0
    )
    assert.equal((await fs.readdir(join(root, "staging"))).length, 1)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

test("回滚失败关闭连接且保留原故障，重开不出现未提交行", async (t) => {
  const { root, store } = await fixture(t)
  await store.open()
  const actual = store.db.exec.bind(store.db)
  const failedCommit = new Error("injected commit failure")
  const failedRollback = new Error("injected rollback failure")
  t.mock.method(store.db, "exec", (sql) => {
    if (sql === "COMMIT") throw failedCommit
    if (sql === "ROLLBACK") throw failedRollback
    return actual(sql)
  })
  try {
    assert.throws(
      () => store.createProject("must-not-commit", "agent-a", "failed-write"),
      (error) => {
        assert.equal(error.code, "storage_failure")
        assert.deepEqual(error.cause.errors, [failedCommit, failedRollback])
        return true
      }
    )
    assert.equal(store.db, undefined)
  } finally {
    t.mock.restoreAll()
  }
  const check = new WorkbenchStore(root)
  await check.open()
  try {
    assert.equal(
      check.db
        .prepare("SELECT COUNT(*) n FROM projects WHERE name='must-not-commit'")
        .get().n,
      0
    )
  } finally {
    check.close()
  }
})

test("独立连接持写锁时按五秒期限失败，无半回执；释放后同请求可提交", async (t) => {
  const { root, store } = await fixture(t)
  await store.open()
  const blocker = new DatabaseSync(join(root, "workbench.db"))
  blocker.exec("BEGIN IMMEDIATE")
  const started = performance.now()
  try {
    assert.throws(
      () => store.createProject("locked-write", "agent-a", "locked-write"),
      /locked|busy/i
    )
    const elapsed = performance.now() - started
    assert.ok(
      elapsed >= 4500 && elapsed < 8000,
      `bounded busy timeout: ${elapsed}ms`
    )
    assert.equal(
      store.db
        .prepare(
          "SELECT COUNT(*) n FROM write_receipts WHERE request_key='locked-write'"
        )
        .get().n,
      0
    )
  } finally {
    blocker.exec("ROLLBACK")
    blocker.close()
  }
  const result = store.createProject("locked-write", "agent-a", "locked-write")
  assert.equal(result.replayed, false)
  assert.equal(
    store.createProject("locked-write", "agent-a", "locked-write").id,
    result.id
  )
})

for (const phase of [
  "copy",
  "sync",
  "seal",
  "source-change",
  "cancel",
  "commit",
]) {
  test(`封存/发布故障 ${phase} 保留V1且无半版本`, async (t) => {
    const { root, store } = await fixture(t)
    await store.open()
    const project = store.createProject("fault", "agent-a", "fault")
    const directory = store.createDirectory(
      project.id,
      null,
      "dir",
      "agent-a",
      "dir"
    )
    const draft = store.createDraft(
      directory.id,
      "markdown",
      "doc",
      "agent-a",
      "draft"
    )
    const source = join(root, "source")
    await fs.mkdir(source)
    await fs.writeFile(join(source, "doc.md"), "# V1")
    const first = await store.stagePackage(source, "markdown", "agent-a")
    const v1 = store.publishVersion(
      {
        draftId: draft.id,
        baseSequence: 0,
        artifactId: first.artifactId,
        requestKey: "v1",
      },
      "agent-a"
    )
    await fs.writeFile(join(source, "doc.md"), "# V2")
    const controller = new AbortController()
    const full = () =>
      Object.assign(new Error("injected full disk"), { code: "ENOSPC" })
    if (["copy", "source-change", "cancel"].includes(phase)) {
      const copy = fs.copyFile
      t.mock.method(fs, "copyFile", async (...args) => {
        if (phase === "copy") throw full()
        await copy(...args)
        if (phase === "source-change")
          await fs.appendFile(join(source, "doc.md"), " changed")
        if (phase === "cancel") controller.abort()
      })
    }
    if (phase === "sync") {
      const open = fs.open
      t.mock.method(fs, "open", async (...args) => {
        const handle = await open(...args)
        t.mock.method(handle, "sync", async () => {
          throw full()
        })
        return handle
      })
    }
    if (phase === "seal")
      t.mock.method(fs, "rename", async () => {
        throw full()
      })
    syncBuiltinESMExports()
    try {
      if (phase === "commit") {
        const staged = await store.stagePackage(source, "markdown", "agent-a")
        const exec = store.db.exec.bind(store.db)
        t.mock.method(store.db, "exec", (sql) => {
          if (sql.trim().toUpperCase() === "COMMIT")
            throw Object.assign(new Error("injected SQLite full"), {
              code: "SQLITE_FULL",
            })
          return exec(sql)
        })
        assert.throws(() =>
          store.publishVersion(
            {
              draftId: draft.id,
              baseSequence: 1,
              artifactId: staged.artifactId,
              requestKey: "v2",
            },
            "agent-a"
          )
        )
      } else {
        await assert.rejects(() =>
          store.stagePackage(source, "markdown", "agent-a", {
            signal: controller.signal,
          })
        )
      }
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    }
    assert.equal(
      store.db
        .prepare("SELECT COUNT(*) AS n FROM versions WHERE draft_id=?")
        .get(draft.id).n,
      1
    )
    assert.deepEqual(await fs.readdir(join(root, "staging")), [])
    assert.equal(
      (await store.readAsset(v1.versionId, "doc.md")).toString(),
      "# V1"
    )
  })
}

test("恢复准备阶段磁盘写入失败，当前库仍在原位且内容不丢失", async (t) => {
  const { root, backupId } = await fixture(t)
  const copy = fs.copyFile
  t.mock.method(fs, "copyFile", async (source, destination, ...rest) => {
    if (String(source).includes(backupId)) {
      throw Object.assign(new Error("injected disk full"), { code: "ENOSPC" })
    }
    return copy(source, destination, ...rest)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(() => WorkbenchStore.restoreFromBackup(root, backupId))
    assert.equal((await fs.stat(join(root, "workbench.db"))).isFile(), true)
    const db = new DatabaseSync(join(root, "workbench.db"), { readOnly: true })
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM projects").get().n, 2)
    } finally {
      db.close()
    }
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

test("未知已有SQLite库不能被初始化为工作台库", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "moon-recovery-"))
  const file = join(root, "workbench.db")
  const foreign = new DatabaseSync(file)
  foreign.exec(
    "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('keep')"
  )
  foreign.close()
  const store = new WorkbenchStore(root)
  t.after(async () => {
    store.close()
    await fs.rm(root, { recursive: true, force: true })
  })
  await assert.rejects(() => store.open(), /未知|标识/)
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    assert.equal(db.prepare("PRAGMA application_id").get().application_id, 0)
    assert.equal(db.prepare("SELECT value FROM unrelated").get().value, "keep")
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='projects'"
        )
        .get().n,
      0
    )
  } finally {
    db.close()
  }
})

test("缺失备份不会被读取动作创建成空数据库", async (t) => {
  const { root } = await fixture(t)
  const dir = join(root, "backups", "missing")
  await fs.mkdir(dir)
  await assert.rejects(() => WorkbenchStore.restoreFromBackup(root, "missing"))
  await assert.rejects(() => fs.stat(join(dir, "workbench.db")), {
    code: "ENOENT",
  })
})

test("成功恢复保留当前库于隔离区，恢复点自身不被修改", async (t) => {
  const { root, backupId, store } = await fixture(t)
  const original = await fs.readFile(
    join(root, "backups", backupId, "workbench.db")
  )
  const { recoveryId } = await WorkbenchStore.restoreFromBackup(root, backupId)
  await store.open()
  assert.deepEqual(
    store.listProjects().items.map((p) => p.name),
    ["before"]
  )
  const quarantined = new DatabaseSync(
    join(root, "recovery", recoveryId, "workbench.db"),
    { readOnly: true }
  )
  try {
    assert.equal(
      quarantined.prepare("SELECT COUNT(*) AS n FROM projects").get().n,
      2
    )
  } finally {
    quarantined.close()
  }
  assert.deepEqual(
    await fs.readFile(join(root, "backups", backupId, "workbench.db")),
    original
  )
})

test("恢复最终替换失败会将隔离的原库放回原路径", async (t) => {
  const { root, backupId } = await fixture(t)
  const rename = fs.rename
  t.mock.method(fs, "rename", async (source, destination) => {
    if (String(source).includes(".restore-"))
      throw Object.assign(new Error("injected rename denied"), {
        code: "EACCES",
      })
    return rename(source, destination)
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(() => WorkbenchStore.restoreFromBackup(root, backupId))
    const db = new DatabaseSync(join(root, "workbench.db"), { readOnly: true })
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM projects").get().n, 2)
    } finally {
      db.close()
    }
    assert.equal(
      (await fs.readdir(root)).some((name) => name.startsWith(".restore-")),
      false
    )
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

test("备份写入失败不会留下伪恢复点或挤占七份有效备份", async (t) => {
  const { root, store } = await fixture(t)
  await store.open()
  for (let n = 0; n < 7; n++) await store.backupNow()
  const before = (await fs.readdir(join(root, "backups"))).sort()
  assert.equal(before.length, 7)
  const mkdir = fs.mkdir
  t.mock.method(fs, "mkdir", async (path, options) => {
    const result = await mkdir(path, options)
    if (dirname(String(path)) === join(root, "backups"))
      await mkdir(join(path, "workbench.db")) // 文件位置被占用，SQLite真实写入失败
    return result
  })
  syncBuiltinESMExports()
  try {
    await assert.rejects(() => store.backupNow())
    assert.deepEqual((await fs.readdir(join(root, "backups"))).sort(), before)
    assert.equal(store.listProjects().items.length, 2)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
  await store.backupNow()
  assert.equal((await fs.readdir(join(root, "backups"))).length, 7)
})

test("恢复旧库不删除三类新版本的封存资源，隔离库仍能引用它们", async (t) => {
  const { root, store } = await fixture(t)
  await store.open()
  const p = store.createProject("artifacts", "agent-a", "artifacts")
  const d = store.createDirectory(
    p.id,
    null,
    "directory",
    "agent-a",
    "directory"
  )
  const published = []
  const old = await store.backupNow()
  for (const kind of ["markdown", "board", "ui"]) {
    const source = join(root, `source-${kind}`)
    await fs.mkdir(source)
    const filename =
      kind === "markdown"
        ? "doc.md"
        : kind === "board"
          ? "board.canvas"
          : "preview.json"
    const body =
      kind === "markdown"
        ? "# keep"
        : kind === "board"
          ? JSON.stringify({
              nodes: [
                {
                  id: "n",
                  type: "text",
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 80,
                  text: "keep",
                },
              ],
              edges: [],
            })
          : JSON.stringify({ routes: { "/": "index.html" } })
    await fs.writeFile(join(source, filename), body)
    if (kind === "ui")
      await fs.writeFile(join(source, "index.html"), "<h1>keep</h1>")
    const draft = store.createDraft(
      d.id,
      kind,
      kind,
      "agent-a",
      `draft-${kind}`
    )
    const staged = await store.stagePackage(source, kind, "agent-a")
    const version = store.publishVersion(
      {
        draftId: draft.id,
        baseSequence: 0,
        artifactId: staged.artifactId,
        requestKey: `pub-${kind}`,
      },
      "agent-a"
    )
    published.push({
      versionId: version.versionId,
      kind,
      path: store.versionArtifactPath(version.versionId),
    })
    await fs.rm(source, { recursive: true })
    assert.equal((await store.readVersionContent(version.versionId)).kind, kind)
  }
  store.close()
  const { recoveryId } = await WorkbenchStore.restoreFromBackup(root, old)
  const preserved = new DatabaseSync(
    join(root, "recovery", recoveryId, "workbench.db"),
    { readOnly: true }
  )
  try {
    for (const item of published) {
      assert.ok(
        preserved
          .prepare("SELECT id FROM versions WHERE id=?")
          .get(item.versionId)
      )
      assert.equal((await fs.stat(item.path)).isDirectory(), true)
      const frozen = JSON.parse(
        await fs.readFile(join(item.path, ".moon", "reading.json"), "utf8")
      )
      assert.equal(frozen.kind ?? "markdown", item.kind)
    }
  } finally {
    preserved.close()
  }
})
