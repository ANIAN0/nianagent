import { replaceJson, withAcquiredLock } from "./atomic-file.mjs"
import { access, mkdir, readFile, realpath, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, isAbsolute, join, parse } from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import { pickNativeDirectory } from "./native-directory.mjs"

const check = (condition, message) => {
  if (!condition) throw new Error(message)
}
const identity = (path) =>
  process.platform === "win32" ? path.toLowerCase() : path
const descriptor = (path) => ({
  id: randomUUID(),
  name: basename(path) || parse(path).root,
  path,
})
export class WorkspaceService {
  constructor(directory, options = {}) {
    this.directory = directory
    this.file = join(directory, "workspaces.json")
    this.defaultCwd = options.cwd ?? process.cwd()
    this.pickDirectory = options.pickDirectory ?? pickNativeDirectory
    this.choosing = false
    this.closed = false
  }
  ensureOpen(signal) {
    signal?.throwIfAborted()
    check(!this.closed, "工作区服务已关闭，请重新打开 Moon。")
  }
  async resolve(path, signal) {
    this.ensureOpen(signal)
    check(
      typeof path === "string" && path.length <= 4096 && isAbsolute(path),
      "工作区必须使用绝对目录路径。"
    )
    try {
      const canonical = await realpath(path)
      check((await stat(canonical)).isDirectory(), "所选路径不是目录。")
      await access(canonical, constants.R_OK)
      this.ensureOpen(signal)
      return canonical
    } catch (error) {
      this.ensureOpen(signal)
      throw new Error("工作目录不存在或不可访问，请重新选择。", {
        cause: error,
      })
    }
  }
  async read() {
    let document
    try {
      document = JSON.parse(await readFile(this.file, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return null
      throw new Error("工作区文件损坏或无法读取；原文件未覆盖。", {
        cause: error,
      })
    }
    const records = document?.items
    check(
      document?.version === 1 &&
        Array.isArray(records) &&
        records.every(
          (item) =>
            item &&
            typeof item.id === "string" &&
            /^[a-zA-Z0-9_-]{1,128}$/.test(item.id) &&
            typeof item.name === "string" &&
            !!item.name &&
            typeof item.path === "string" &&
            isAbsolute(item.path)
        ) &&
        new Set(records.map((item) => item.id)).size === records.length &&
        new Set(records.map((item) => identity(item.path))).size ===
          records.length &&
        (document.selectedId === null ||
          records.some((item) => item.id === document.selectedId)),
      "工作区文件结构损坏；原文件未覆盖。"
    )
    return document
  }
  async initial(signal) {
    // Import only the host's actual current directory, never prior demo paths.
    let record
    try {
      record = descriptor(await this.resolve(this.defaultCwd, signal))
    } catch {
      this.ensureOpen(signal)
    }
    return {
      version: 1,
      items: record ? [record] : [],
      selectedId: record?.id ?? null,
    }
  }
  async transaction(change, signal) {
    this.ensureOpen(signal)
    await mkdir(this.directory, { recursive: true })
    const release = await lockfile
      .lock(this.file, {
        realpath: false,
        lockfilePath: this.file + ".lock",
        retries: { retries: 40, minTimeout: 20, maxTimeout: 100 },
      })
      .catch((error) => {
        throw new Error("工作区正在保存，请稍后重试。", { cause: error })
      })
    return withAcquiredLock(release, async (committed) => {
      this.ensureOpen(signal)
      const previous = await this.read()
      const document = previous ?? (await this.initial(signal))
      const { result, changed } = await change(document)
      if (!previous || changed) {
        this.ensureOpen(signal)
        await replaceJson(this.file, document, { signal, pretty: true })
        committed()
      }
      return result
    })
  }
  async document(signal) {
    this.ensureOpen(signal)
    return (
      (await this.read()) ??
      this.transaction(
        (document) => ({ result: document, changed: false }),
        signal
      )
    )
  }
  async present(record, signal) {
    try {
      const path = await this.resolve(record.path, signal)
      check(
        identity(path) === identity(record.path),
        "目录链接的目标已改变，请重新添加。"
      )
      return { ...record, available: true, unavailableReason: "" }
    } catch (error) {
      this.ensureOpen(signal)
      return { ...record, available: false, unavailableReason: error.message }
    }
  }
  async list(signal) {
    const document = await this.document(signal)
    const items = await Promise.all(
      document.items.map((item) => this.present(item, signal))
    )
    this.ensureOpen(signal)
    return { items, selectedId: document.selectedId }
  }
  async get(id, signal) {
    const document = await this.document(signal)
    const record = document.items.find((item) => item.id === id)
    this.ensureOpen(signal)
    return record ? this.present(record, signal) : null
  }
  async add(path, signal) {
    const canonical = await this.resolve(path, signal)
    return this.transaction(async (document) => {
      // Recheck after acquiring the write lock: deletion during lock wait is not valid.
      const current = await this.resolve(canonical, signal)
      const existing = document.items.find(
        (item) => identity(item.path) === identity(current)
      )
      const record = existing ?? descriptor(current)
      if (!existing) document.items.push(record)
      const changed = !existing || document.selectedId !== record.id
      document.selectedId = record.id
      return {
        result: { ...record, available: true, unavailableReason: "" },
        changed,
      }
    }, signal)
  }
  async select(id, signal) {
    return this.transaction(async (document) => {
      const record = document.items.find((item) => item.id === id)
      check(record, "工作区不存在，请重新读取。")
      const workspace = await this.present(record, signal)
      check(workspace.available, workspace.unavailableReason)
      const changed = document.selectedId !== id
      document.selectedId = id
      return { result: workspace, changed }
    }, signal)
  }
  async choose(signal) {
    this.ensureOpen(signal)
    check(!this.choosing, "已有目录选择窗口，请先完成或取消。")
    this.choosing = true
    try {
      const path = await this.pickDirectory(signal)
      this.ensureOpen(signal)
      return path === null ? null : await this.add(path, signal)
    } finally {
      this.choosing = false
    }
  }
  close() {
    this.closed = true
  }
}
