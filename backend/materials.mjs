import {
  access,
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  rm,
  realpath,
  stat,
  readdir,
} from "node:fs/promises"
import { constants } from "node:fs"
import {
  join,
  basename,
  dirname,
  relative,
  isAbsolute,
  extname,
  resolve,
} from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { pickNativeFiles } from "./native-directory.mjs"
import { operationError } from "./operation-issue.mjs"
import { sortMaterialCatalogFiles } from "./material-catalog-sort.mjs"
import {
  resizeImage,
  formatDimensionNote,
} from "@earendil-works/pi-coding-agent"

const maximumImage = 8 * 1024 * 1024
const hash = (value) => createHash("sha256").update(value).digest("hex")
const same = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
const within = (root, path) => {
  const value = relative(root, path)
  return !value.startsWith("..") && !isAbsolute(value)
}
const bodyOf = (text) =>
  text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim()
const safe = (error, kind = "文件") =>
  /[\u4e00-\u9fff]/u.test(error?.message || "")
    ? error.message
    : `${kind}无法读取，请检查路径与权限。`
async function readableSource(path, cwd, scope) {
  const file = await open(path, "r")
  try {
    const current = await realpath(path)
    const [opened, resolved] = await Promise.all([file.stat(), stat(current)])
    if (
      !same(current, path) ||
      (scope === "workspace" && !within(cwd, current)) ||
      !opened.isFile() ||
      opened.dev !== resolved.dev ||
      opened.ino !== resolved.ino
    )
      throw operationError(
        "material_source_changed",
        "文件来源已改变，未读取新的目标；请重新选择。",
        "none"
      )
    return { file, size: opened.size }
  } catch (error) {
    await file.close()
    throw error
  }
}
async function boundedSource(path, cwd, scope, maximum) {
  const { file, size } = await readableSource(path, cwd, scope)
  try {
    if (size > maximum)
      throw operationError(
        "material_invalid",
        "材料超过允许的读取大小，请选择较小文件。",
        "none"
      )
    const buffer = Buffer.alloc(Math.min(size, maximum) + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const read = await file.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead
      )
      if (!read.bytesRead) break
      bytesRead += read.bytesRead
    }
    if (bytesRead > maximum || bytesRead > size)
      throw operationError(
        "material_source_changed",
        "材料在读取期间变化或超过限制，请重新选择。",
        "none"
      )
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}
function imageType(data) {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png"
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg"
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString()))
    return "image/gif"
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp"
  return ""
}
export class MaterialService {
  constructor(directory, sessions) {
    this.directory = join(directory, "materials")
    this.sessions = sessions
  }
  reference(record) {
    return {
      id: record.id,
      name: record.name,
      kind: record.type === "skill" ? "Skill" : "附件",
      type: record.type,
      status: "ready",
      source: record.source,
      description: record.description || "",
      ...(record.mimeType
        ? { mimeType: record.mimeType, bytes: record.bytes }
        : {}),
    }
  }
  async save(record, signal) {
    signal?.throwIfAborted()
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify(record), {
        mode: 0o600,
        flag: "wx",
      })
      signal?.throwIfAborted()
      await rename(temporary, join(this.directory, `${record.id}.json`))
    } finally {
      await rm(temporary, { force: true })
    }
    return this.reference(record)
  }
  async record(cwd, id) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw operationError(
        "material_invalid",
        "材料标识无效，请重新选择。",
        "none"
      )
    let record
    try {
      record = JSON.parse(
        await readFile(join(this.directory, `${id}.json`), "utf8")
      )
    } catch (error) {
      if (error instanceof SyntaxError || error.code === "ENOENT")
        throw operationError(
          "material_invalid",
          "已准备材料不存在或已损坏，请重新选择。",
          "none"
        )
      // An inaccessible cache is different from permanently missing content.
      // Keep the filesystem cause so normal storage recovery remains possible.
      throw error
    }
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      record.id !== id ||
      typeof record.cwd !== "string" ||
      typeof record.name !== "string" ||
      !record.name ||
      typeof record.source !== "string" ||
      !record.source ||
      !same(record.cwd, cwd) ||
      !["file", "directory", "image", "skill"].includes(record.type)
    )
      throw operationError(
        "material_invalid",
        "材料不属于当前工作目录，请重新选择。",
        "none"
      )
    return record
  }
  async choose(sessionId, cwd, signal) {
    this.sessions.identity(sessionId)
    cwd = await this.sessions.cwd(cwd)
    const paths = await pickNativeFiles(signal)
    return paths ? this.prepare(sessionId, cwd, paths, signal) : []
  }
  async prepare(sessionId, cwd, paths, scope = "selected", signal) {
    // Keep existing direct/native callers' AbortSignal position compatible.
    if (scope instanceof AbortSignal) {
      signal = scope
      scope = "selected"
    }
    if (scope === undefined) scope = "selected"
    if (!["selected", "workspace"].includes(scope))
      throw new Error("材料读取范围无效。")
    this.sessions.identity(sessionId)
    cwd = await this.sessions.cwd(cwd)
    const resources = await this.sessions.skillResources(cwd, sessionId, signal)
    const results = []
    for (const source of paths) {
      signal?.throwIfAborted()
      let sourceType = "file"
      try {
        if (scope !== "workspace" && !isAbsolute(source))
          throw new Error("请选择文件的实际绝对路径。")
        const path = await realpath(
          scope === "workspace" ? resolve(cwd, source) : source
        )
        if (scope === "workspace" && !within(cwd, path))
          throw operationError(
            "material_outside_workspace",
            "该链接不在当前工作目录内，未读取文件。",
            "none"
          )
        const sourceStat = await stat(path)
        if (sourceStat.isDirectory()) sourceType = "directory"
        if (!sourceStat.isFile() && !sourceStat.isDirectory())
          throw new Error("所选路径不是文件或目录。")
        await access(path, constants.R_OK)
        if (sourceStat.isDirectory()) {
          if (!within(cwd, path))
            throw operationError(
              "material_outside_workspace",
              "仅支持引用当前工作区内的目录。",
              "none"
            )
          results.push(
            await this.save(
              {
                id: hash(`${cwd}\0directory\0${path}`),
                cwd,
                type: "directory",
                name: basename(path),
                source: path,
                description: relative(cwd, path),
                scope: "workspace",
              },
              signal
            )
          )
          continue
        }
        const skill = resources.skills.find((item) => same(item.filePath, path))
        if (skill) {
          if (
            resources.diagnostics.some(
              (item) => item.collision?.name === skill.name
            )
          )
            throw new Error("同名Skill存在来源冲突，请先消除冲突后再使用。")
          const content = bodyOf(
            (await boundedSource(path, cwd, scope, 512 * 1024)).toString("utf8")
          )
          if (Buffer.byteLength(content) > 512 * 1024)
            throw new Error("Skill正文超过512KiB，请精简说明后重新选择。")
          results.push(
            await this.save(
              {
                id: hash(`${cwd}\0skill\0${path}\0${content}`),
                cwd,
                type: "skill",
                name: skill.name,
                source: path,
                description: skill.description,
                baseDir: skill.baseDir,
                content,
              },
              signal
            )
          )
        } else if (
          [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(
            extname(path).toLowerCase()
          )
        ) {
          const size = (await stat(path)).size
          if (size > maximumImage)
            throw operationError(
              "material_invalid",
              "图片超过8MiB，请选择较小图片。",
              "none"
            )
          results.push(
            await this.saveImage(
              cwd,
              basename(path),
              path,
              await boundedSource(path, cwd, scope, maximumImage),
              signal
            )
          )
        } else
          results.push(
            await this.save(
              {
                id: hash(`${cwd}\0file\0${path}`),
                cwd,
                type: "file",
                name: basename(path),
                source: path,
                description: within(cwd, path)
                  ? relative(cwd, path)
                  : dirname(path),
                scope,
              },
              signal
            )
          )
      } catch (error) {
        if (signal?.aborted) throw error
        results.push({
          id: hash(`${cwd}\0failed\0${source}`),
          name: basename(source),
          kind: "附件",
          type: sourceType,
          status: "failed",
          source,
          error: safe(error, sourceType === "directory" ? "目录" : "文件"),
          retryable: error.issue?.recovery !== "none",
        })
      }
    }
    return results
  }
  async saveImage(cwd, name, source, data, signal) {
    if (data.length > maximumImage)
      throw operationError(
        "material_invalid",
        "图片超过8MiB，请选择较小图片。",
        "none"
      )
    const mimeType = imageType(data)
    if (!mimeType)
      throw operationError(
        "material_invalid",
        "暂支持 PNG、JPEG、WebP 和 GIF 图片；所选内容不是有效图片。",
        "none"
      )
    const piImage = await resizeImage(data, mimeType)
    signal?.throwIfAborted()
    if (!piImage)
      throw operationError(
        "material_invalid",
        "Pi无法解码这张图片，请检查图片内容或重新选择。",
        "none"
      )
    // Keep the original for history; Pi's public preparation keeps inference
    // images within its documented provider-compatible dimensions/byte budget.
    return this.save(
      {
        id: hash(`${cwd}\0image\0${name}\0${hash(data)}`),
        cwd,
        name,
        source,
        type: "image",
        mimeType,
        bytes: data.length,
        data: data.toString("base64"),
        piImage,
      },
      signal
    )
  }
  // Official Pi image outputs already belong to the transcript. Store their
  // fixed bytes in the same cache as input images, even after cwd was removed.
  // This is an internal projection capability, not a second upload endpoint.
  async captureImage(cwd, name, mimeType, data, signal) {
    cwd = resolve(cwd)
    name =
      name.slice(0, 490) +
      ({
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
      }[mimeType] || "")
    const source = "Pi 正式消息中的固定图片"
    const failure = (error) => ({
      id: hash(`${cwd}\0failed-image\0${name}`),
      name,
      kind: "附件",
      type: "image",
      status: "failed",
      source,
      error: safe(error),
      retryable: error.issue?.recovery !== "none",
    })
    try {
      signal?.throwIfAborted()
      if (
        typeof data !== "string" ||
        data.length > 12 * 1024 * 1024 ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(data)
      )
        throw operationError(
          "material_invalid",
          "Pi返回的图片内容无效或超过预览限制。",
          "none"
        )
      const bytes = Buffer.from(data, "base64")
      if (imageType(bytes) !== mimeType)
        throw operationError(
          "material_invalid",
          "Pi返回的图片类型无法预览。",
          "none"
        )
      const id = hash(`${cwd}\0image\0${name}\0${hash(bytes)}`)
      try {
        const saved = await this.record(cwd, id)
        await this.verify(saved, "", signal)
        return this.reference(saved)
      } catch (error) {
        if (signal?.aborted) throw error
        // Invalid/missing derived cache can be rebuilt from Pi's authoritative
        // fixed output. Other filesystem failures retain the normal recovery.
        if (error.issue?.code !== "material_invalid") throw error
      }
      return await this.saveImage(cwd, name, source, bytes, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      return failure(error)
    }
  }
  async upload(sessionId, cwd, name, mimeType, data, signal) {
    this.sessions.identity(sessionId)
    cwd = await this.sessions.cwd(cwd)
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(mimeType) ||
      !/^[a-zA-Z0-9+/]*={0,2}$/.test(data)
    )
      throw operationError(
        "material_invalid",
        "仅支持有效 PNG、JPEG、WebP 和 GIF 图片。",
        "none"
      )
    const buffer = Buffer.from(data, "base64")
    if (imageType(buffer) !== mimeType)
      throw operationError(
        "material_invalid",
        "图片类型与实际内容不一致，请重新选择。",
        "none"
      )
    return this.saveImage(
      cwd,
      name || "粘贴图片",
      "粘贴或拖入的图片",
      buffer,
      signal
    )
  }
  async catalog(sessionId, cwd, query = "", signal) {
    this.sessions.identity(sessionId)
    cwd = await this.sessions.cwd(cwd)
    const resources = await this.sessions.skillResources(cwd, sessionId, signal)
    const diagnostics = resources.diagnostics.map((item) => ({
      scope: "skills",
      message: item.message,
    }))
    const lower = query.replaceAll("\\", "/").toLowerCase()
    const browsing = lower.endsWith("/")
    const browsePath = browsing
      ? await realpath(resolve(cwd, query.replaceAll("\\", "/")))
      : cwd
    if (!within(cwd, browsePath))
      throw operationError(
        "material_outside_workspace",
        "该目录不在当前工作区内。",
        "none"
      )
    const files = []
    let examined = 0
    let limited = false
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        signal?.throwIfAborted()
        if (++examined > 15000) {
          limited = true
          return
        }
        if (
          [".git", "node_modules", "target", "dist", ".dev"].includes(
            entry.name
          )
        )
          continue
        const path = join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (
            browsing ||
            relative(cwd, path)
              .replaceAll("\\", "/")
              .toLowerCase()
              .includes(lower)
          ) {
            const actual = await realpath(path)
            if (within(cwd, actual))
              files.push({
                id: hash(`${cwd}\0directory\0${actual}`),
                name: entry.name,
                kind: "附件",
                type: "directory",
                status: "ready",
                source: actual,
                description: relative(cwd, actual),
              })
          }
          if (browsing) continue
          try {
            await walk(path)
          } catch (error) {
            if (signal?.aborted) throw error
            if (diagnostics.length < 60)
              diagnostics.push({
                scope: "files",
                message: `目录“${relative(cwd, path)}”不可读取，未列出其文件。`,
              })
          }
          if (limited) return
        } else if (
          entry.isFile() &&
          (browsing ||
            relative(cwd, path)
              .replaceAll("\\", "/")
              .toLowerCase()
              .includes(lower))
        ) {
          try {
            const actual = await realpath(path)
            if (!within(cwd, actual)) continue
            await access(actual, constants.R_OK)
            files.push({
              id: hash(`${cwd}\0file\0${actual}`),
              name: entry.name,
              kind: "附件",
              type: "file",
              status: "ready",
              source: actual,
              description: relative(cwd, actual),
            })
          } catch {
            /* Unreadable files are not available candidates. */
          }
        }
      }
    }
    await walk(browsePath)
    const sortedFiles = sortMaterialCatalogFiles(files, query).slice(0, 60)
    if (limited || files.length > 60)
      diagnostics.push({
        scope: "files",
        message: "文件结果有数量限制，请输入更具体的相对路径。",
      })
    const skills = resources.skills
      .filter((item) =>
        `${item.name} ${item.description} ${item.filePath}`
          .toLowerCase()
          .includes(lower)
      )
      .slice(0, 60)
      .map((item) => ({
        id: hash(`${cwd}\0skill-source\0${item.filePath}`),
        name: item.name,
        kind: "Skill",
        type: "skill",
        status: resources.diagnostics.some(
          (diagnostic) => diagnostic.collision?.name === item.name
        )
          ? "failed"
          : "ready",
        source: item.filePath,
        description: item.description,
        ...(resources.diagnostics.some(
          (diagnostic) => diagnostic.collision?.name === item.name
        )
          ? { error: "同名Skill存在来源冲突，请先消除冲突。" }
          : {}),
      }))
    return {
      cwd,
      files: sortedFiles,
      skills,
      diagnostics,
      commands: this.sessions.commands?.catalog(sessionId) || [],
    }
  }
  async verify(record, sessionId, signal) {
    signal?.throwIfAborted()
    if (record.type === "image") {
      const data =
        typeof record.data === "string"
          ? Buffer.from(record.data, "base64")
          : null
      if (
        !data ||
        !imageType(data) ||
        record.id !==
          hash(`${record.cwd}\0image\0${record.name}\0${hash(data)}`)
      )
        throw operationError(
          "material_invalid",
          "保存的图片内容损坏，请重新选择。",
          "none"
        )
      return
    }
    try {
      const currentPath = await realpath(record.source)
      if (
        !same(currentPath, record.source) ||
        (record.scope === "workspace" && !within(record.cwd, currentPath))
      )
        throw new Error()
      const sourceStat = await stat(record.source)
      if (
        record.type === "directory"
          ? !sourceStat.isDirectory()
          : !sourceStat.isFile()
      )
        throw new Error()
      await access(record.source, constants.R_OK)
    } catch {
      throw new Error("引用来源已不存在或不可读，请重新选择或移除。")
    }
    if (record.type === "skill") {
      const resources = await this.sessions.skillResources(
        record.cwd,
        sessionId,
        signal
      )
      if (
        !resources.skills.some((item) => same(item.filePath, record.source)) ||
        resources.diagnostics.some(
          (item) => item.collision?.name === record.name
        )
      )
        throw new Error("Skill已失效或存在同名冲突，请重新选择。")
    }
  }
  async restore(sessionId, cwd, materials = [], signal) {
    this.sessions.identity(sessionId)
    cwd = await this.sessions.cwd(cwd)
    const output = []
    for (const material of materials) {
      signal?.throwIfAborted()
      // Initial path preparation can fail before installing any fixed record.
      // Its separate identity namespace survives a draft round-trip without
      // rereading the source; only an explicit retry may prepare that path again.
      // Fixed image/file/directory/Skill records never have this provisional identity.
      if (
        material.kind === "附件" &&
        ["file", "directory"].includes(material.type) &&
        ["failed", "preparing"].includes(material.status) &&
        typeof material.source === "string" &&
        isAbsolute(material.source) &&
        material.id === hash(`${cwd}\0failed\0${material.source}`)
      ) {
        output.push({
          ...material,
          status: "failed",
          error:
            material.error ||
            `${material.type === "directory" ? "目录" : "文件"}尚未检查，${material.retryable === false ? "请重新选择或移除。" : "请重新检查。"}`,
          retryable: material.retryable !== false,
        })
        continue
      }
      try {
        const record = await this.record(cwd, material.id)
        await this.verify(record, sessionId, signal)
        output.push(this.reference(record))
      } catch (error) {
        if (signal?.aborted) throw error
        output.push({
          ...material,
          status: "failed",
          error: safe(error),
          retryable: error.issue?.recovery !== "none",
        })
      }
    }
    return output
  }
  async preview(cwd, id, signal) {
    if (!isAbsolute(cwd)) throw new Error("材料工作目录无效。")
    // Fixed history images remain viewable after their workspace is removed.
    cwd = resolve(cwd)
    const record = await this.record(cwd, id)
    signal?.throwIfAborted()
    const result = {
      id,
      name: record.name,
      label:
        record.type === "directory"
          ? "当前目录"
          : record.type === "file"
            ? "当前文件"
            : record.type === "skill"
              ? "本次 Skill 内容"
              : "固定图片",
      source: record.source,
      content: "",
      mimeType: record.mimeType || "",
      data: record.data || "",
      truncated: false,
    }
    if (record.type === "skill") result.content = record.content
    if (record.type === "directory") {
      await this.verify(record, "", signal)
      const entries = await readdir(record.source, { withFileTypes: true })
      result.content = entries
        .filter((entry) => !entry.isSymbolicLink())
        .slice(0, 200)
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .join("\n")
      result.truncated = entries.length > 200
    }
    if (record.type === "file") {
      const { file, size } = await readableSource(
        record.source,
        cwd,
        record.scope
      )
      if (size > 128 * 1024) {
        result.truncated = true
      }
      // Bound the read itself, not only its returned string.
      try {
        const buffer = Buffer.alloc(Math.min(size, 128 * 1024))
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        const data = buffer.subarray(0, bytesRead)
        if (data.includes(0)) result.content = "该格式文件暂时无法预览。"
        else result.content = data.toString("utf8")
      } finally {
        await file.close()
      }
    }
    signal?.throwIfAborted()
    return result
  }
  async resolveForPrompt({
    sessionId,
    cwd,
    materials = [],
    text = "",
    model,
    signal,
    nativeSkills = false,
  }) {
    const parts = []
    const referencedFiles = []
    const images = []
    const displayMaterials = []
    const seen = new Set()
    cwd = await this.sessions.cwd(cwd)
    // Native idle prompts let Pi interpret the unmodified leading command.
    // The default remains the prepared protocol used by existing queues.
    const command = !nativeSkills && text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/u)
    if (command) {
      const resources = await this.sessions.skillResources(
        cwd,
        sessionId,
        signal
      )
      const matching = resources.skills.filter(
        (item) => item.name === command[1]
      )
      if (
        matching.length !== 1 ||
        resources.diagnostics.some(
          (item) => item.collision?.name === command[1]
        )
      )
        throw new Error("此Skill调用不存在或来源不唯一，请从候选中重新选择。")
      const selected = matching[0]
      // The visible /skill invocation and the picker reference are one source.
      if (
        !materials.some(
          (item) =>
            item.type === "skill" &&
            typeof item.source === "string" &&
            same(item.source, selected.filePath)
        )
      ) {
        const [prepared] = await this.prepare(
          sessionId,
          cwd,
          [selected.filePath],
          signal
        )
        if (prepared.status !== "ready")
          throw new Error(prepared.error || "Skill准备失败，请重新选择。")
        materials = [...materials, prepared]
      }
      text = command[2] ?? ""
    }
    for (const material of materials) {
      if (nativeSkills && (material.type === "skill" || material.kind === "Skill")) continue
      if (material.status !== "ready")
        throw new Error(`材料“${material.name}”尚未就绪，请重新选择或移除。`)
      const record = await this.record(cwd, material.id)
      const identity =
        record.type === "image" ? record.id : `${record.type}:${record.source}`
      if (seen.has(identity)) continue
      seen.add(identity)
      await this.verify(record, sessionId, signal)
      if (record.type === "image") {
        if (!model?.input?.includes("image"))
          throw new Error(
            `当前模型不支持图片“${record.name}”，请选择视觉模型或移除图片。`
          )
        const prepared =
          record.piImage ??
          (await resizeImage(
            Buffer.from(record.data, "base64"),
            record.mimeType
          ))
        signal?.throwIfAborted()
        if (!prepared)
          throw new Error(`图片“${record.name}”无法由Pi解码，请重新选择。`)
        images.push({
          type: "image",
          mimeType: prepared.mimeType,
          data: prepared.data,
        })
        const note = formatDimensionNote(prepared)
        if (note) parts.push(`Image ${JSON.stringify(record.name)}: ${note}`)
      } else if (record.type === "file" || record.type === "directory") {
        // Keep the verified absolute identity, using the DSH @"path" mention
        // seam. Windows forward slashes avoid JSON-escaped backslash ambiguity;
        // a POSIX filename may contain a literal backslash and must keep it.
        const path =
          process.platform === "win32"
            ? record.source.replaceAll("\\", "/")
            : record.source
        referencedFiles.push(
          `${record.type === "directory" ? "Directory: " : ""}@${JSON.stringify(path)}`
        )
      } else
        parts.push(
          `<skill name=${JSON.stringify(record.name)} location=${JSON.stringify(record.source)}>\nReferences are relative to ${record.baseDir}.\n\n${record.content}\n</skill>`
        )
      displayMaterials.push(this.reference(record))
    }
    if (referencedFiles.length)
      parts.unshift(
        [
          displayMaterials.some((item) => item.type === "directory")
            ? "Referenced paths (not read):"
            : "Referenced files (not read):",
          ...referencedFiles,
          "These @-prefixed absolute paths are files or directories the user explicitly selected. Their contents are not included and have not been read.",
          "When the user's task needs their contents, use the enabled read tool with the exact path inside the quotes. Do not guess substitute filenames or claim to have inspected a file before a successful read. If the read tool is unavailable or reading fails, explain the limitation.",
          "A Skill base directory applies only to relative resources inside that Skill. It must not reinterpret the user-referenced absolute file paths above.",
        ].join("\n")
      )
    return {
      text,
      textPrefix: parts.length ? `${parts.join("\n\n")}\n\n` : "",
      images,
      displayMaterials,
    }
  }
}
