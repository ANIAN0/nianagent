// @ts-check
import { mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { SkillStoreError, assertSafeRelPath } from "./storage.mjs"

/** @param {string} name */
function assertPortableName(name) {
  if (
    /[<>:"|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
  ) {
    throw new SkillStoreError(
      "INVALID_EXPORT_PATH",
      "无法导出的文件名：" + name
    )
  }
}

/** @param {string} compiledMd @param {Array<{relPath: string, content: string}>} assets */
function buildManifest(compiledMd, assets) {
  const files = new Map([["SKILL.md", compiledMd]])
  const fileKeys = new Set(["skill.md"])
  const folderNames = new Map()
  for (const asset of assets) {
    if (/^[/\\]/.test(asset.relPath)) {
      throw new SkillStoreError("INVALID_EXPORT_PATH", "资产必须使用相对路径。")
    }
    const path = assertSafeRelPath(asset.relPath)
    const segments = path.split("/")
    segments.forEach(assertPortableName)
    const key = path.toLowerCase()
    if (fileKeys.has(key) || folderNames.has(key)) {
      throw new SkillStoreError("EXPORT_FILE_CONFLICT", "资产路径冲突：" + path)
    }
    for (let length = 1; length < segments.length; length += 1) {
      const folder = segments.slice(0, length).join("/")
      const folderKey = folder.toLowerCase()
      const existing = folderNames.get(folderKey)
      if (fileKeys.has(folderKey) || (existing && existing !== folder)) {
        throw new SkillStoreError(
          "EXPORT_FILE_CONFLICT",
          "资产路径冲突：" + path
        )
      }
      folderNames.set(folderKey, folder)
    }
    fileKeys.add(key)
    files.set(path, asset.content)
  }
  return files
}

/** @param {string} baseDir @param {string} slug @param {string} compiledMd @param {Array<{relPath: string, content: string}>} assets */
export async function exportSkillSnapshot(baseDir, slug, compiledMd, assets) {
  assertPortableName(slug)
  const files = buildManifest(compiledMd, assets)
  await mkdir(baseDir, { recursive: true })
  const parent = await realpath(baseDir)
  const skillDir = join(parent, slug)
  await rm(skillDir, { recursive: true, force: true })
  await mkdir(skillDir, { recursive: true })
  for (const [relPath, content] of files) {
    const file = join(skillDir, relPath)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content, "utf8")
  }
  return { skillDir, writtenFiles: [...files.keys()], cleanupPending: false }
}
