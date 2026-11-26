import { mkdir, readFile, realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import { replaceJson, withAcquiredLock } from "./atomic-file.mjs"

const key = (path) =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path)

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}

function validate(items) {
  if (
    !Array.isArray(items) ||
    items.some(
      (item) =>
        !item?.id || typeof item.path !== "string" || !isAbsolute(item.path)
    )
  )
    throw new Error("项目登记数据损坏，请核对文件后重试。")
  return items
}

export function createProjectRegistry(directory, workspaces) {
  const file = join(directory, "projects.json")
  async function locked(action, signal) {
    await mkdir(directory, { recursive: true })
    const release = await lockfile.lock(file, {
      realpath: false,
      retries: { retries: 50, minTimeout: 20, maxTimeout: 100 },
    })
    return withAcquiredLock(release, async (committed) => {
      signal?.throwIfAborted()
      let doc = await optionalJson(file)
      if (doc === undefined) {
        const legacy = await optionalJson(
          join(directory, "plugins", "agents-md", "state.json")
        )
        doc = {
          version: 1,
          items: legacy === undefined ? [] : validate(legacy?.customProjects),
        }
        await replaceJson(file, doc, { signal })
        committed()
      }
      if (doc?.version !== 1) throw new Error("无法读取项目登记版本。")
      validate(doc.items)
      return action(doc, async () => {
        await replaceJson(file, doc, { signal })
        committed()
      })
    })
  }

  async function list(signal) {
    const custom = await locked((doc) => doc.items, signal)
    const items = (await workspaces.list(signal)).items
    const rows = new Map()
    for (const [source, entries] of [
      ["custom", custom],
      ["workspace", items],
    ]) {
      for (const entry of entries) {
        signal?.throwIfAborted()
        let path = entry.path
        let available = false
        try {
          path = await realpath(path)
          available = (await stat(path)).isDirectory()
        } catch {
          /* Keep unavailable registrations. */
        }
        const existing = rows.get(key(path))
        if (existing) {
          if (!existing.sources.includes(source)) existing.sources.push(source)
          existing.aliases.push(entry.id)
        } else
          rows.set(key(path), {
            id: entry.id,
            name: entry.name || basename(path) || path,
            path,
            sources: [source],
            aliases: [entry.id],
            available,
          })
      }
    }
    return [...rows.values()]
  }

  async function register(path, signal) {
    if (!isAbsolute(path)) throw new Error("请选择绝对目录路径。")
    const canonical = await realpath(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error("请选择目录。")
    await locked(async (doc, save) => {
      for (const item of doc.items) {
        const existing = await realpath(item.path).catch(() => item.path)
        if (key(existing) === key(canonical)) return
      }
      doc.items.push({
        id: randomUUID(),
        path: canonical,
        name: basename(canonical) || canonical,
      })
      await save()
    }, signal)
    return canonical
  }

  async function unregister(id, signal) {
    await locked(async (doc, save) => {
      const item = doc.items.find((row) => row.id === id)
      if (!item) throw new Error("该手动登记已被移除，请刷新。")
      const path = await realpath(item.path).catch(() => item.path)
      const keep = []
      for (const row of doc.items) {
        if (key(await realpath(row.path).catch(() => row.path)) !== key(path))
          keep.push(row)
      }
      doc.items = keep
      await save()
    }, signal)
  }
  return { list, register, unregister }
}
