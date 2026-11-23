// @ts-check
import { DatabaseSync } from "node:sqlite"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export class SkillStoreError extends Error {
  /** @param {string} code @param {string} message @param {number} [status] @param {ErrorOptions} [options] */
  constructor(code, message, status = 400, options) {
    super(message, options)
    this.code = code
    this.status = status
  }
}

const nowIso = () => new Date().toISOString()

const slugRegex = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/

/** @param {string} relPath */
export function assertSafeRelPath(relPath) {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new SkillStoreError("INVALID_PATH", "文件路径不能为空。")
  }
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "")
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new SkillStoreError("INVALID_PATH", `非法相对路径：${relPath}`)
  }
  if (normalized.toLowerCase() === "skill.md") {
    throw new SkillStoreError(
      "RESERVED_PATH",
      "SKILL.md 由段落编排自动编译生成，不能作为普通附属文件写入。"
    )
  }
  return normalized
}

export class SkillWorkbenchStore {
  /** @param {string} directory */
  constructor(directory) {
    this.directory = directory
    this.dbFile = join(directory, "skill-workbench.db")
    /** @type {DatabaseSync | null} */
    this.db = null
  }

  async open() {
    if (this.db) return
    await mkdir(this.directory, { recursive: true })
    const db = new DatabaseSync(this.dbFile)
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        export_dir TEXT NOT NULL DEFAULT '',
        current_version INTEGER NOT NULL DEFAULT 0,
        draft_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_blocks (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL,
        heading TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        eval_status TEXT NOT NULL DEFAULT 'unverified',
        created_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_skill ON skill_blocks(skill_id, sort_order);

      CREATE TABLE IF NOT EXISTS skill_assets (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(skill_id, rel_path)
      );

      CREATE TABLE IF NOT EXISTS skill_revisions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 0,
        action TEXT NOT NULL,
        block_id TEXT,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_snapshot TEXT,
        after_snapshot TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_revisions_skill ON skill_revisions(skill_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_revisions_block ON skill_revisions(skill_id, block_id, created_at);

      CREATE TABLE IF NOT EXISTS skill_versions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        summary TEXT NOT NULL,
        compiled_md TEXT NOT NULL,
        blocks_snapshot TEXT NOT NULL,
        assets_snapshot TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(skill_id, version_number)
      );
    `)
    this.db = db
  }

  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /** @template T @param {() => T} fn @param {"read" | "write"} [mode] @returns {T} */
  tx(fn, mode = "write") {
    if (!this.db) throw new SkillStoreError("CLOSED", "存储未打开。", 500)
    this.db.exec(mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE")
    try {
      const result = fn()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      try {
        this.db.exec("ROLLBACK")
      } catch {
        // ignore rollback error
      }
      throw error
    }
  }

  /** @param {string} skillId */
  requireSkill(skillId) {
    const row = this.db
      ?.prepare("SELECT * FROM skills WHERE id = ?")
      .get(skillId)
    if (!row) {
      throw new SkillStoreError("NOT_FOUND", `Skill 不存在：${skillId}`, 404)
    }
    return this.#mapSkill(row)
  }

  listSkills() {
    const rows =
      this.db
        ?.prepare("SELECT * FROM skills ORDER BY updated_at DESC")
        .all() ?? []
    return rows.map((row) => this.#mapSkill(row))
  }

  /** @param {{ slug: string, name: string, description: string, exportDir?: string, actor: string, reason: string, initialBlocks?: Array<{ heading?: string, content: string }> }} input */
  createSkill(input) {
    const slug = String(input.slug || "").trim().toLowerCase()
    if (!slugRegex.test(slug)) {
      throw new SkillStoreError(
        "INVALID_SLUG",
        "Skill 标识（slug）只允许小写字母、数字与连字符，长度 1–64。"
      )
    }
    const name = String(input.name || "").trim()
    const description = String(input.description || "").trim()
    const reason = String(input.reason || "").trim()
    if (!name || !description) {
      throw new SkillStoreError("INVALID_INPUT", "Skill 名称和描述不能为空。")
    }
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "创建 Skill 必须填写原因。")
    }
    return this.tx(() => {
      const existing = this.db
        .prepare("SELECT id FROM skills WHERE slug = ?")
        .get(slug)
      if (existing) {
        throw new SkillStoreError("CONFLICT", `slug 已存在：${slug}`, 409)
      }
      const id = `sk_${randomUUID().slice(0, 12)}`
      const ts = nowIso()
      this.db
        .prepare(
          `INSERT INTO skills (id, slug, name, description, export_dir, current_version, draft_revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`
        )
        .run(
          id,
          slug,
          name,
          description,
          String(input.exportDir || "").trim(),
          ts,
          ts
        )
      this.#appendRevision(id, {
        versionNumber: 0,
        action: "create_skill",
        blockId: null,
        actor: input.actor,
        reason,
        beforeSnapshot: null,
        afterSnapshot: { slug, name, description },
        createdAt: ts,
      })
      const initialBlocks = Array.isArray(input.initialBlocks)
        ? input.initialBlocks
        : []
      initialBlocks.forEach((blk, index) => {
        const content = String(blk.content || "").trim()
        if (!content) return
        const blockId = `blk_${randomUUID().slice(0, 10)}`
        const heading = String(blk.heading || "").trim()
        this.db
          .prepare(
            `INSERT INTO skill_blocks (id, skill_id, sort_order, heading, content, eval_status, created_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'unverified', 0, ?, ?)`
          )
          .run(blockId, id, index + 1, heading, content, ts, ts)
        this.#appendRevision(id, {
          versionNumber: 0,
          action: "add_block",
          blockId,
          actor: input.actor,
          reason: `初始创建：${reason}`,
          beforeSnapshot: null,
          afterSnapshot: {
            id: blockId,
            sortOrder: index + 1,
            heading,
            content,
            evalStatus: "unverified",
          },
          createdAt: ts,
        })
      })
      return this.getSkillDetail(id)
    })
  }

  /** @param {string} skillId @param {{ name?: string, description?: string, exportDir?: string, actor: string, reason: string }} input */
  updateSkillMeta(skillId, input) {
    const reason = String(input.reason || "").trim()
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "修改 Skill 元数据必须填写原因。")
    }
    return this.tx(() => {
      const skill = this.requireSkill(skillId)
      const nextName =
        input.name !== undefined ? String(input.name).trim() : skill.name
      const nextDesc =
        input.description !== undefined
          ? String(input.description).trim()
          : skill.description
      const nextExportDir =
        input.exportDir !== undefined
          ? String(input.exportDir).trim()
          : skill.exportDir
      if (!nextName || !nextDesc) {
        throw new SkillStoreError("INVALID_INPUT", "Skill 名称和描述不能为空。")
      }
      const ts = nowIso()
      this.db
        .prepare(
          `UPDATE skills SET name = ?, description = ?, export_dir = ?, draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?`
        )
        .run(nextName, nextDesc, nextExportDir, ts, skillId)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "update_skill",
        blockId: null,
        actor: input.actor,
        reason,
        beforeSnapshot: {
          name: skill.name,
          description: skill.description,
          exportDir: skill.exportDir,
        },
        afterSnapshot: {
          name: nextName,
          description: nextDesc,
          exportDir: nextExportDir,
        },
        createdAt: ts,
      })
      return this.getSkillDetail(skillId)
    })
  }

  /** @param {string} skillId */
  deleteSkill(skillId) {
    return this.tx(() => {
      this.requireSkill(skillId)
      this.db.prepare("DELETE FROM skills WHERE id = ?").run(skillId)
      return { deleted: true, skillId }
    })
  }

  /** @param {string} skillId */
  getSkillDetail(skillId) {
    const skill = this.requireSkill(skillId)
    const blocks = this.listActiveBlocks(skillId)
    const assets = this.listAssets(skillId)
    const versions = this.listVersions(skillId)
    return {
      skill,
      blocks,
      assets,
      versions,
      revisions: this.listRevisions(skillId),
    }
  }

  /** @param {string} skillId */
  listActiveBlocks(skillId) {
    const rows =
      this.db
        ?.prepare(
          "SELECT * FROM skill_blocks WHERE skill_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC"
        )
        .all(skillId) ?? []
    return rows.map((row) => this.#mapBlock(row))
  }

  /** @param {string} skillId @param {{ heading?: string, content: string, insertIndex?: number, evalStatus?: string, actor: string, reason: string }} input */
  addBlock(skillId, input) {
    const content = String(input.content || "").trim()
    const reason = String(input.reason || "").trim()
    if (!content) {
      throw new SkillStoreError("INVALID_INPUT", "段落内容不能为空。")
    }
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "新增段落必须填写原因。")
    }
    const heading = String(input.heading || "").trim()
    const evalStatus = this.#normalizeEvalStatus(input.evalStatus)
    return this.tx(() => {
      this.requireSkill(skillId)
      const active = this.listActiveBlocks(skillId)
      const insertAt =
        typeof input.insertIndex === "number" &&
        Number.isInteger(input.insertIndex) &&
        input.insertIndex >= 0 &&
        input.insertIndex <= active.length
          ? input.insertIndex
          : active.length
      const blockId = `blk_${randomUUID().slice(0, 10)}`
      const ts = nowIso()
      const newOrder = [
        ...active.slice(0, insertAt).map((b) => b.id),
        blockId,
        ...active.slice(insertAt).map((b) => b.id),
      ]
      this.db
        .prepare(
          `INSERT INTO skill_blocks (id, skill_id, sort_order, heading, content, eval_status, created_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(blockId, skillId, insertAt + 1, heading, content, evalStatus, ts, ts)
      newOrder.forEach((id, idx) => {
        this.db
          .prepare("UPDATE skill_blocks SET sort_order = ? WHERE id = ?")
          .run(idx + 1, id)
      })
      this.#touchSkillDraft(skillId, ts)
      const after = this.#getBlockRaw(skillId, blockId)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "add_block",
        blockId,
        actor: input.actor,
        reason,
        beforeSnapshot: null,
        afterSnapshot: after,
        createdAt: ts,
      })
      return after
    })
  }

  /** @param {string} skillId @param {string} blockId @param {{ heading?: string, content?: string, evalStatus?: string, actor: string, reason: string }} input */
  updateBlock(skillId, blockId, input) {
    const reason = String(input.reason || "").trim()
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "修改段落必须填写原因。")
    }
    return this.tx(() => {
      this.requireSkill(skillId)
      const before = this.#getBlockRaw(skillId, blockId)
      if (!before || before.deletedAt) {
        throw new SkillStoreError("NOT_FOUND", `段落不存在：${blockId}`, 404)
      }
      const nextHeading =
        input.heading !== undefined
          ? String(input.heading).trim()
          : before.heading
      const nextContent =
        input.content !== undefined
          ? String(input.content).trim()
          : before.content
      if (!nextContent) {
        throw new SkillStoreError("INVALID_INPUT", "段落内容不能为空。")
      }
      const nextStatus =
        input.evalStatus !== undefined
          ? this.#normalizeEvalStatus(input.evalStatus)
          : before.evalStatus
      const ts = nowIso()
      this.db
        .prepare(
          `UPDATE skill_blocks SET heading = ?, content = ?, eval_status = ?, updated_at = ? WHERE id = ? AND skill_id = ?`
        )
        .run(nextHeading, nextContent, nextStatus, ts, blockId, skillId)
      this.#touchSkillDraft(skillId, ts)
      const after = this.#getBlockRaw(skillId, blockId)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "update_block",
        blockId,
        actor: input.actor,
        reason,
        beforeSnapshot: before,
        afterSnapshot: after,
        createdAt: ts,
      })
      return after
    })
  }

  /** @param {string} skillId @param {string} blockId @param {{ actor: string, reason: string }} input */
  deleteBlock(skillId, blockId, input) {
    const reason = String(input.reason || "").trim()
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "删除段落必须填写原因。")
    }
    return this.tx(() => {
      this.requireSkill(skillId)
      const before = this.#getBlockRaw(skillId, blockId)
      if (!before || before.deletedAt) {
        throw new SkillStoreError("NOT_FOUND", `段落不存在：${blockId}`, 404)
      }
      const ts = nowIso()
      this.db
        .prepare(
          "UPDATE skill_blocks SET deleted_at = ?, updated_at = ? WHERE id = ? AND skill_id = ?"
        )
        .run(ts, ts, blockId, skillId)
      const remaining = this.listActiveBlocks(skillId)
      remaining.forEach((b, idx) => {
        this.db
          .prepare("UPDATE skill_blocks SET sort_order = ? WHERE id = ?")
          .run(idx + 1, b.id)
      })
      this.#touchSkillDraft(skillId, ts)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "delete_block",
        blockId,
        actor: input.actor,
        reason,
        beforeSnapshot: before,
        afterSnapshot: null,
        createdAt: ts,
      })
      return { deleted: true, blockId }
    })
  }

  /** @param {string} skillId @param {{ orderedBlockIds: string[], actor: string, reason: string }} input */
  reorderBlocks(skillId, input) {
    const reason = String(input.reason || "").trim()
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "调整段落顺序必须填写原因。")
    }
    return this.tx(() => {
      this.requireSkill(skillId)
      const active = this.listActiveBlocks(skillId)
      const activeIds = new Set(active.map((b) => b.id))
      const nextIds = Array.isArray(input.orderedBlockIds)
        ? input.orderedBlockIds
        : []
      if (
        nextIds.length !== active.length ||
        new Set(nextIds).size !== active.length ||
        nextIds.some((id) => !activeIds.has(id))
      ) {
        throw new SkillStoreError(
          "INVALID_ORDER",
          "段落排序列表必须与当前有效段落集合完全一致。"
        )
      }
      const ts = nowIso()
      const beforeOrder = active.map((b) => ({
        id: b.id,
        sortOrder: b.sortOrder,
        heading: b.heading,
      }))
      nextIds.forEach((id, idx) => {
        this.db
          .prepare(
            "UPDATE skill_blocks SET sort_order = ?, updated_at = ? WHERE id = ? AND skill_id = ?"
          )
          .run(idx + 1, ts, id, skillId)
      })
      const after = this.listActiveBlocks(skillId)
      const afterOrder = after.map((b) => ({
        id: b.id,
        sortOrder: b.sortOrder,
        heading: b.heading,
      }))
      this.#touchSkillDraft(skillId, ts)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "reorder_blocks",
        blockId: null,
        actor: input.actor,
        reason,
        beforeSnapshot: beforeOrder,
        afterSnapshot: afterOrder,
        createdAt: ts,
      })
      return after
    })
  }

  /** @param {string} skillId */
  listAssets(skillId) {
    const rows =
      this.db
        ?.prepare(
          "SELECT * FROM skill_assets WHERE skill_id = ? ORDER BY rel_path ASC"
        )
        .all(skillId) ?? []
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      relPath: row.rel_path,
      content: row.content,
      updatedAt: row.updated_at,
    }))
  }

  /** @param {string} skillId @param {{ relPath: string, content: string, actor: string, reason: string }} input */
  upsertAsset(skillId, input) {
    const relPath = assertSafeRelPath(input.relPath)
    const reason = String(input.reason || "").trim()
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "保存附属文件必须填写原因。")
    }
    const content = typeof input.content === "string" ? input.content : ""
    return this.tx(() => {
      this.requireSkill(skillId)
      const existing = this.db
        .prepare(
          "SELECT * FROM skill_assets WHERE skill_id = ? AND rel_path = ?"
        )
        .get(skillId, relPath)
      const ts = nowIso()
      const id = existing ? existing.id : `ast_${randomUUID().slice(0, 10)}`
      if (existing) {
        this.db
          .prepare(
            "UPDATE skill_assets SET content = ?, updated_at = ? WHERE id = ?"
          )
          .run(content, ts, id)
      } else {
        this.db
          .prepare(
            "INSERT INTO skill_assets (id, skill_id, rel_path, content, updated_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(id, skillId, relPath, content, ts)
      }
      this.#touchSkillDraft(skillId, ts)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "upsert_asset",
        blockId: null,
        actor: input.actor,
        reason,
        beforeSnapshot: existing
          ? { relPath, contentLength: existing.content.length }
          : null,
        afterSnapshot: { relPath, contentLength: content.length },
        createdAt: ts,
      })
      return { id, skillId, relPath, content, updatedAt: ts }
    })
  }

  /** @param {string} skillId @param {string} relPath @param {{ actor: string, reason: string }} input */
  deleteAsset(skillId, relPath, input) {
    const normalized = assertSafeRelPath(relPath)
    const reason = String(input.reason || "").trim()
    if (!reason) {
      throw new SkillStoreError("REASON_REQUIRED", "删除附属文件必须填写原因。")
    }
    return this.tx(() => {
      this.requireSkill(skillId)
      const existing = this.db
        .prepare(
          "SELECT * FROM skill_assets WHERE skill_id = ? AND rel_path = ?"
        )
        .get(skillId, normalized)
      if (!existing) {
        throw new SkillStoreError(
          "NOT_FOUND",
          `附属文件不存在：${normalized}`,
          404
        )
      }
      this.db.prepare("DELETE FROM skill_assets WHERE id = ?").run(existing.id)
      const ts = nowIso()
      this.#touchSkillDraft(skillId, ts)
      this.#appendRevision(skillId, {
        versionNumber: 0,
        action: "delete_asset",
        blockId: null,
        actor: input.actor,
        reason,
        beforeSnapshot: { relPath: normalized },
        afterSnapshot: null,
        createdAt: ts,
      })
      return { deleted: true, relPath: normalized }
    })
  }

  /** @param {string} skillId @param {{ summary: string, actor: string }} input @param {(skill: ReturnType<SkillWorkbenchStore["requireSkill"]>, blocks: ReturnType<SkillWorkbenchStore["listActiveBlocks"]>) => string} compileMarkdown */
  publishVersion(skillId, input, compileMarkdown) {
    const summary = String(input.summary || "").trim()
    if (!summary) {
      throw new SkillStoreError("INVALID_INPUT", "发布版本必须填写版本说明。")
    }
    return this.tx(() => {
      const skill = this.requireSkill(skillId)
      const nextVersion = skill.currentVersion + 1
      const blocks = this.listActiveBlocks(skillId)
      const assets = this.listAssets(skillId)
      const ts = nowIso()
      const versionId = `ver_${randomUUID().slice(0, 10)}`
      this.db
        .prepare(
          `INSERT INTO skill_versions (id, skill_id, version_number, summary, compiled_md, blocks_snapshot, assets_snapshot, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          skillId,
          nextVersion,
          summary,
          compileMarkdown(skill, blocks),
          JSON.stringify(blocks),
          JSON.stringify(assets),
          input.actor,
          ts
        )
      this.db
        .prepare(
          "UPDATE skill_revisions SET version_number = ? WHERE skill_id = ? AND version_number = 0"
        )
        .run(nextVersion, skillId)
      this.db
        .prepare(
          "UPDATE skill_blocks SET created_version = ? WHERE skill_id = ? AND created_version = 0"
        )
        .run(nextVersion, skillId)
      this.db
        .prepare(
          "UPDATE skills SET current_version = ?, updated_at = ? WHERE id = ?"
        )
        .run(nextVersion, ts, skillId)
      this.#appendRevision(skillId, {
        versionNumber: nextVersion,
        action: "publish_version",
        blockId: null,
        actor: input.actor,
        reason: summary,
        beforeSnapshot: { versionNumber: skill.currentVersion },
        afterSnapshot: { versionNumber: nextVersion, blockCount: blocks.length },
        createdAt: ts,
      })
      return this.getVersion(skillId, nextVersion)
    })
  }

  /** @param {string} skillId */
  listVersions(skillId) {
    const rows =
      this.db
        ?.prepare(
          "SELECT id, skill_id, version_number, summary, created_by, created_at FROM skill_versions WHERE skill_id = ? ORDER BY version_number DESC"
        )
        .all(skillId) ?? []
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      versionNumber: row.version_number,
      summary: row.summary,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }))
  }

  /** @param {string} skillId @param {number} versionNumber */
  getVersion(skillId, versionNumber) {
    const row = this.db
      ?.prepare(
        "SELECT * FROM skill_versions WHERE skill_id = ? AND version_number = ?"
      )
      .get(skillId, versionNumber)
    if (!row) {
      throw new SkillStoreError(
        "NOT_FOUND",
        `版本 V${versionNumber} 不存在。`,
        404
      )
    }
    return {
      id: row.id,
      skillId: row.skill_id,
      versionNumber: row.version_number,
      summary: row.summary,
      compiledMd: row.compiled_md,
      blocks: JSON.parse(row.blocks_snapshot),
      assets: JSON.parse(row.assets_snapshot),
      createdBy: row.created_by,
      createdAt: row.created_at,
    }
  }

  /** @param {string} skillId @param {string} [blockId] */
  listRevisions(skillId, blockId) {
    const rows = blockId
      ? (this.db
          ?.prepare(
            "SELECT * FROM skill_revisions WHERE skill_id = ? AND block_id = ? ORDER BY created_at ASC"
          )
          .all(skillId, blockId) ?? [])
      : (this.db
          ?.prepare(
            "SELECT * FROM skill_revisions WHERE skill_id = ? ORDER BY created_at DESC"
          )
          .all(skillId) ?? [])
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      versionNumber: row.version_number,
      action: row.action,
      blockId: row.block_id,
      actor: row.actor,
      reason: row.reason,
      beforeSnapshot: row.before_snapshot
        ? JSON.parse(row.before_snapshot)
        : null,
      afterSnapshot: row.after_snapshot
        ? JSON.parse(row.after_snapshot)
        : null,
      createdAt: row.created_at,
    }))
  }

  #touchSkillDraft(skillId, ts) {
    this.db
      .prepare(
        "UPDATE skills SET draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?"
      )
      .run(ts, skillId)
  }

  #appendRevision(skillId, entry) {
    this.db
      .prepare(
        `INSERT INTO skill_revisions (id, skill_id, version_number, action, block_id, actor, reason, before_snapshot, after_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `rev_${randomUUID().slice(0, 12)}`,
        skillId,
        entry.versionNumber,
        entry.action,
        entry.blockId,
        entry.actor,
        entry.reason,
        entry.beforeSnapshot ? JSON.stringify(entry.beforeSnapshot) : null,
        entry.afterSnapshot ? JSON.stringify(entry.afterSnapshot) : null,
        entry.createdAt
      )
  }

  #getBlockRaw(skillId, blockId) {
    const row = this.db
      .prepare("SELECT * FROM skill_blocks WHERE id = ? AND skill_id = ?")
      .get(blockId, skillId)
    return row ? this.#mapBlock(row) : null
  }

  #normalizeEvalStatus(value) {
    return value === "verified" || value === "needs_review"
      ? value
      : "unverified"
  }

  #mapSkill(row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      exportDir: row.export_dir,
      currentVersion: row.current_version,
      draftRevision: row.draft_revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  #mapBlock(row) {
    return {
      id: row.id,
      skillId: row.skill_id,
      sortOrder: row.sort_order,
      heading: row.heading,
      content: row.content,
      evalStatus: row.eval_status,
      createdVersion: row.created_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || undefined,
    }
  }
}
