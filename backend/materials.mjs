import { access, mkdir, readFile, writeFile, rename, rm, realpath, stat, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { join, basename, dirname, relative, isAbsolute, extname, resolve } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { pickNativeFiles } from "./native-directory.mjs"

const maximumImage = 8 * 1024 * 1024
const hash = (value) => createHash("sha256").update(value).digest("hex")
const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
const within = (root, path) => { const value = relative(root, path); return !value.startsWith("..") && !isAbsolute(value) }
const bodyOf = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim()
const safe = (error) => /[\u4e00-\u9fff]/u.test(error?.message || "") ? error.message : "文件无法读取，请检查路径与权限。"
function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png"
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString())) return "image/gif"
  if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return "image/webp"
  return ""
}
export class MaterialService {
  constructor(directory, sessions) { this.directory = join(directory, "materials"); this.sessions = sessions }
  reference(record) {
    return { id: record.id, name: record.name, kind: record.type === "skill" ? "Skill" : "附件", type: record.type, status: "ready", source: record.source, description: record.description || "", ...(record.mimeType ? { mimeType: record.mimeType, bytes: record.bytes } : {}) }
  }
  async save(record, signal) {
    signal?.throwIfAborted()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    try { await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" }); signal?.throwIfAborted(); await rename(temporary, join(this.directory, `${record.id}.json`)) }
    finally { await rm(temporary, { force: true }) }
    return this.reference(record)
  }
  async record(cwd, id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("材料标识无效，请重新选择。")
    let record
    try { record = JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")) }
    catch { throw new Error("已准备材料不存在或已损坏，请重新选择。") }
    if (record.id !== id || !same(record.cwd, cwd) || !["file", "image", "skill"].includes(record.type)) throw new Error("材料不属于当前工作目录，请重新选择。")
    return record
  }
  async choose(sessionId, cwd, signal) { this.sessions.identity(sessionId); cwd = await this.sessions.cwd(cwd); const paths = await pickNativeFiles(signal); return paths ? this.prepare(sessionId, cwd, paths, signal) : [] }
  async prepare(sessionId, cwd, paths, signal) {
    this.sessions.identity(sessionId); cwd = await this.sessions.cwd(cwd)
    const resources = await this.sessions.skillResources(cwd, sessionId, signal)
    const results = []
    for (const source of paths) {
      signal?.throwIfAborted()
      try {
        if (!isAbsolute(source)) throw new Error("请选择文件的实际绝对路径。")
        const path = await realpath(source)
        if (!(await stat(path)).isFile()) throw new Error("所选路径不是文件。")
        await access(path, constants.R_OK)
        const skill = resources.skills.find((item) => same(item.filePath, path))
        if (skill) {
          if (resources.diagnostics.some((item) => item.collision?.name === skill.name)) throw new Error("同名Skill存在来源冲突，请先消除冲突后再使用。")
          const content = bodyOf(await readFile(path, "utf8"))
          if (Buffer.byteLength(content) > 512 * 1024) throw new Error("Skill正文超过512KiB，请精简说明后重新选择。")
          results.push(await this.save({ id: hash(`${cwd}\0skill\0${path}\0${content}`), cwd, type: "skill", name: skill.name, source: path, description: skill.description, baseDir: skill.baseDir, content }, signal))
        } else if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extname(path).toLowerCase())) {
          const size = (await stat(path)).size
          if (size > maximumImage) throw new Error("图片超过8MiB，请选择较小图片。")
          results.push(await this.saveImage(cwd, basename(path), path, await readFile(path), signal))
        } else results.push(await this.save({ id: hash(`${cwd}\0file\0${path}`), cwd, type: "file", name: basename(path), source: path, description: within(cwd, path) ? relative(cwd, path) : dirname(path) }, signal))
      } catch (error) { if (signal?.aborted) throw error; results.push({ id: hash(`${cwd}\0failed\0${source}`), name: basename(source), kind: "附件", type: "file", status: "failed", source, error: safe(error) }) }
    }
    return results
  }
  async saveImage(cwd, name, source, data, signal) {
    if (data.length > maximumImage) throw new Error("图片超过8MiB，请选择较小图片。")
    const mimeType = imageType(data)
    if (!mimeType) throw new Error("暂支持 PNG、JPEG、WebP 和 GIF 图片；所选内容不是有效图片。")
    return this.save({ id: hash(`${cwd}\0image\0${name}\0${hash(data)}`), cwd, name, source, type: "image", mimeType, bytes: data.length, data: data.toString("base64") }, signal)
  }
  async upload(sessionId, cwd, name, mimeType, data, signal) {
    this.sessions.identity(sessionId); cwd = await this.sessions.cwd(cwd)
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeType) || !/^[a-zA-Z0-9+/]*={0,2}$/.test(data)) throw new Error("仅支持有效 PNG、JPEG、WebP 和 GIF 图片。")
    const buffer = Buffer.from(data, "base64")
    if (imageType(buffer) !== mimeType) throw new Error("图片类型与实际内容不一致，请重新选择。")
    return this.saveImage(cwd, name || "粘贴图片", "粘贴或拖入的图片", buffer, signal)
  }
  async catalog(sessionId, cwd, query = "", signal) {
    this.sessions.identity(sessionId); cwd = await this.sessions.cwd(cwd)
    const resources = await this.sessions.skillResources(cwd, sessionId, signal)
    const diagnostics = resources.diagnostics.map((item) => item.message)
    const lower = query.toLowerCase(); const files = []; let examined = 0; let limited = false
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        signal?.throwIfAborted()
        if (++examined > 15000) { limited = true; return }
        if ([".git", "node_modules", "target", "dist", ".dev"].includes(entry.name)) continue
        const path = join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) { await walk(path); if (limited) return }
        else if (entry.isFile() && relative(cwd, path).toLowerCase().includes(lower)) {
          try { const actual = await realpath(path); if (!within(cwd, actual)) continue; await access(actual, constants.R_OK); if (files.length < 60) files.push({ id: hash(`${cwd}\0file\0${actual}`), name: entry.name, kind: "附件", type: "file", status: "ready", source: actual, description: relative(cwd, actual) }) }
          catch { /* Unreadable files are not available candidates. */ }
        }
      }
    }
    await walk(cwd)
    if (limited || files.length === 60) diagnostics.push("文件结果有数量限制，请输入更具体的相对路径。")
    const skills = resources.skills.filter((item) => `${item.name} ${item.description} ${item.filePath}`.toLowerCase().includes(lower)).slice(0, 60).map((item) => ({ id: hash(`${cwd}\0skill-source\0${item.filePath}`), name: item.name, kind: "Skill", type: "skill", status: resources.diagnostics.some((diagnostic) => diagnostic.collision?.name === item.name) ? "failed" : "ready", source: item.filePath, description: item.description, ...(resources.diagnostics.some((diagnostic) => diagnostic.collision?.name === item.name) ? { error: "同名Skill存在来源冲突，请先消除冲突。" } : {}) }))
    return { cwd, files, skills, diagnostics }
  }
  async verify(record, sessionId, signal) {
    signal?.throwIfAborted()
    if (record.type === "image") { if (!imageType(Buffer.from(record.data, "base64"))) throw new Error("保存的图片内容损坏，请重新选择。"); return }
    try { if (!(await stat(record.source)).isFile()) throw new Error(); await access(record.source, constants.R_OK) }
    catch { throw new Error("引用来源已不存在或不可读，请重新选择或移除。") }
    if (record.type === "skill") {
      const resources = await this.sessions.skillResources(record.cwd, sessionId, signal)
      if (!resources.skills.some((item) => same(item.filePath, record.source)) || resources.diagnostics.some((item) => item.collision?.name === record.name)) throw new Error("Skill已失效或存在同名冲突，请重新选择。")
    }
  }
  async restore(sessionId, cwd, materials = [], signal) {
    this.sessions.identity(sessionId); cwd = await this.sessions.cwd(cwd)
    const output = []
    for (const material of materials) {
      try { const record = await this.record(cwd, material.id); await this.verify(record, sessionId, signal); output.push(this.reference(record)) }
      catch (error) { if (signal?.aborted) throw error; output.push({ ...material, status: "failed", error: safe(error) }) }
    }
    return output
  }
  async preview(cwd, id, signal) {
    if (!isAbsolute(cwd)) throw new Error("材料工作目录无效。")
    // Fixed history images remain viewable after their workspace is removed.
    cwd = resolve(cwd); const record = await this.record(cwd, id); signal?.throwIfAborted()
    const result = { id, name: record.name, label: record.type === "file" ? "当前文件" : record.type === "skill" ? "本次 Skill 内容" : "固定图片", source: record.source, content: "", mimeType: record.mimeType || "", data: record.data || "", truncated: false }
    if (record.type === "skill") result.content = record.content
    if (record.type === "file") {
      const size = (await stat(record.source)).size
      if (size > 128 * 1024) { result.truncated = true }
      // Bound the read itself, not only its returned string.
      const { open } = await import("node:fs/promises"); const file = await open(record.source, "r")
      try { const buffer = Buffer.alloc(Math.min(size, 128 * 1024)); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); const data = buffer.subarray(0, bytesRead); if (data.includes(0)) result.content = "该格式文件暂时无法预览。"; else result.content = data.toString("utf8") }
      finally { await file.close() }
    }
    signal?.throwIfAborted(); return result
  }
  async resolveForPrompt({ sessionId, cwd, materials = [], model, signal }) {
    const parts = []; const images = []; const displayMaterials = []; const seen = new Set()
    cwd = await this.sessions.cwd(cwd)
    for (const material of materials) {
      if (material.status !== "ready") throw new Error(`材料“${material.name}”尚未就绪，请重新选择或移除。`)
      const record = await this.record(cwd, material.id); if (seen.has(record.id)) continue; seen.add(record.id)
      await this.verify(record, sessionId, signal)
      if (record.type === "image") { if (!model?.input?.includes("image")) throw new Error(`当前模型不支持图片“${record.name}”，请选择视觉模型或移除图片。`); images.push({ type: "image", mimeType: record.mimeType, data: record.data }) }
      else if (record.type === "file") parts.push(`Referenced file: ${JSON.stringify(record.source)}. Read this path with an enabled file tool when needed; this reference is not a claim that it has been read.`)
      else parts.push(`<skill name=${JSON.stringify(record.name)} location=${JSON.stringify(record.source)}>\nReferences are relative to ${record.baseDir}.\n\n${record.content}\n</skill>`)
      displayMaterials.push(this.reference(record))
    }
    return { textPrefix: parts.length ? `${parts.join("\n\n")}\n\n` : "", images, displayMaterials }
  }
}
