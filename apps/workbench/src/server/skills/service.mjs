// @ts-check
import { isAbsolute } from "node:path"
import { exportSkillSnapshot } from "./export-directory.mjs"
import { SkillStoreError } from "./storage.mjs"

/** @param {string} value */
const yamlEscape = (value) => {
  return JSON.stringify(
    String(value ?? "")
      .replace(/\r?\n/g, " ")
      .trim()
  )
}

/** @param {{ slug: string, name: string, description: string }} skill @param {Array<{ heading: string, content: string }>} blocks */
export function compileSkillMarkdown(skill, blocks) {
  const header = [
    "---",
    `name: ${yamlEscape(skill.slug)}`,
    `description: ${yamlEscape(skill.description)}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
  ]
  const body = blocks.map((block) => {
    const parts = []
    if (block.heading && block.heading.trim()) {
      parts.push(`## ${block.heading.trim()}`)
      parts.push("")
    }
    parts.push(block.content.trim())
    return parts.join("\n")
  })
  return [...header, ...body].join("\n\n").trimEnd() + "\n"
}

/** @param {unknown} value @param {number} [minimum] */
function parseVersionNumber(value, minimum = 0) {
  const version =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < minimum
  ) {
    throw new SkillStoreError("INVALID_VERSION", "版本号无效。")
  }
  return version
}

/** @param {import("./storage.mjs").SkillWorkbenchStore} store @param {{ changed?: () => void }} host */
export function createSkillService(store, host = {}) {
  const notify = () => host.changed?.()

  /** @param {string} skillId @param {unknown} [version] */
  const resolveSnapshot = (skillId, version = 0) => {
    const versionNumber = parseVersionNumber(version)
    const skill = store.requireSkill(skillId)
    if (versionNumber === 0) {
      const blocks = store.listActiveBlocks(skillId)
      const assets = store.listAssets(skillId)
      return {
        versionNumber: 0,
        label: "当前草稿",
        skill,
        blocks,
        assets,
        compiledMd: compileSkillMarkdown(skill, blocks),
      }
    }
    const ver = store.getVersion(skillId, versionNumber)
    return {
      versionNumber: ver.versionNumber,
      label: `V${ver.versionNumber}`,
      skill,
      blocks: ver.blocks,
      assets: ver.assets,
      compiledMd: ver.compiledMd,
    }
  }

  /** @param {string} skillId @param {string} blockId */
  const getBlockLineage = (skillId, blockId) => {
    store.requireSkill(skillId)
    const revisions = store.listRevisions(skillId, blockId)
    const activeBlocks = store.listActiveBlocks(skillId)
    const current = activeBlocks.find((b) => b.id === blockId) || null
    if (!current && revisions.length === 0) {
      throw new SkillStoreError(
        "NOT_FOUND",
        `段落不存在或无历史记录：${blockId}`,
        404
      )
    }
    const createdRev = revisions.find((r) => r.action === "add_block")
    const editRevs = revisions.filter((r) => r.action === "update_block")
    const deletedRev = revisions.find((r) => r.action === "delete_block")
    return {
      blockId,
      current,
      deleted: Boolean(deletedRev && !current),
      createdAt: createdRev?.createdAt || revisions[0]?.createdAt || "",
      createdVersion: createdRev?.versionNumber ?? 0,
      editCount: editRevs.length,
      revisions,
    }
  }

  /** @param {string} skillId @param {number} fromVersion @param {number} toVersion */
  const compareVersions = (skillId, fromVersion, toVersion) => {
    const fromSnap = resolveSnapshot(skillId, fromVersion)
    const toSnap = resolveSnapshot(skillId, toVersion)
    const fromMap = new Map(
      fromSnap.blocks.map((b, i) => [b.id, { ...b, index: i }])
    )
    const toMap = new Map(
      toSnap.blocks.map((b, i) => [b.id, { ...b, index: i }])
    )
    const diffs = []
    for (const [id, toBlk] of toMap.entries()) {
      const fromBlk = fromMap.get(id)
      if (!fromBlk) {
        diffs.push({ blockId: id, status: "added", from: null, to: toBlk })
      } else if (
        fromBlk.content !== toBlk.content ||
        fromBlk.heading !== toBlk.heading
      ) {
        diffs.push({
          blockId: id,
          status:
            fromBlk.index !== toBlk.index ? "modified_and_moved" : "modified",
          from: fromBlk,
          to: toBlk,
        })
      } else if (fromBlk.index !== toBlk.index) {
        diffs.push({ blockId: id, status: "moved", from: fromBlk, to: toBlk })
      } else {
        diffs.push({
          blockId: id,
          status: "unchanged",
          from: fromBlk,
          to: toBlk,
        })
      }
    }
    for (const [id, fromBlk] of fromMap.entries()) {
      if (!toMap.has(id)) {
        diffs.push({ blockId: id, status: "removed", from: fromBlk, to: null })
      }
    }
    const allRevisions = store.listRevisions(skillId)
    return {
      from: { versionNumber: fromSnap.versionNumber, label: fromSnap.label },
      to: { versionNumber: toSnap.versionNumber, label: toSnap.label },
      diffs,
      revisions: allRevisions,
    }
  }

  /** @param {string} skillId @param {{ versionNumber?: number, targetDir?: string }} [options] */
  const exportSkillDirectory = async (skillId, options = {}) => {
    const snap = store.tx(
      () => resolveSnapshot(skillId, options.versionNumber),
      "read"
    )
    const requestedDir = options.targetDir ?? snap.skill.exportDir
    const baseDir = typeof requestedDir === "string" ? requestedDir.trim() : ""
    if (!baseDir || !isAbsolute(baseDir)) {
      throw new SkillStoreError(
        "INVALID_EXPORT_DIR",
        "导出目录必须为有效的绝对路径。"
      )
    }
    const result = await exportSkillSnapshot(
      baseDir,
      snap.skill.slug,
      snap.compiledMd,
      snap.assets
    )
    return {
      skillId,
      slug: snap.skill.slug,
      versionNumber: snap.versionNumber,
      ...result,
    }
  }

  const projectDetail = (detail) => ({
    ...detail,
    compiledMd: compileSkillMarkdown(detail.skill, detail.blocks),
  })

  return {
    listSkills: () => store.listSkills(),
    getSkillDetail: (skillId) =>
      projectDetail(store.tx(() => store.getSkillDetail(skillId), "read")),
    createSkill: (input) => {
      const res = projectDetail(store.createSkill(input))
      notify()
      return res
    },
    updateSkillMeta: (skillId, input) => {
      const res = projectDetail(store.updateSkillMeta(skillId, input))
      notify()
      return res
    },
    deleteSkill: (skillId) => {
      const res = store.deleteSkill(skillId)
      notify()
      return res
    },
    addBlock: (skillId, input) => {
      const res = store.addBlock(skillId, input)
      notify()
      return res
    },
    updateBlock: (skillId, blockId, input) => {
      const res = store.updateBlock(skillId, blockId, input)
      notify()
      return res
    },
    deleteBlock: (skillId, blockId, input) => {
      const res = store.deleteBlock(skillId, blockId, input)
      notify()
      return res
    },
    reorderBlocks: (skillId, input) => {
      const res = store.reorderBlocks(skillId, input)
      notify()
      return res
    },
    upsertAsset: (skillId, input) => {
      const res = store.upsertAsset(skillId, input)
      notify()
      return res
    },
    deleteAsset: (skillId, relPath, input) => {
      const res = store.deleteAsset(skillId, relPath, input)
      notify()
      return res
    },
    publishVersion: (skillId, input) => {
      const res = store.publishVersion(skillId, input, compileSkillMarkdown)
      notify()
      return res
    },
    getVersion: (skillId, versionNumber) =>
      store.getVersion(skillId, parseVersionNumber(versionNumber, 1)),
    getBlockLineage,
    compareVersions: (skillId, from, to) =>
      store.tx(() => compareVersions(skillId, from, to), "read"),
    exportSkillDirectory,
  }
}
