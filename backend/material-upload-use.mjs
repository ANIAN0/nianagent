import { readFile, realpath } from "node:fs/promises"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { replaceJson } from "./atomic-file.mjs"
import { operationError } from "./operation-issue.mjs"

/** Owner locks span the existing submission boundary, not model generation. */
export async function beginUploadUse(
  materials,
  cwd,
  references,
  identity,
  signal
) {
  const records = new Map()
  for (const reference of references) {
    let record = await materials.record(cwd, reference.id)
    if (!record.uploadToken && record.type === "file") {
      const owner = await materials.uploadOwnerForPath(
        await realpath(record.source)
      )
      if (owner) {
        if (owner.phase !== "prepared" || !owner.material)
          throw new Error("上传尚未准备或已移除，请重新引用。")
        record = {
          ...record,
          uploadToken: owner.id,
          uploadMaterialId: owner.material.id,
        }
      }
    }
    if (record.uploadToken) {
      if (!/^[a-f0-9-]{36}$/.test(record.uploadToken))
        throw new Error("上传归属记录无效。")
      records.set(record.uploadToken, record)
    }
  }
  const entries = []
  let finishing
  const finish = (outcome) =>
    (finishing ??= (async () => {
      const failures = []
      for (const entry of entries) {
        try {
          if (entry.claimed && outcome !== "unknown") {
            const next = { ...entry.value, used: outcome === "accepted" }
            delete next.pending
            await replaceJson(entry.file, next)
          }
        } catch (error) {
          failures.push(error)
        } finally {
          try {
            await entry.unlock()
          } catch (error) {
            failures.push(error)
          }
        }
      }
      if (failures.length)
        throw Object.assign(
          operationError(
            "result_unknown",
            "上传副本的采用或清理收尾未确认，原副本与提交身份保留，请核对原请求。",
            "check"
          ),
          { cause: new AggregateError(failures) }
        )
    })())
  try {
    for (const [token, record] of [...records].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      signal?.throwIfAborted()
      const file = join(materials.directory, "uploads", token, "owner.json")
      const unlock = await lockfile.lock(file, {
        realpath: false,
        retries: { retries: 40, minTimeout: 20, maxTimeout: 100 },
      })
      const entry = { file, unlock, claimed: false, value: undefined }
      entries.push(entry)
      const owner = JSON.parse(await readFile(file, "utf8"))
      entry.value = owner
      if (record.type === "file") {
        const currentOwner = await materials.uploadOwnerForPath(
          await realpath(record.source)
        )
        if (currentOwner?.id !== token)
          throw operationError(
            "material_source_changed",
            "上传引用的实际目标已变化，请重新引用。",
            "none"
          )
      }
      if (
        owner.id !== token ||
        owner.phase !== "prepared" ||
        owner.material?.id !== (record.uploadMaterialId || record.id)
      )
        throw new Error("上传文件尚未准备、归属变化或已移除。")
      if (owner.used) continue
      if (owner.pending) {
        const previous = await materials.uploadAdoption(
          owner.pending,
          record.id
        )
        if (previous === "unknown")
          throw operationError(
            "result_unknown",
            "此上传副本的原提交尚待核对，副本保留；不会覆盖原提交身份。",
            "check"
          )
        if (previous === "accepted") {
          await replaceJson(file, { ...owner, used: true, pending: undefined })
          continue
        }
      }
      entry.value = { ...owner, pending: { ...identity } }
      entry.claimed = true
      await replaceJson(file, entry.value, { signal })
    }
    return { finish, confirm: () => finish("accepted") }
  } catch (error) {
    try {
      await finish("rejected")
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "上传准备和收尾均未完成，原副本保留。",
        { cause: cleanup }
      )
    }
    throw error
  }
}
