// @ts-check
// S2a 工作台核心域存储（正式模块，S0c 契约 v1 + Q15 局部修订）：
// - 数据根 <host.directory>/v2/：workbench.db + staging/ + artifacts/ + backups/ + recovery/
// - 发布协议：staging → 清单核对（无哈希）→ 派生冻结表示 → 逐文件 sync → 同卷改名封存 → 登记 sealed → 短事务建版本 + CAS
// - 重放核对先于 base CAS；request_key 全局唯一且完整输入签名（含 actor）；线程固定创建时版本并持久化锚点快照
// - 身份：actor 由调用方上下文传入（MCP=认证解析，UI=local-user），本模块不解析凭据
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite"
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rename as fsRename,
  lstat,
  realpath,
  rm,
  stat,
} from "node:fs/promises"
import { isAbsolute, join, dirname, relative } from "node:path"
import { randomUUID } from "node:crypto"
import { WorkbenchError } from "./errors.mjs"
import { readerFor } from "./readers.mjs"
import { READING_PIPELINE_VERSION } from "./markdown.mjs"
import { BOARD_PIPELINE_VERSION } from "./readers/board.mjs"
import {
  UI_PIPELINE_VERSION,
  validPreviewRoute,
  validPreviewFile,
} from "./readers/ui.mjs"

// AC16：readers 不得反向依赖 storage（错误类下沉 errors.mjs）；此处保持既有对外导出兼容
export { WorkbenchError }

const APPLICATION_ID = 0x4d4f4e42 // "MONB"
const USER_VERSION = 3
const DB_NAME = "workbench.db"
const BACKUP_KEEP = 7
const MAX_DIFF_CELLS = 4_000_000
const ASSET_CHUNK_BYTES = 1024 * 1024
// 各类型受支持的冻结表示管线版本（严格相等；未知未来版本明确失败，不重新解释历史，AC03）
const SUPPORTED_PIPELINES = {
  markdown: READING_PIPELINE_VERSION,
  board: BOARD_PIPELINE_VERSION,
  ui: UI_PIPELINE_VERSION,
}
// T04：keyset 分页游标（稳定排序键 created_at+id；base64url 传输格式）。ISO 时间戳定长，字典序可比。
const encodeKeysetCursor = (row) =>
  Buffer.from(JSON.stringify([row.createdAt, row.id]), "utf8").toString(
    "base64url"
  )
const decodeKeysetCursor = (cursor, label) => {
  if (cursor === undefined || cursor === null || cursor === "") return null
  if (typeof cursor !== "string")
    throw new WorkbenchError("validation_failed", `${label}游标无效。`)
  try {
    const [createdAt, id] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    )
    if (
      typeof createdAt !== "string" ||
      createdAt.length !== 24 ||
      Number.isNaN(Date.parse(createdAt)) ||
      typeof id !== "string" ||
      id.length < 1
    )
      throw new Error("游标字段无效")
    return { createdAt, id }
  } catch {
    throw new WorkbenchError("validation_failed", `${label}游标无效。`)
  }
}
/** 稳定键 keyset 条件（AC05）：首行入参后严格递增；prefix 绑定排序/谓词列的表归属，
 * JOIN 查询必须显式限定（否则 SQLite 报 ambiguous column name: id）。 */
const keysetPredicate = (prefix = "") =>
  `(${prefix}created_at > ? OR (${prefix}created_at = ? AND ${prefix}id > ?))`

const now = () => new Date().toISOString()
const assertText = (value, label, max) => {
  if (typeof value !== "string" || value.length < 1 || value.length > max)
    throw new WorkbenchError(
      "validation_failed",
      `${label}需为 1–${max} 字符文本。`
    )
  return value
}
const assertId = (value, label) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
  )
    throw new WorkbenchError("validation_failed", `${label}格式无效。`)
  return value
}
const assertKind = (value) => {
  if (!["markdown", "board", "ui"].includes(value))
    throw new WorkbenchError(
      "validation_failed",
      "草稿类型仅支持 markdown/board/ui。"
    )
  return value
}
/** 规范化 JSON（键序无关，递归；AC06）：请求输入签名与锚点比较统一使用。
 * 数组保持顺序；嵌套对象的每个层级都参与排序（PropertyList 形式的 replacer 只作用于
 * 根键名，会丢弃嵌套字段——禁止回退到该写法）。 */
const canonical = (value) => {
  if (value === null || value === undefined) return "null"
  if (typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`
}

/** Windows 对刚写入/新建的路径做瞬时 EPERM/EBUSY 锁定；有界重试属正确性机制，最终仍明确失败。 */
async function renameWithRetry(from, to, attempts = 4) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt))
    }
  }
  throw lastError
}

/** 复制前清单：路径、字节数、修改时间（元信息核对，不做哈希）；符号链接条目不支持。 */
async function manifestOf(dir, signal) {
  const entries = []
  const visit = async (prefix, current) => {
    for (const name of (await readdir(current)).sort()) {
      signal?.throwIfAborted()
      const file = join(current, name)
      const info = await lstat(file)
      if (info.isSymbolicLink())
        throw new WorkbenchError(
          "validation_failed",
          `不支持符号链接条目：${prefix}${name}`
        )
      if (info.isDirectory()) await visit(`${prefix}${name}/`, file)
      else
        entries.push({
          path: `${prefix}${name}`,
          size: info.size,
          mtimeMs: info.mtimeMs,
        })
    }
  }
  await visit("", dir)
  return entries
}

/** 封存前逐文件 fsync：句柄级持久化先于改名（发布协议第 3 步）。 */
async function syncTree(dir) {
  const walk = async (current) => {
    for (const name of await readdir(current)) {
      const file = join(current, name)
      const info = await lstat(file)
      if (info.isDirectory()) await walk(file)
      else {
        const handle = await open(file, "r+")
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
    }
  }
  await walk(dir)
}

export class WorkbenchStore {
  constructor(root) {
    this.root = root
    this.db = undefined
  }

  async open() {
    await mkdir(join(this.root, "staging"), { recursive: true })
    await mkdir(join(this.root, "artifacts"), { recursive: true })
    await mkdir(join(this.root, "backups"), { recursive: true })
    await mkdir(join(this.root, "recovery"), { recursive: true })
    const file = join(this.root, DB_NAME)
    // 区分「文件缺失（首次新建）」与「已存在但损坏」：零字节/坏头明确失败，原文件保留（Q08）
    let existingSize = null
    try {
      existingSize = (await stat(file)).size
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    if (existingSize === 0)
      throw new WorkbenchError(
        "storage_failure",
        "工作台库文件为空（已损坏），原文件保留。"
      )
    this.db = new DatabaseSync(file)
    try {
      // busy_timeout 先于 journal_mode：后者需要短暂独占锁（E1 教训）
      this.db.exec("PRAGMA busy_timeout = 5000;")
      const initialCheck = this.db.prepare("PRAGMA quick_check").get()
      if (initialCheck?.quick_check !== "ok")
        throw new WorkbenchError(
          "storage_failure",
          "工作台库健康检查未通过，原文件保留。"
        )
      // 库头校验：坏头明确失败，不静默当空库重建
      const applicationId = this.db
        .prepare("PRAGMA application_id")
        .get().application_id
      const userVersion = this.db
        .prepare("PRAGMA user_version")
        .get().user_version
      if (applicationId === 0 && userVersion === 0) {
        if (existingSize === null) {
          this.createSchema()
        } else {
          throw new WorkbenchError(
            "storage_failure",
            "工作台库存在未知表结构，原文件保留。"
          )
        }
      } else if (applicationId !== APPLICATION_ID) {
        throw new WorkbenchError(
          "storage_failure",
          "工作台库标识不符，原文件保留。"
        )
      } else if (userVersion === 1) {
        this.migrateV1ToV2()
        this.migrateV2ToV3()
      } else if (userVersion === 2) {
        this.migrateV2ToV3()
      } else if (userVersion !== USER_VERSION) {
        throw new WorkbenchError(
          "storage_failure",
          `工作台库版本 ${userVersion} 无法识别，原文件保留。`
        )
      }
      // 健康检查通过才允许启动并创建备份；坏库不轮转好恢复点（Q08）
      const check = this.db.prepare("PRAGMA quick_check").get()
      if (!check || check.quick_check !== "ok")
        throw new WorkbenchError(
          "storage_failure",
          `工作台库健康检查未通过：${check?.quick_check ?? "未知"}，原文件保留。`
        )
      this.db.exec("PRAGMA journal_mode = WAL;")
      await this.backupNow()
    } catch (error) {
      this.close()
      throw error
    }
  }

  createSchema() {
    this.db.exec(
      `PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${USER_VERSION};`
    )
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS write_receipts (
        request_key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        input_sig TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        actor_id TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS directories (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        parent_id TEXT REFERENCES directories(id), name TEXT NOT NULL,
        actor_id TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, archived_at TEXT,
        UNIQUE(project_id, parent_id, name)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS directories_root_name
        ON directories(project_id, name) WHERE parent_id IS NULL;
      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY, directory_id TEXT NOT NULL REFERENCES directories(id),
        kind TEXT NOT NULL CHECK(kind IN ('markdown','board','ui')), title TEXT NOT NULL,
        consensus_status TEXT NOT NULL DEFAULT 'discussing',
        review_revision INTEGER NOT NULL DEFAULT 0, metadata_revision INTEGER NOT NULL DEFAULT 0,
        actor_id TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('staged','sealed')), file_count INTEGER NOT NULL,
        total_bytes INTEGER NOT NULL, imported_by TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id), sequence INTEGER NOT NULL,
        artifact_id TEXT NOT NULL UNIQUE REFERENCES artifacts(id), base_sequence INTEGER NOT NULL,
        actor_id TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE, summary TEXT,
        created_at TEXT NOT NULL, UNIQUE(draft_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES drafts(id),
        version_id TEXT NOT NULL REFERENCES versions(id), author_actor TEXT NOT NULL,
        anchor TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','resolved')), created_at TEXT NOT NULL,
        resolved_at TEXT, resolved_by TEXT
      );
      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
        author_actor TEXT NOT NULL, body TEXT NOT NULL,
        related_version_id TEXT REFERENCES versions(id),
        request_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS status_events (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
        actor_id TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
        request_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
      );
    `)
  }

  /** v1 → v2 迁移：补齐锚点、导入者与请求身份列；历史线程锚点不可恢复，回填 unresolved 显式标注（不伪造）。 */
  migrateV1ToV2() {
    this.tx(() => {
      const addColumn = (table, ddl) => {
        const columns = this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name)
        if (!columns.includes(ddl.split(" ")[0]))
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
      }
      addColumn("projects", "actor_id TEXT NOT NULL DEFAULT 'legacy-import'")
      addColumn("projects", "request_key TEXT")
      addColumn("directories", "actor_id TEXT NOT NULL DEFAULT 'legacy-import'")
      addColumn("directories", "request_key TEXT")
      addColumn("drafts", "actor_id TEXT NOT NULL DEFAULT 'legacy-import'")
      addColumn("drafts", "request_key TEXT")
      addColumn(
        "artifacts",
        "imported_by TEXT NOT NULL DEFAULT 'legacy-import'"
      )
      addColumn("threads", "anchor TEXT")
      addColumn("status_events", "request_key TEXT")
      this.db.exec(
        "UPDATE projects SET request_key = 'migrated:' || id WHERE request_key IS NULL"
      )
      this.db.exec(
        "UPDATE directories SET request_key = 'migrated:' || id WHERE request_key IS NULL"
      )
      this.db.exec(
        "UPDATE drafts SET request_key = 'migrated:' || id WHERE request_key IS NULL"
      )
      this.db.exec(
        `UPDATE threads SET anchor = '{"kind":"unresolved"}' WHERE anchor IS NULL`
      )
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS projects_request_key_uq ON projects(request_key)"
      )
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS directories_request_key_uq ON directories(request_key)"
      )
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS drafts_request_key_uq ON drafts(request_key)"
      )
      this.db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS status_events_request_key_uq ON status_events(request_key)"
      )
      this.db.exec(`PRAGMA user_version = ${USER_VERSION};`)
    })
  }

  /** v2 → v3 迁移（AC06）：新增统一写回执表，并从既有实体行/事件行回填原始请求身份
   * 与原结果（签名按各操作原始输入字段构造），历史键重放语义与新增写完全一致。 */
  migrateV2ToV3() {
    this.tx(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS write_receipts (
          request_key TEXT PRIMARY KEY,
          operation TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          input_sig TEXT NOT NULL,
          result TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `)
      const put = (operation, actorId, targetId, input, result, createdAt) => {
        if (!input.requestKey) return
        this.db
          .prepare(
            "INSERT OR IGNORE INTO write_receipts (request_key, operation, actor_id, target_id, input_sig, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            input.requestKey,
            operation,
            actorId,
            targetId,
            canonical(input),
            JSON.stringify(result),
            createdAt
          )
      }
      for (const row of this.db
        .prepare(
          "SELECT id, name, actor_id, request_key, created_at FROM projects"
        )
        .all())
        if (row.request_key)
          put(
            "create_project",
            row.actor_id,
            row.id,
            { name: row.name, requestKey: row.request_key },
            { id: row.id, name: row.name },
            row.created_at
          )
      for (const row of this.db
        .prepare(
          "SELECT id, project_id, parent_id, name, actor_id, request_key, created_at FROM directories"
        )
        .all())
        if (row.request_key)
          put(
            "create_directory",
            row.actor_id,
            row.id,
            {
              projectId: row.project_id,
              parentId: row.parent_id ?? null,
              name: row.name,
              requestKey: row.request_key,
            },
            {
              id: row.id,
              projectId: row.project_id,
              parentId: row.parent_id ?? null,
              name: row.name,
            },
            row.created_at
          )
      for (const row of this.db
        .prepare(
          "SELECT id, directory_id, kind, title, actor_id, request_key, created_at FROM drafts"
        )
        .all())
        if (row.request_key)
          put(
            "create_draft",
            row.actor_id,
            row.id,
            {
              directoryId: row.directory_id,
              kind: row.kind,
              title: row.title,
              requestKey: row.request_key,
            },
            {
              id: row.id,
              directoryId: row.directory_id,
              kind: row.kind,
              title: row.title,
            },
            row.created_at
          )
      for (const row of this.db
        .prepare(
          "SELECT id, draft_id, sequence, base_sequence, artifact_id, actor_id, request_key, summary, created_at FROM versions"
        )
        .all())
        if (row.request_key)
          put(
            "publish_version",
            row.actor_id,
            row.id,
            {
              draftId: row.draft_id,
              baseSequence: row.base_sequence,
              artifactId: row.artifact_id,
              summary: row.summary ?? null,
              requestKey: row.request_key,
            },
            {
              versionId: row.id,
              sequence: row.sequence,
              artifactId: row.artifact_id,
            },
            row.created_at
          )
      for (const row of this.db
        .prepare(
          "SELECT r.id, r.thread_id, r.author_actor, r.body, r.related_version_id, r.request_key, r.created_at, t.version_id AS thread_version_id, t.anchor AS thread_anchor FROM replies r JOIN threads t ON t.id = r.thread_id"
        )
        .all()) {
        if (!row.request_key) continue
        let anchor
        try {
          anchor = JSON.parse(row.thread_anchor ?? "null")
        } catch {
          // 损坏锚点回填为 corrupt 语义（与读取侧一致），签名不含内容
          anchor = { kind: "corrupt" }
        }
        const firstReplyId = this.db
          .prepare(
            "SELECT id FROM replies WHERE thread_id = ? ORDER BY created_at, id LIMIT 1"
          )
          .get(row.thread_id)?.id
        if (row.id === firstReplyId)
          put(
            "create_thread",
            row.author_actor,
            row.thread_id,
            {
              versionId: row.thread_version_id,
              anchor,
              body: row.body,
              requestKey: row.request_key,
            },
            { threadId: row.thread_id, replyId: row.id, anchor },
            row.created_at
          )
        else
          put(
            "add_reply",
            row.author_actor,
            row.thread_id,
            {
              threadId: row.thread_id,
              body: row.body,
              relatedVersionId: row.related_version_id ?? null,
              requestKey: row.request_key,
            },
            { replyId: row.id },
            row.created_at
          )
      }
      for (const row of this.db
        .prepare(
          "SELECT thread_id, actor_id, to_status, request_key, created_at FROM status_events WHERE request_key IS NOT NULL"
        )
        .all())
        put(
          "set_thread_status",
          row.actor_id,
          row.thread_id,
          {
            threadId: row.thread_id,
            status: row.to_status,
            requestKey: row.request_key,
          },
          { threadId: row.thread_id, status: row.to_status, changed: true },
          row.created_at
        )
      this.db.exec(`PRAGMA user_version = ${USER_VERSION};`)
    })
  }

  /** AC06：统一写请求身份。同键+同作者+同输入签名 → 返回保存的原结果（replayed:true，
   * 不再执行，状态改变后旧请求也不会重新生效）；同键异输入/异作者 → 明确冲突。
   * 请求身份与原结果不可变保存，无状态变化（no-op）同样留痕。签名与变更在同一事务内落库。 */
  writeReceipt(operation, actorId, targetId, input, mutate) {
    const requestKey = input.requestKey
    assertText(requestKey, "requestKey", 128)
    const sig = canonical(input)
    // BEGIN IMMEDIATE 串行化：回执检查在事务内为权威判定，并发同键不会双重执行变更
    // AC06-二轮：replayed 标志来自事务内分支本身（重放=true、新执行=false），
    // 不得在末尾覆盖——此前恒写 false，重放语义错误。
    return this.tx(() => {
      const previous = this.readReceipt(operation, actorId, input, sig)
      if (previous) return previous
      const value = mutate()
      this.db
        .prepare(
          "INSERT INTO write_receipts (request_key, operation, actor_id, target_id, input_sig, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          requestKey,
          operation,
          actorId,
          targetId,
          sig,
          JSON.stringify(value),
          now()
        )
      return { ...value, replayed: false }
    })
  }

  readReceipt(operation, actorId, input, signature = canonical(input)) {
    const existing = this.db
      .prepare(
        "SELECT actor_id, operation, input_sig, result FROM write_receipts WHERE request_key = ?"
      )
      .get(input.requestKey)
    if (!existing) return null
    if (
      existing.actor_id !== actorId ||
      existing.operation !== operation ||
      existing.input_sig !== signature
    )
      throw new WorkbenchError(
        "request_key_conflict",
        "同 requestKey 但输入或作者不同。"
      )
    return { ...JSON.parse(existing.result), replayed: true }
  }

  close() {
    this.db?.close()
    this.db = undefined
  }

  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = fn()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      try {
        // SQLite can already have rolled back after a storage error.
        if (this.db.isTransaction) this.db.exec("ROLLBACK")
      } catch (rollbackError) {
        const causes = [error, rollbackError]
        try {
          this.close()
        } catch (closeError) {
          causes.push(closeError)
          this.db = undefined
        }
        const failure = new WorkbenchError(
          "storage_failure",
          "事务回滚失败，工作台存储连接已停止使用；请检查磁盘并重新启动。"
        )
        failure.cause = new AggregateError(
          causes,
          "Transaction and rollback failed"
        )
        throw failure
      }
      throw error
    }
  }

  /** 启动/维护用一致性备份：先验健康再落盘；保留最近 7 份，失败明确报错不静默。 */
  async backupNow() {
    const check = this.db.prepare("PRAGMA quick_check").get()
    if (!check || check.quick_check !== "ok")
      throw new WorkbenchError(
        "storage_failure",
        `库健康检查未通过，拒绝创建备份：${check?.quick_check ?? "未知"}`
      )
    const backupId = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const dir = join(this.root, "backups", backupId)
    const pendingDir = `${dir}.pending`
    try {
      await mkdir(pendingDir, { recursive: true })
      await sqliteBackup(this.db, join(pendingDir, DB_NAME))
      await syncTree(pendingDir)
      await renameWithRetry(pendingDir, dir)
    } catch (error) {
      const failures = [error]
      try {
        await rm(pendingDir, { recursive: true, force: true })
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
      if (failures.length > 1)
        throw new AggregateError(
          failures,
          "备份写入失败，未完成目录清理失败；已有恢复点保持不变。",
          { cause: error }
        )
      throw error
    }
    // 中断残留及坏备份不能计入七份有效恢复点预算，也不能据此淘汰好备份。
    const dirs = []
    for (const name of (await readdir(join(this.root, "backups"))).sort()) {
      if (!/^\d+-[a-f0-9]{8}$/.test(name)) continue
      let probe
      try {
        probe = new DatabaseSync(join(this.root, "backups", name, DB_NAME), {
          readOnly: true,
        })
        if (
          probe.prepare("PRAGMA application_id").get().application_id ===
            APPLICATION_ID &&
          probe.prepare("PRAGMA quick_check").get().quick_check === "ok"
        )
          dirs.push(name)
      } catch {
        // 无法确认的恢复点原样保留，不把它算作有效备份或自动删除。
      } finally {
        probe?.close()
      }
    }
    for (const oldest of dirs.slice(0, Math.max(0, dirs.length - BACKUP_KEEP)))
      await rm(join(this.root, "backups", oldest), {
        recursive: true,
        force: true,
      })
    return backupId
  }

  /** 从恢复点恢复（须先 close）：备份先验健康；当前库连同 WAL/SHM 移入恢复隔离区，不删除。 */
  static async restoreFromBackup(root, backupId) {
    assertId(backupId, "备份标识")
    const backupFile = join(root, "backups", backupId, DB_NAME)
    let probe
    try {
      const rootPath = await realpath(root)
      const backupPath = await realpath(backupFile)
      const inside = relative(join(rootPath, "backups"), backupPath)
      if (inside.startsWith("..") || isAbsolute(inside))
        throw new WorkbenchError(
          "storage_failure",
          "备份路径越界，已保留原状。"
        )
      probe = new DatabaseSync(backupFile, { readOnly: true })
    } catch (error) {
      throw new WorkbenchError(
        "storage_failure",
        `备份无法打开，已保留原状。`,
        { cause: error }
      )
    }
    try {
      const applicationId = probe
        .prepare("PRAGMA application_id")
        .get().application_id
      const version = probe.prepare("PRAGMA user_version").get().user_version
      const check = probe.prepare("PRAGMA quick_check").get()
      if (
        applicationId !== APPLICATION_ID ||
        version !== USER_VERSION ||
        !check ||
        check.quick_check !== "ok"
      )
        throw new WorkbenchError(
          "storage_failure",
          "备份健康检查未通过，已保留原状。"
        )
    } finally {
      probe.close()
    }
    // 先准备并持久化完整替换文件，磁盘满/复制失败不得移动当前库。
    const prepared = join(root, `.restore-${randomUUID()}.db`)
    try {
      await copyFile(backupFile, prepared)
      const handle = await open(prepared, "r+")
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error) {
      const failures = [error]
      try {
        await rm(prepared, { force: true })
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
      if (failures.length > 1)
        throw new AggregateError(
          failures,
          "恢复准备失败，临时文件清理失败；当前库未移动。",
          { cause: error }
        )
      throw error
    }
    const recoveryId = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const recoveryDir = join(root, "recovery", recoveryId)
    const current = join(root, DB_NAME)
    const moved = []
    try {
      await mkdir(recoveryDir, { recursive: true })
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          await fsRename(
            `${current}${suffix}`,
            join(recoveryDir, `${DB_NAME}${suffix}`)
          )
          moved.push(suffix)
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
      }
      await fsRename(prepared, current)
    } catch (error) {
      const failures = [error]
      for (const suffix of moved.reverse()) {
        try {
          await fsRename(
            join(recoveryDir, `${DB_NAME}${suffix}`),
            `${current}${suffix}`
          )
        } catch (rollbackError) {
          failures.push(rollbackError)
        }
      }
      try {
        await rm(prepared, { force: true })
      } catch (cleanupError) {
        failures.push(cleanupError)
      }
      if (failures.length > 1)
        throw new AggregateError(
          failures,
          `恢复失败，原库保留于当前路径或恢复隔离区 ${recoveryId}，需检查后重试。`,
          { cause: error }
        )
      throw error
    }
    return { recoveryId }
  }

  // ---- 项目 / 目录 / 草稿 ----

  createProject(name, actorId, requestKey) {
    assertText(name, "项目名", 64)
    assertText(actorId, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    // AC06-二轮：创建重放走统一回执（原始输入；实体可变字段不再参与比对）
    return this.writeReceipt(
      "create_project",
      actorId,
      "",
      { name, requestKey },
      () => {
        const id = randomUUID()
        this.db
          .prepare(
            "INSERT INTO projects (id, name, actor_id, request_key, created_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(id, name, actorId, requestKey, now())
        return { id, name }
      }
    )
  }

  listProjects(cursor, limit = 50, { archived = false } = {}) {
    const key = decodeKeysetCursor(cursor, "项目分页")
    const scope = `archived_at IS ${archived ? "NOT " : ""}NULL`
    const rows = key
      ? this.db
          .prepare(
            `SELECT id, name, created_at AS createdAt, archived_at AS archivedAt FROM projects WHERE projects.${scope} AND ${keysetPredicate("projects.")} ORDER BY projects.created_at, projects.id LIMIT ?`
          )
          .all(key.createdAt, key.createdAt, key.id, limit + 1)
      : this.db
          .prepare(
            `SELECT id, name, created_at AS createdAt, archived_at AS archivedAt FROM projects WHERE projects.${scope} ORDER BY projects.created_at, projects.id LIMIT ?`
          )
          .all(limit + 1)
    const complete = rows.length <= limit
    const items = complete ? rows : rows.slice(0, limit)
    return {
      items,
      complete,
      nextCursor:
        complete || items.length === 0
          ? null
          : encodeKeysetCursor(items[items.length - 1]),
    }
  }

  updateProject(projectId, { name, archived }, actorId, requestKey) {
    assertId(projectId, "项目标识")
    assertText(actorId, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    if (name !== undefined) assertText(name, "项目名", 64)
    // AC06：实体行 request_key 仅保存创建身份；更新走统一写回执
    return this.writeReceipt(
      "update_project",
      actorId,
      projectId,
      { projectId, name: name ?? null, archived: archived ?? null, requestKey },
      () => {
        const current = this.db
          .prepare("SELECT id, name, archived_at FROM projects WHERE id = ?")
          .get(projectId)
        if (!current) throw new WorkbenchError("not_found", "项目不存在。")
        const nextName = name ?? current.name
        const nextArchived =
          archived === undefined
            ? current.archived_at !== null
            : archived === true
        this.db
          .prepare("UPDATE projects SET name = ?, archived_at = ? WHERE id = ?")
          .run(
            nextName,
            nextArchived ? (current.archived_at ?? now()) : null,
            projectId
          )
        return { id: projectId, name: nextName, archived: nextArchived }
      }
    )
  }

  createDirectory(projectId, parentId, name, actorId, requestKey) {
    assertId(projectId, "项目标识")
    assertText(name, "目录名", 64)
    assertText(actorId, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    // AC06-二轮：创建重放走统一回执；实体 UNIQUE（同级同名）按明确分类抛出
    try {
      return this.writeReceipt(
        "create_directory",
        actorId,
        "",
        { projectId, parentId: parentId ?? null, name, requestKey },
        () => {
          if (
            !this.db
              .prepare(
                "SELECT id FROM projects WHERE id = ? AND archived_at IS NULL"
              )
              .get(projectId)
          )
            throw new WorkbenchError("not_found", "项目不存在或已归档。")
          if (parentId != null) {
            const parent = this.db
              .prepare(
                "SELECT id, project_id FROM directories WHERE id = ? AND archived_at IS NULL"
              )
              .get(parentId)
            if (!parent)
              throw new WorkbenchError("not_found", "父目录不存在或已归档。")
            if (parent.project_id !== projectId)
              throw new WorkbenchError(
                "validation_failed",
                "父目录属于其他项目。"
              )
            if (parentId === projectId)
              throw new WorkbenchError("validation_failed", "父目录无效。")
          }
          const id = randomUUID()
          this.db
            .prepare(
              "INSERT INTO directories (id, project_id, parent_id, name, actor_id, request_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
              id,
              projectId,
              parentId ?? null,
              name,
              actorId,
              requestKey,
              now()
            )
          return { id, projectId, parentId: parentId ?? null, name }
        }
      )
    } catch (error) {
      if (String(error.message).includes("UNIQUE"))
        throw new WorkbenchError("validation_failed", "同级目录名已存在。")
      throw error
    }
  }

  listDirectories(projectId, cursor, limit = 50, { archived = false } = {}) {
    assertId(projectId, "项目标识")
    const key = decodeKeysetCursor(cursor, "目录分页")
    const scope = `archived_at IS ${archived ? "NOT " : ""}NULL`
    const rows = key
      ? this.db
          .prepare(
            `SELECT id, project_id AS projectId, parent_id AS parentId, name, created_at AS createdAt, archived_at AS archivedAt FROM directories WHERE directories.project_id = ? AND directories.${scope} AND ${keysetPredicate("directories.")} ORDER BY directories.created_at, directories.id LIMIT ?`
          )
          .all(projectId, key.createdAt, key.createdAt, key.id, limit + 1)
      : this.db
          .prepare(
            `SELECT id, project_id AS projectId, parent_id AS parentId, name, created_at AS createdAt, archived_at AS archivedAt FROM directories WHERE directories.project_id = ? AND directories.${scope} ORDER BY directories.created_at, directories.id LIMIT ?`
          )
          .all(projectId, limit + 1)
    const complete = rows.length <= limit
    const items = complete ? rows : rows.slice(0, limit)
    return {
      items,
      complete,
      nextCursor:
        complete || items.length === 0
          ? null
          : encodeKeysetCursor(items[items.length - 1]),
    }
  }

  updateDirectory(
    directoryId,
    { name, parentId, archived },
    actorId,
    requestKey
  ) {
    assertId(directoryId, "目录标识")
    assertText(actorId, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    if (name !== undefined) assertText(name, "目录名", 64)
    if (parentId !== undefined && parentId !== null)
      assertId(parentId, "父目录标识")
    // AC06：实体行 request_key 仅保存创建身份；更新走统一写回执
    try {
      return this.writeReceipt(
        "update_directory",
        actorId,
        directoryId,
        {
          directoryId,
          ...(parentId === undefined ? {} : { parentId }),
          name: name ?? null,
          archived: archived ?? null,
          requestKey,
        },
        () => {
          const current = this.db
            .prepare(
              "SELECT id, project_id, parent_id, name, archived_at FROM directories WHERE id = ?"
            )
            .get(directoryId)
          if (!current) throw new WorkbenchError("not_found", "目录不存在。")
          const nextName = name ?? current.name
          const nextParentId =
            parentId === undefined ? current.parent_id : parentId
          const nextArchived =
            archived === undefined
              ? current.archived_at !== null
              : archived === true
          if (nextParentId !== null) {
            if (nextParentId === directoryId)
              throw new WorkbenchError(
                "validation_failed",
                "父目录不能是自身。"
              )
            // AC07：首查即含 parent_id（此前缺失导致祖先链只走一层，D→C→G 环被接受）
            const parent = this.db
              .prepare(
                "SELECT id, project_id, parent_id FROM directories WHERE id = ?"
              )
              .get(nextParentId)
            if (!parent || parent.project_id !== current.project_id)
              throw new WorkbenchError(
                "validation_failed",
                "父目录无效或属于其他项目。"
              )
            // 目录环禁止：新父目录不得是本目录的后代；沿新父链完整回溯到根，命中自身即环；
            // 已有异常环（祖先链重复访问）同样拒绝本次写入，不扩大损坏
            let ancestor = parent
            const visited = new Set()
            while (ancestor) {
              if (ancestor.id === directoryId)
                throw new WorkbenchError(
                  "validation_failed",
                  "移动目标在自身子树内，会产生目录环。"
                )
              if (visited.has(ancestor.id))
                throw new WorkbenchError(
                  "validation_failed",
                  "目录祖先链已存在环，已拒绝本次写入；请先修复目录结构。"
                )
              visited.add(ancestor.id)
              ancestor = ancestor.parent_id
                ? this.db
                    .prepare(
                      "SELECT id, parent_id FROM directories WHERE id = ?"
                    )
                    .get(ancestor.parent_id)
                : null
            }
          }
          this.db
            .prepare(
              "UPDATE directories SET parent_id = ?, name = ?, archived_at = ? WHERE id = ?"
            )
            .run(
              nextParentId,
              nextName,
              nextArchived ? (current.archived_at ?? now()) : null,
              directoryId
            )
          return {
            id: directoryId,
            projectId: current.project_id,
            parentId: nextParentId,
            name: nextName,
            archived: nextArchived,
          }
        }
      )
    } catch (error) {
      if (String(error.message).includes("UNIQUE"))
        throw new WorkbenchError("validation_failed", "同级目录名已存在。")
      throw error
    }
  }

  createDraft(directoryId, kind, title, actorId, requestKey) {
    assertId(directoryId, "目录标识")
    assertKind(kind)
    assertText(title, "草稿标题", 120)
    assertText(actorId, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    // AC06-二轮：创建重放走统一回执（原始输入；实体 title 更新后重试不再冲突）
    return this.writeReceipt(
      "create_draft",
      actorId,
      "",
      { directoryId, kind, title, requestKey },
      () => {
        const directory = this.db
          .prepare(
            "SELECT id, project_id FROM directories WHERE id = ? AND archived_at IS NULL"
          )
          .get(directoryId)
        if (!directory)
          throw new WorkbenchError("not_found", "目录不存在或已归档。")
        const id = randomUUID()
        const stamp = now()
        this.db
          .prepare(
            "INSERT INTO drafts (id, directory_id, kind, title, review_revision, metadata_revision, actor_id, request_key, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)"
          )
          .run(id, directoryId, kind, title, actorId, requestKey, stamp, stamp)
        return { id, directoryId, projectId: directory.project_id, kind, title }
      }
    )
  }

  listDrafts({ projectId, kind, archived = false } = {}, cursor, limit = 50) {
    if (kind !== undefined) assertKind(kind)
    const key = decodeKeysetCursor(cursor, "草稿分页")
    const keysetFilter = key ? ` AND ${keysetPredicate("d.")}` : ""
    const keysetParams = key ? [key.createdAt, key.createdAt, key.id] : []
    const rows = this.db
      .prepare(
        `SELECT d.id, d.directory_id AS directoryId, d.kind, d.title, d.consensus_status AS consensusStatus, d.review_revision AS reviewRevision,
                d.metadata_revision AS metadataRevision, d.created_at AS createdAt, d.updated_at AS updatedAt,
                d.archived_at AS archivedAt, p.id AS projectId
         FROM drafts d JOIN directories dir ON dir.id = d.directory_id
         JOIN projects p ON p.id = dir.project_id
         WHERE (? IS NULL OR p.id = ?) AND (? IS NULL OR d.kind = ?)
           AND (
             d.archived_at IS NOT NULL
             OR p.archived_at IS NOT NULL
             OR EXISTS (
               WITH RECURSIVE up(id, parent_id) AS (
                 SELECT dir.id, dir.parent_id FROM directories dir WHERE dir.id = d.directory_id
                 UNION ALL
                 SELECT dd.id, dd.parent_id FROM directories dd JOIN up ON dd.id = up.parent_id
               )
               SELECT 1 FROM up JOIN directories dd2 ON dd2.id = up.id WHERE dd2.archived_at IS NOT NULL
             )
           ) = (? = 1)${keysetFilter}
         ORDER BY d.created_at, d.id LIMIT ?`
      )
      .all(
        projectId ?? null,
        projectId ?? null,
        kind ?? null,
        kind ?? null,
        archived ? 1 : 0,
        ...keysetParams,
        limit + 1
      )
    const complete = rows.length <= limit
    const items = complete ? rows : rows.slice(0, limit)
    return {
      items,
      complete,
      nextCursor:
        complete || items.length === 0
          ? null
          : encodeKeysetCursor(items[items.length - 1]),
    }
  }

  updateDraft(
    draftId,
    { title, directoryId, archived, consensusStatus },
    actorId,
    requestKey,
    expectedMetadataRevision
  ) {
    assertId(draftId, "草稿标识")
    assertText(actorId, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    if (title !== undefined) assertText(title, "草稿标题", 120)
    if (directoryId !== undefined) assertId(directoryId, "目录标识")
    if (
      consensusStatus !== undefined &&
      !["discussing", "pending_confirm", "agreed"].includes(consensusStatus)
    )
      throw new WorkbenchError("validation_failed", "共识状态无效。")
    return this.writeReceipt(
      "update_draft",
      actorId,
      draftId,
      {
        draftId,
        title: title ?? null,
        directoryId: directoryId ?? null,
        archived: archived ?? null,
        ...(consensusStatus !== undefined ? { consensusStatus } : {}),
        expectedMetadataRevision: Number.isSafeInteger(expectedMetadataRevision)
          ? expectedMetadataRevision
          : null,
        requestKey,
      },
      () => {
        const current = this.db
          .prepare(
            "SELECT id, directory_id, kind, title, consensus_status, metadata_revision, archived_at FROM drafts WHERE id = ?"
          )
          .get(draftId)
        if (!current) throw new WorkbenchError("not_found", "草稿不存在。")
        const nextTitle = title ?? current.title
        const nextDirectoryId = directoryId ?? current.directory_id
        const nextConsensusStatus = consensusStatus ?? current.consensus_status
        const nextArchived =
          archived === undefined
            ? current.archived_at !== null
            : archived === true
        // 并发覆盖保护：携带过期 metadata_revision 明确冲突，不静默覆盖。
        // AC06：回执重放先于 CAS——同键请求已执行过即返回原结果，不因他人后续修改转为冲突。
        if (nextDirectoryId !== current.directory_id) {
          const directory = this.db
            .prepare(
              "SELECT id, project_id FROM directories WHERE id = ? AND archived_at IS NULL"
            )
            .get(nextDirectoryId)
          if (!directory)
            throw new WorkbenchError("not_found", "目标目录不存在或已归档。")
        }
        if (
          Number.isSafeInteger(expectedMetadataRevision) &&
          expectedMetadataRevision !== current.metadata_revision
        )
          throw new WorkbenchError(
            "metadata_revision_conflict",
            "草稿元数据已被他人修改，请重新读取后重试。"
          )
        this.db
          .prepare(
            "UPDATE drafts SET title = ?, directory_id = ?, consensus_status = ?, archived_at = ?, metadata_revision = metadata_revision + 1, updated_at = ? WHERE id = ?"
          )
          .run(
            nextTitle,
            nextDirectoryId,
            nextConsensusStatus,
            nextArchived ? (current.archived_at ?? now()) : null,
            now(),
            draftId
          )
        const after = this.db
          .prepare(
            "SELECT id, title, directory_id AS directoryId, consensus_status AS consensusStatus, metadata_revision AS metadataRevision, archived_at FROM drafts WHERE id = ?"
          )
          .get(draftId)
        return {
          id: draftId,
          title: after.title,
          directoryId: after.directoryId,
          consensusStatus: after.consensusStatus,
          archived: after.archived_at !== null,
          metadataRevision: after.metadataRevision,
        }
      }
    )
  }

  draft(id) {
    assertId(id, "草稿标识")
    const row = this.db
      .prepare(
        "SELECT id, directory_id AS directoryId, kind, title, consensus_status AS consensusStatus, review_revision AS reviewRevision, metadata_revision AS metadataRevision, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt FROM drafts WHERE id = ?"
      )
      .get(id)
    if (!row) throw new WorkbenchError("not_found", "草稿不存在。")
    return row
  }

  draftReference(id) {
    const draft = this.draft(id)
    const directory = this.db
      .prepare("SELECT project_id AS projectId FROM directories WHERE id = ?")
      .get(draft.directoryId)
    if (!directory)
      throw new WorkbenchError("storage_failure", "草稿所属目录不存在。")
    return {
      projectId: directory.projectId,
      draftId: draft.id,
      title: draft.title,
    }
  }

  // ---- 导入与发布 ----

  /** stage_package：源目录 → 类型校验 → 清单核对 → 复制（可取消）→ 派生冻结表示 → 逐文件 sync → 同卷改名封存。 */
  async stagePackage(sourceDir, kind, actorId, { signal } = {}) {
    assertKind(kind)
    assertText(actorId, "actor", 64)
    const reader = readerFor(kind)
    const stagingId = randomUUID()
    const stagingDir = join(this.root, "staging", stagingId)
    await mkdir(stagingDir, { recursive: true })
    try {
      signal?.throwIfAborted()
      const entries = await manifestOf(sourceDir, signal)
      if (entries.length === 0)
        throw new WorkbenchError("validation_failed", "源目录为空，无法导入。")
      if (entries.length > 2000)
        throw new WorkbenchError(
          "limit_exceeded",
          `单包文件数超过 2000（实际 ${entries.length}）。`
        )
      reader.validateEntries(entries)
      let totalBytes = 0
      for (const entry of entries) {
        if (entry.size > 50 * 1024 * 1024)
          throw new WorkbenchError(
            "limit_exceeded",
            `单文件超过 50MiB：${entry.path}`
          )
        totalBytes += entry.size
      }
      if (totalBytes > 200 * 1024 * 1024)
        throw new WorkbenchError(
          "limit_exceeded",
          `单包超过 200MiB（实际 ${Math.round(totalBytes / 1048576)}MiB）。`
        )
      for (const entry of entries) {
        // 逐文件消费取消：取消的导入不得封存半包（Q10）
        signal?.throwIfAborted()
        const from = join(sourceDir, entry.path)
        const to = join(stagingDir, entry.path)
        await mkdir(dirname(to), { recursive: true })
        await copyFile(from, to)
      }
      // 类型派生（markdown 冻结阅读表示），随后以 staging 实际内容为准复核清单与上限
      await reader.derive(stagingDir)
      const sealedEntries = await manifestOf(stagingDir)
      if (sealedEntries.length > 2000)
        throw new WorkbenchError(
          "limit_exceeded",
          `单包文件数超过 2000（实际 ${sealedEntries.length}）。`
        )
      let sealedBytes = 0
      for (const entry of sealedEntries) {
        if (entry.size > 50 * 1024 * 1024)
          throw new WorkbenchError(
            "limit_exceeded",
            `单文件超过 50MiB：${entry.path}`
          )
        sealedBytes += entry.size
      }
      if (sealedBytes > 200 * 1024 * 1024)
        throw new WorkbenchError(
          "limit_exceeded",
          `单包超过 200MiB（实际 ${Math.round(sealedBytes / 1048576)}MiB）。`
        )
      // 复制期间源变化核对（元信息，不做哈希）
      const after = await manifestOf(sourceDir, signal)
      if (JSON.stringify(entries) !== JSON.stringify(after))
        throw new WorkbenchError(
          "validation_failed",
          "源文件在导入期间发生变化，已拒绝导入。"
        )
      await syncTree(stagingDir)
      const artifactId = randomUUID()
      const artifactDir = join(this.root, "artifacts", artifactId)
      await renameWithRetry(stagingDir, artifactDir)
      this.tx(() => {
        this.db
          .prepare(
            "INSERT INTO artifacts (id, kind, path, state, file_count, total_bytes, imported_by, created_at) VALUES (?, ?, ?, 'sealed', ?, ?, ?, ?)"
          )
          .run(
            artifactId,
            kind,
            artifactDir,
            sealedEntries.length,
            sealedBytes,
            actorId,
            now()
          )
      })
      return {
        artifactId,
        kind,
        fileCount: sealedEntries.length,
        totalBytes: sealedBytes,
      }
    } catch (error) {
      try {
        await rm(stagingDir, { recursive: true, force: true })
      } catch (cleanupError) {
        const failure = new WorkbenchError(
          "storage_failure",
          "导入失败且暂存清理未完成，请检查本地存储权限或可用空间。"
        )
        failure.cause = new AggregateError(
          [error, cleanupError],
          "Import and staging cleanup failed"
        )
        throw failure
      }
      throw error
    }
  }

  /** publish_version：重放核对（完整输入签名含 actor 与 artifactId）先于 base CAS；唯一事务建版本。 */
  publishVersion(
    { draftId, baseSequence, artifactId, requestKey, summary },
    actorId,
    inlineInput = undefined
  ) {
    assertId(draftId, "草稿标识")
    assertText(actorId, "actor", 64)
    if (!Number.isSafeInteger(baseSequence) || baseSequence < 0)
      throw new WorkbenchError(
        "validation_failed",
        "baseSequence 需为非负整数。"
      )
    assertId(artifactId, "产物标识")
    assertText(requestKey, "requestKey", 128)
    if (
      summary !== undefined &&
      summary !== null &&
      (typeof summary !== "string" || summary.length > 2000)
    )
      throw new WorkbenchError(
        "validation_failed",
        "summary 需为不超过 2000 字符文本。"
      )
    // AC06-三轮：请求身份先于可变产物绑定与 CAS 判断——重放路径必须可达；
    // 产物存在/封存/绑定/草稿归档/类型匹配等可变检查全部位于回执 mutate 内。
    const receipt = this.writeReceipt(
      inlineInput ? "publish_inline" : "publish_version",
      actorId,
      draftId,
      inlineInput ?? {
        draftId,
        baseSequence,
        artifactId,
        summary: summary ?? null,
        requestKey,
      },
      () => {
        const artifact = this.db
          .prepare("SELECT id, kind, state FROM artifacts WHERE id = ?")
          .get(artifactId)
        if (!artifact) throw new WorkbenchError("not_found", "产物不存在。")
        if (artifact.state !== "sealed")
          throw new WorkbenchError(
            "validation_failed",
            "产物未封存，不能发布。"
          )
        if (
          this.db
            .prepare("SELECT id FROM versions WHERE artifact_id = ?")
            .get(artifactId)
        )
          throw new WorkbenchError(
            "validation_failed",
            "该产物已绑定其他版本。"
          )
        const draft = this.draft(draftId)
        if (draft.archivedAt)
          throw new WorkbenchError("archived", "草稿已归档。")
        if (draft.kind !== artifact.kind)
          throw new WorkbenchError(
            "validation_failed",
            "产物类型与草稿类型不符。"
          )
        // CAS：latest 即当前最大 sequence（版本表派生，无独立 latest 表）
        const latest =
          this.db
            .prepare(
              "SELECT MAX(sequence) AS m FROM versions WHERE draft_id = ?"
            )
            .get(draftId).m ?? 0
        if (baseSequence !== latest)
          throw new WorkbenchError(
            "version_conflict",
            `baseSequence 过期：当前 ${latest}，请求 ${baseSequence}`
          )
        const sequence = latest + 1
        const versionId = randomUUID()
        this.db
          .prepare(
            "INSERT INTO versions (id, draft_id, sequence, artifact_id, base_sequence, actor_id, request_key, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            versionId,
            draftId,
            sequence,
            artifactId,
            baseSequence,
            actorId,
            requestKey,
            summary ?? null,
            now()
          )
        this.db
          .prepare(
            "UPDATE drafts SET review_revision = review_revision + 1, updated_at = ? WHERE id = ?"
          )
          .run(now(), draftId)
        return { versionId, sequence, artifactId }
      }
    )
    return receipt
  }

  async discardUnpublishedArtifact(artifactId) {
    const artifact = this.db
      .prepare(
        `DELETE FROM artifacts WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM versions WHERE artifact_id = ?)
         RETURNING path`
      )
      .get(artifactId, artifactId)
    if (artifact) await rm(artifact.path, { recursive: true, force: true })
  }

  // ---- 版本读取 / 比较 ----

  listVersions(draftId, cursor, limit = 50) {
    assertId(draftId, "草稿标识")
    const seq = cursor === undefined || cursor === null ? null : Number(cursor)
    const rows =
      seq === null
        ? this.db
            .prepare(
              "SELECT id, sequence, artifact_id AS artifactId, actor_id AS actorId, summary, created_at AS createdAt FROM versions WHERE draft_id = ? ORDER BY sequence DESC LIMIT ?"
            )
            .all(draftId, limit + 1)
        : this.db
            .prepare(
              "SELECT id, sequence, artifact_id AS artifactId, actor_id AS actorId, summary, created_at AS createdAt FROM versions WHERE draft_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?"
            )
            .all(draftId, seq, limit + 1)
    const complete = rows.length <= limit
    const items = complete ? rows : rows.slice(0, limit)
    return {
      items,
      complete,
      nextCursor: complete ? null : items[items.length - 1].sequence,
    }
  }

  version(id) {
    assertId(id, "版本标识")
    const row = this.db
      .prepare(
        "SELECT id, draft_id AS draftId, sequence, artifact_id AS artifactId, base_sequence AS baseSequence, actor_id AS actorId, summary, created_at AS createdAt FROM versions WHERE id = ?"
      )
      .get(id)
    if (!row) throw new WorkbenchError("not_found", "版本不存在。")
    return row
  }

  /** AC03：三类版本共用的冻结表示读取入口（read_version/compare/create_thread/
   * list_targets/预览会话的唯一实现）。校验链：产物存在 → .moon/reading.json 可解析 →
   * 类型与草稿一致（markdown 历史 reading 无 kind 字段，按缺省 markdown 处理）→
   * 入口有效 → 管线版本严格等于受支持值（未知未来版本明确失败，不重新解释历史）。 */
  async readVersionContent(versionId) {
    const version = this.version(versionId)
    const draft = this.draft(version.draftId)
    const path = this.versionArtifactPath(versionId)
    if (!path) throw new WorkbenchError("not_found", "版本产物缺失。")
    let reading
    try {
      reading = JSON.parse(
        await readFile(join(path, ".moon", "reading.json"), "utf8")
      )
    } catch {
      throw new WorkbenchError(
        "storage_failure",
        "版本冻结阅读表示缺失或损坏。"
      )
    }
    if (!reading || typeof reading !== "object" || Array.isArray(reading))
      throw new WorkbenchError("storage_failure", "版本冻结阅读表示无效。")
    if ((reading.kind ?? "markdown") !== draft.kind)
      throw new WorkbenchError(
        "storage_failure",
        "版本冻结阅读表示类型与草稿不符。"
      )
    if (typeof reading.entry !== "string" || reading.entry.length < 1)
      throw new WorkbenchError("storage_failure", "版本冻结阅读表示入口无效。")
    const supported = SUPPORTED_PIPELINES[draft.kind]
    if (reading.pipeline !== supported)
      throw new WorkbenchError(
        "storage_failure",
        `冻结阅读表示管线版本不支持：${String(reading.pipeline)}（当前支持 ${supported}）。`
      )
    // AC03-三轮：按冻结 schema 校验完整成员/关系（null 成员、悬空端点、坏索引均拒绝）；
    // 入口与资源统一安全路径边界（../ 逃逸至产物目录外明确失败）；空成功被禁止。
    if (draft.kind === "markdown") {
      if (!Array.isArray(reading.blocks))
        throw new WorkbenchError(
          "storage_failure",
          "冻结阅读表示无效：缺块投影。"
        )
      reading.blocks.forEach((block, index) => {
        if (
          !block ||
          typeof block !== "object" ||
          block.index !== index ||
          typeof block.type !== "string" ||
          typeof block.text !== "string" ||
          typeof block.html !== "string"
        )
          throw new WorkbenchError(
            "storage_failure",
            "冻结阅读表示无效：块投影成员损坏。"
          )
      })
    }
    if (draft.kind === "board") {
      const canvas = reading.canvas
      if (
        !canvas ||
        typeof canvas !== "object" ||
        !Array.isArray(canvas.nodes) ||
        !Array.isArray(canvas.edges) ||
        canvas.nodes.length === 0
      )
        throw new WorkbenchError(
          "storage_failure",
          "冻结阅读表示无效：画布结构缺失。"
        )
      const nodeIds = new Set()
      for (const node of canvas.nodes) {
        if (
          !node ||
          typeof node !== "object" ||
          typeof node.id !== "string" ||
          node.id.length < 1 ||
          node.id.length > 128 ||
          !Number.isFinite(node.x) ||
          !Number.isFinite(node.y) ||
          !Number.isFinite(node.width) ||
          !Number.isFinite(node.height) ||
          (node.type !== undefined &&
            node.type !== "text" &&
            node.type !== "group") ||
          typeof node.text !== "string"
        )
          throw new WorkbenchError(
            "storage_failure",
            "冻结阅读表示无效：画布节点成员损坏。"
          )
        if (nodeIds.has(node.id))
          throw new WorkbenchError(
            "storage_failure",
            "冻结阅读表示无效：画布节点 id 重复。"
          )
        nodeIds.add(node.id)
      }
      const edgeIds = new Set()
      for (const edge of canvas.edges) {
        if (
          !edge ||
          typeof edge !== "object" ||
          typeof edge.id !== "string" ||
          edge.id.length < 1 ||
          edge.id.length > 128 ||
          typeof edge.from !== "string" ||
          typeof edge.to !== "string" ||
          !nodeIds.has(edge.from) ||
          !nodeIds.has(edge.to)
        )
          throw new WorkbenchError(
            "storage_failure",
            "冻结阅读表示无效：画布连线成员或端点损坏。"
          )
        // AC03-四轮：连线 id 唯一性（重复 id 使评论/渲染身份歧义）
        if (edgeIds.has(edge.id) || nodeIds.has(edge.id))
          throw new WorkbenchError(
            "storage_failure",
            "冻结阅读表示无效：画布连线 id 重复。"
          )
        edgeIds.add(edge.id)
      }
    }
    if (draft.kind === "ui") {
      const routes = reading.manifest?.routes
      if (
        !reading.manifest ||
        typeof reading.manifest !== "object" ||
        !routes ||
        typeof routes !== "object" ||
        Array.isArray(routes)
      )
        throw new WorkbenchError(
          "storage_failure",
          "冻结阅读表示无效：路由清单缺失。"
        )
      const entries = Object.entries(routes)
      if (
        entries.length === 0 ||
        entries.length > 64 ||
        !Object.hasOwn(routes, "/")
      )
        throw new WorkbenchError(
          "storage_failure",
          "冻结阅读表示无效：路由清单为空或超限。"
        )
      for (const [route, file] of entries) {
        if (!validPreviewRoute(route) || !validPreviewFile(file))
          throw new WorkbenchError(
            "storage_failure",
            "冻结阅读表示无效：路由清单成员损坏。"
          )
      }
    }
    // 入口安全路径边界：词法+实体双约束（与 readAsset 同源语义），../ 逃逸明确失败
    const baseReal = await realpath(path).catch(() => {
      throw new WorkbenchError("storage_failure", "版本产物目录缺失。")
    })
    const entryTarget = join(baseReal, reading.entry)
    const relEntry = relative(baseReal, entryTarget)
    if (relEntry === "" || relEntry.startsWith("..") || isAbsolute(relEntry))
      throw new WorkbenchError("storage_failure", "冻结阅读表示入口路径越界。")
    let entryReal
    try {
      entryReal = await realpath(entryTarget)
    } catch {
      throw new WorkbenchError("storage_failure", "冻结阅读表示入口文件缺失。")
    }
    const relEntryReal = relative(baseReal, entryReal)
    if (
      relEntryReal === "" ||
      relEntryReal.startsWith("..") ||
      isAbsolute(relEntryReal)
    )
      throw new WorkbenchError("storage_failure", "冻结阅读表示入口路径越界。")
    await readFile(entryReal)
    const files = (await readdir(path, { recursive: true })).filter(
      (name) => !name.split(/[\\/]/).some((part) => part.startsWith("."))
    )
    return {
      versionId: version.id,
      sequence: version.sequence,
      draftId: version.draftId,
      kind: draft.kind,
      files,
      reading,
    }
  }

  async readMarkdownVersion(versionId) {
    const content = await this.readVersionContent(versionId)
    if (content.kind !== "markdown")
      throw new WorkbenchError(
        "unsupported_artifact",
        "该版本不是 Markdown 草稿。"
      )
    if (!Array.isArray(content.reading.blocks))
      throw new WorkbenchError("storage_failure", "版本冻结阅读表示无效。")
    const path = this.versionArtifactPath(versionId)
    const raw = await readFile(join(path, content.reading.entry), "utf8")
    if (Buffer.byteLength(raw, "utf8") > 2 * 1024 * 1024)
      throw new WorkbenchError("limit_exceeded", "Markdown 正文超过 2MiB。")
    return { ...content, entry: content.reading.entry, raw }
  }

  async readAsset(versionId, relativePath) {
    assertText(relativePath, "资源路径", 512)
    const base = this.versionArtifactPath(versionId)
    if (!base) throw new WorkbenchError("not_found", "版本不存在。")
    let baseReal
    try {
      baseReal = await realpath(base)
    } catch {
      throw new WorkbenchError("storage_failure", "版本产物目录缺失。")
    }
    // 词法边界：规范化后必须仍在产物目录内（含分隔符边界，防前缀兄弟目录）
    const target = join(baseReal, relativePath)
    const relLexical = relative(baseReal, target)
    if (
      relLexical === "" ||
      relLexical.startsWith("..") ||
      isAbsolute(relLexical)
    )
      throw new WorkbenchError("not_found", "资源路径越界。")
    // 实体边界：realpath 解析符号链接/junction 后仍须在产物目录内（Q07）
    let targetReal
    try {
      targetReal = await realpath(target)
    } catch {
      throw new WorkbenchError("not_found", "资源不存在。")
    }
    const relReal = relative(baseReal, targetReal)
    if (relReal === "" || relReal.startsWith("..") || isAbsolute(relReal))
      throw new WorkbenchError("not_found", "资源路径越界。")
    try {
      return await readFile(targetReal)
    } catch {
      throw new WorkbenchError("not_found", "资源不存在。")
    }
  }

  versionArtifactPath(versionId) {
    return this.db
      .prepare(
        "SELECT a.path FROM artifacts a JOIN versions v ON v.artifact_id = a.id WHERE v.id = ?"
      )
      .get(versionId)?.path
  }

  /** 版本资源分片读取（read_asset 分页）：边界同 readAsset；返回 base64 片段与 nextOffset（Q11）。 */
  async readAssetChunk(versionId, relativePath, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new WorkbenchError("validation_failed", "offset 需为非负整数。")
    const bytes = await this.readAsset(versionId, relativePath)
    const chunk = bytes.subarray(offset, offset + ASSET_CHUNK_BYTES)
    const nextOffset = offset + chunk.length
    return {
      path: relativePath,
      totalBytes: bytes.length,
      offset,
      data: chunk.toString("base64"),
      nextOffset: nextOffset >= bytes.length ? null : nextOffset,
      complete: nextOffset >= bytes.length,
    }
  }

  /** 定位引用列表（list_targets）：markdown=冻结块；board=对象（节点/连线，含组归属上下文）（Q11/T11）。 */
  async listTargets(versionId, cursor, limit = 50) {
    const version = this.version(versionId)
    const draft = this.draft(version.draftId)
    const content = await this.readVersionContent(versionId)
    const offset = Number(cursor ?? 0)
    let items
    if (draft.kind === "markdown") {
      const blocks = content.reading.blocks ?? []
      items = blocks.slice(offset, offset + limit).map((block) => ({
        block: block.index,
        type: block.type,
        text: block.text,
      }))
      const complete = offset + items.length >= blocks.length
      return {
        versionId: version.id,
        draftId: version.draftId,
        kind: draft.kind,
        items,
        complete,
        nextCursor: complete ? null : offset + items.length,
      }
    }
    if (draft.kind === "board") {
      const { boardTargets } = await import("./readers/board.mjs")
      const targets = boardTargets(content.reading.canvas)
      items = targets.slice(offset, offset + limit)
      const complete = offset + items.length >= targets.length
      return {
        versionId: version.id,
        draftId: version.draftId,
        kind: draft.kind,
        items,
        complete,
        nextCursor: complete ? null : offset + items.length,
      }
    }
    if (draft.kind === "ui") {
      const routes = Object.entries(content.reading.manifest.routes)
      items = routes
        .slice(offset, offset + limit)
        .map(([route, file]) => ({ page: route, file, text: route }))
      const complete = offset + items.length >= routes.length
      // AC22：UI 元素级目标不由宿主静态枚举（运行时 DOM 决定）；Agent 的合法路径是
      // read_version files + read_asset 读取页面源码后确定选择器，明确边界而非静默缺失
      return {
        versionId: version.id,
        draftId: version.draftId,
        kind: draft.kind,
        items,
        complete,
        nextCursor: complete ? null : offset + items.length,
      }
    }
    throw new WorkbenchError("unsupported_artifact", "该版本类型暂无定位目标。")
  }

  /** Markdown 两版行级差异（LCS）。不变量：按 hunks 重建左右原文逐行一致；超守卫明确失败不降级（Q06）。 */
  compareMarkdown(leftRaw, rightRaw) {
    const left = leftRaw.split("\n")
    const right = rightRaw.split("\n")
    if (left.length * right.length > MAX_DIFF_CELLS)
      throw new WorkbenchError(
        "limit_exceeded",
        `差异规模超过守卫（${left.length}×${right.length} 行），不支持自动比较。`
      )
    const lcs = []
    for (let i = 0; i <= left.length; i++)
      lcs.push(new Uint32Array(right.length + 1))
    for (let i = left.length - 1; i >= 0; i--)
      for (let j = right.length - 1; j >= 0; j--)
        lcs[i][j] =
          left[i] === right[j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    const hunks = []
    let i = 0
    let j = 0
    const push = (type, ls, lc, rs, rc) => {
      const last = hunks[hunks.length - 1]
      if (
        last &&
        last.type === type &&
        last.leftStart + last.leftCount === ls &&
        last.rightStart + last.rightCount === rs
      ) {
        // 合并只累计本类型的实际推进量：delete 只增左、insert 只增右（Q06 修复点）
        last.leftCount += lc
        last.rightCount += rc
        if (type === "same") {
          last.lines.push(left[ls])
        }
        return
      }
      hunks.push({
        type,
        leftStart: ls,
        leftCount: lc,
        rightStart: rs,
        rightCount: rc,
        lines: type === "same" ? [left[ls]] : [],
      })
    }
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        push("same", i, 1, j, 1)
        i++
        j++
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        push("delete", i, 1, j, 0)
        i++
      } else {
        push("insert", i, 0, j, 1)
        j++
      }
    }
    while (i < left.length) {
      push("delete", i, 1, j, 0)
      i++
    }
    while (j < right.length) {
      push("insert", i, 0, j, 1)
      j++
    }
    return {
      truncated: false,
      hunks: hunks.filter((h) => h.type !== "same" || h.lines.length > 0),
    }
  }

  // ---- 讨论（线程固定创建时版本，锚点持久化）----

  /** 锚点快照校验与规范化：document 整篇 / markdown 单块 / markdown 跨块 segments（Q03）。 */
  static normalizeAnchor(anchor) {
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor))
      throw new WorkbenchError("invalid_anchor", "定位快照无效。")
    if (anchor.kind === "document") return { kind: "document" }
    if (anchor.kind === "unresolved") return { kind: "unresolved" }
    if (anchor.kind === "board") {
      if (
        !anchor.objectId ||
        typeof anchor.objectId !== "string" ||
        anchor.objectId.length > 128
      )
        throw new WorkbenchError("invalid_anchor", "白板定位快照缺少对象标识。")
      const snapshot = {
        kind: "board",
        objectId: anchor.objectId,
        objectType:
          anchor.objectType === "edge"
            ? "edge"
            : anchor.objectType === "group"
              ? "group"
              : "node",
        quote: typeof anchor.quote === "string" ? anchor.quote : "",
      }
      // AC22：保留快照关系上下文（组归属/连线端点）；仅接受纯对象并有界
      if (
        anchor.context &&
        typeof anchor.context === "object" &&
        !Array.isArray(anchor.context)
      ) {
        const context = JSON.parse(JSON.stringify(anchor.context))
        if (JSON.stringify(context).length > 1000)
          throw new WorkbenchError("invalid_anchor", "白板定位上下文过大。")
        snapshot.context = context
      }
      return snapshot
    }
    if (anchor.kind === "ui") {
      // UI 定位快照：页面 + 元素描述 + 视口（桥产出目标经服务端校验持久化，T14）
      if (
        typeof anchor.page !== "string" ||
        anchor.page.length < 1 ||
        anchor.page.length > 512
      )
        throw new WorkbenchError("invalid_anchor", "UI 定位快照缺少有效页面。")
      if (
        typeof anchor.tag !== "string" ||
        anchor.tag.length < 1 ||
        anchor.tag.length > 64
      )
        throw new WorkbenchError(
          "invalid_anchor",
          "UI 定位快照缺少有效元素标签。"
        )
      const snapshot = { ...anchor }
      delete snapshot.kind
      if (JSON.stringify(snapshot).length > 4000)
        throw new WorkbenchError("invalid_anchor", "UI 定位快照过大。")
      return { kind: "ui", ...snapshot }
    }
    if (anchor.kind === "markdown") {
      const segment = (item) => {
        if (
          !item ||
          !Number.isInteger(item.block) ||
          item.block < 0 ||
          !Number.isInteger(item.start) ||
          !Number.isInteger(item.end) ||
          item.start < 0 ||
          item.end < item.start ||
          typeof item.quote !== "string" ||
          item.quote.length === 0
        )
          throw new WorkbenchError("invalid_anchor", "定位快照片段无效。")
        return {
          block: item.block,
          start: item.start,
          end: item.end,
          quote: item.quote,
        }
      }
      if (Array.isArray(anchor.segments)) {
        if (anchor.segments.length === 0)
          throw new WorkbenchError("invalid_anchor", "跨块定位快照不能为空。")
        return { kind: "markdown", segments: anchor.segments.map(segment) }
      }
      return { kind: "markdown", ...segment(anchor) }
    }
    throw new WorkbenchError("invalid_anchor", "定位快照无效。")
  }

  createThread(versionId, anchor, body, requestKey, actor) {
    assertId(versionId, "版本标识")
    assertText(body, "评论正文", 8000)
    assertText(requestKey, "requestKey", 128)
    assertText(actor, "actor", 64)
    const normalized = WorkbenchStore.normalizeAnchor(anchor)
    const version = this.version(versionId)
    // AC06-二轮：创建评论重放走统一回执（anchor 递归签名；同键换选区=冲突）
    const threadId = randomUUID()
    const replyId = randomUUID()
    const receipt = this.writeReceipt(
      "create_thread",
      actor,
      versionId,
      { versionId, anchor: normalized, body, requestKey },
      () => {
        const stamp = now()
        this.db
          .prepare(
            "INSERT INTO threads (id, draft_id, version_id, author_actor, anchor, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)"
          )
          .run(
            threadId,
            version.draftId,
            versionId,
            actor,
            JSON.stringify(normalized),
            stamp
          )
        this.db
          .prepare(
            "INSERT INTO replies (id, thread_id, author_actor, body, related_version_id, request_key, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)"
          )
          .run(replyId, threadId, actor, body, requestKey, stamp)
        this.db
          .prepare(
            "UPDATE drafts SET review_revision = review_revision + 1 WHERE id = ?"
          )
          .run(version.draftId)
        return { threadId, replyId, anchor: normalized }
      }
    )
    return {
      threadId: receipt.threadId,
      replyId: receipt.replyId,
      versionId,
      draftId: version.draftId,
      anchor: receipt.anchor ?? normalized,
      replayed: receipt.replayed,
    }
  }

  addReply(threadId, body, relatedVersionId, requestKey, actor) {
    assertId(threadId, "线程标识")
    assertText(body, "回复正文", 8000)
    assertText(requestKey, "requestKey", 128)
    assertText(actor, "actor", 64)
    const thread = this.db
      .prepare(
        "SELECT id, draft_id, author_actor, status FROM threads WHERE id = ?"
      )
      .get(threadId)
    if (!thread) throw new WorkbenchError("not_found", "线程不存在。")
    if (relatedVersionId != null) {
      const related = this.version(relatedVersionId)
      if (thread.draft_id !== related.draftId)
        throw new WorkbenchError("validation_failed", "关联版本属于其他草稿。")
    }
    // AC06-二轮：回复重放走统一回执
    return this.writeReceipt(
      "add_reply",
      actor,
      threadId,
      {
        threadId,
        body,
        relatedVersionId: relatedVersionId ?? null,
        requestKey,
      },
      () => {
        const replyId = randomUUID()
        this.db
          .prepare(
            "INSERT INTO replies (id, thread_id, author_actor, body, related_version_id, request_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            replyId,
            threadId,
            actor,
            body,
            relatedVersionId ?? null,
            requestKey,
            now()
          )
        this.db
          .prepare(
            "UPDATE drafts SET review_revision = review_revision + 1 WHERE id = ?"
          )
          .run(thread.draft_id)
        return { replyId }
      }
    )
  }

  setThreadStatus(threadId, status, actor, { isUser, requestKey }) {
    assertId(threadId, "线程标识")
    if (!["open", "resolved"].includes(status))
      throw new WorkbenchError(
        "validation_failed",
        "状态仅支持 open/resolved。"
      )
    assertText(actor, "actor", 64)
    assertText(requestKey, "requestKey", 128)
    const thread = this.db
      .prepare("SELECT id, author_actor, status FROM threads WHERE id = ?")
      .get(threadId)
    if (!thread) throw new WorkbenchError("not_found", "线程不存在。")
    // 用户可解决任何线程；Agent 仅自己发起的线程
    if (!isUser && thread.author_actor !== actor)
      throw new WorkbenchError(
        "identity_denied",
        "Agent 只能处理自己发起的线程。"
      )
    // AC06：回执先于状态判定——无状态变化（no-op）同样留痕；历史 status_events
    // 行已在 v3 迁移回填为 write_receipts，统一由回执重放。
    return this.writeReceipt(
      "set_thread_status",
      actor,
      threadId,
      { threadId, status, requestKey },
      () => {
        if (thread.status === status)
          return { threadId, status, changed: false }
        const stamp = now()
        this.db
          .prepare(
            "UPDATE threads SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?"
          )
          .run(
            status,
            status === "resolved" ? stamp : null,
            status === "resolved" ? actor : null,
            threadId
          )
        this.db
          .prepare(
            "INSERT INTO status_events (id, thread_id, actor_id, from_status, to_status, request_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            randomUUID(),
            threadId,
            actor,
            thread.status,
            status,
            requestKey,
            stamp
          )
        this.db
          .prepare(
            "UPDATE drafts SET review_revision = review_revision + 1 WHERE id = (SELECT draft_id FROM threads WHERE id = ?)"
          )
          .run(threadId)
        return { threadId, status, changed: true }
      }
    )
  }

  /** 单调审阅修订号：仅表示有新讨论活动。 */
  reviewRevision(draftId) {
    return this.draft(draftId).reviewRevision
  }

  /** AC15：锚点读取的三种语义——未配置（NULL/空，含迁移回填）→ unresolved；
   * 损坏（JSON 不可解析或不符合快照契约）→ corrupt 显式标注，不静默改写为 unresolved；
   * 合法快照 → normalizeAnchor 规范化。对象级失效（board 对象/UI 页面不存在）由
   * 消费方按锚点内容判别并提示，不改写存储。 */
  parseAnchor(raw) {
    if (raw === null || raw === undefined || raw === "")
      return { kind: "unresolved" }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { kind: "corrupt" }
    }
    try {
      return WorkbenchStore.normalizeAnchor(parsed)
    } catch {
      return { kind: "corrupt" }
    }
  }

  /** 线程列表（含持久化锚点与回复分页信息；线程固定创建时版本，旧版本历史评论保留归属）。 */
  listThreads(
    draftId,
    { versionId, status, authorActor } = {},
    cursor,
    limit = 50
  ) {
    assertId(draftId, "草稿标识")
    const key = decodeKeysetCursor(cursor, "讨论分页")
    const keysetFilter = key ? ` AND ${keysetPredicate("t.")}` : ""
    const keysetParams = key ? [key.createdAt, key.createdAt, key.id] : []
    const rows = this.db
      .prepare(
        `SELECT t.id, t.version_id AS versionId, t.author_actor AS authorActor, t.anchor, t.status,
                t.created_at AS createdAt, t.resolved_at AS resolvedAt, t.resolved_by AS resolvedBy,
                (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id) AS replyCount
         FROM threads t WHERE t.draft_id = ?
           AND (? IS NULL OR t.version_id = ?)
           AND (? IS NULL OR t.status = ?)
           AND (? IS NULL OR t.author_actor = ? OR EXISTS (
             SELECT 1 FROM replies authored WHERE authored.thread_id = t.id AND authored.author_actor = ?
           ))${keysetFilter}
         ORDER BY t.created_at, t.id LIMIT ?`
      )
      .all(
        draftId,
        versionId ?? null,
        versionId ?? null,
        status ?? null,
        status ?? null,
        authorActor ?? null,
        authorActor ?? null,
        authorActor ?? null,
        ...keysetParams,
        limit + 1
      )
    const complete = rows.length <= limit
    const items = complete ? rows : rows.slice(0, limit)
    return {
      items: items.map((row) => ({
        ...row,
        anchor: this.parseAnchor(row.anchor),
      })),
      authorActors: this.db
        .prepare(
          `SELECT author_actor AS actor FROM threads WHERE draft_id = ?
        UNION SELECT r.author_actor AS actor FROM replies r JOIN threads t ON t.id = r.thread_id WHERE t.draft_id = ?
        ORDER BY actor`
        )
        .all(draftId, draftId)
        .map((row) => row.actor),
      complete,
      nextCursor:
        complete || items.length === 0
          ? null
          : encodeKeysetCursor(items[items.length - 1]),
    }
  }

  readThread(threadId, replyCursor, replyLimit = 100) {
    assertId(threadId, "线程标识")
    const threadRow = this.db
      .prepare(
        "SELECT id, draft_id AS draftId, version_id AS versionId, author_actor AS authorActor, anchor, status, created_at AS createdAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy FROM threads WHERE id = ?"
      )
      .get(threadId)
    if (!threadRow) throw new WorkbenchError("not_found", "线程不存在。")
    const thread = { ...threadRow, anchor: this.parseAnchor(threadRow.anchor) }
    const key = decodeKeysetCursor(replyCursor, "回复分页")
    const replies = key
      ? this.db
          .prepare(
            `SELECT id, author_actor AS authorActor, body, related_version_id AS relatedVersionId, request_key AS requestKey, created_at AS createdAt FROM replies WHERE replies.thread_id = ? AND ${keysetPredicate("replies.")} ORDER BY replies.created_at, replies.id LIMIT ?`
          )
          .all(threadId, key.createdAt, key.createdAt, key.id, replyLimit + 1)
      : this.db
          .prepare(
            "SELECT id, author_actor AS authorActor, body, related_version_id AS relatedVersionId, request_key AS requestKey, created_at AS createdAt FROM replies WHERE thread_id = ? ORDER BY created_at, id LIMIT ?"
          )
          .all(threadId, replyLimit + 1)
    const complete = replies.length <= replyLimit
    const items = complete ? replies : replies.slice(0, replyLimit)
    return {
      thread,
      replies: {
        items,
        complete,
        nextCursor:
          complete || items.length === 0
            ? null
            : encodeKeysetCursor(items[items.length - 1]),
      },
    }
  }

  /** 孤儿候选：未绑定版本的封存目录（清理前还需核对备份/恢复隔离区）。 */
  orphanCandidates() {
    const referenced = new Set(
      this.db
        .prepare("SELECT artifact_id AS id FROM versions")
        .all()
        .map((row) => row.id)
    )
    return readdir(join(this.root, "artifacts")).then((dirs) =>
      dirs.filter((id) => !referenced.has(id))
    )
  }
}
