import {
  mkdir,
  open,
  readFile,
  readdir,
  lstat,
  realpath,
  rm,
} from "node:fs/promises"
import { join, basename, resolve, dirname } from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import { replaceJson, withAcquiredLock } from "../../atomic-file.mjs"

const limit = 8 * 1024 * 1024,
  windowSize = 2 * 1024 * 1024
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const text = { type: "string", maxLength: 4096 },
  token = { type: "string", pattern: "^[a-f0-9-]{36}$" }
const output = object({ value: { type: "object", additionalProperties: true } })
export function uploadOperations(host) {
  const materials = host.services().materials,
    root = resolve(materials.directory, "uploads")
  let admission = Promise.resolve()
  const reservations = new Map()
  const admit = (action) => {
    const result = admission.then(action)
    admission = result.catch(() => {})
    return result
  }
  const ordinaryDirectory = async (directory) => {
    if (
      (await lstat(directory)).isSymbolicLink() ||
      (await realpath(directory)).toLowerCase() !==
        resolve(directory).toLowerCase()
    )
      throw new Error("上传目录归属变化，原副本保留。")
  }
  const isolated = async (id) => {
    try {
      const value = JSON.parse(
        await readFile(join(root, id, "reservation-isolated.json"), "utf8")
      )
      return value?.id === id && value?.isolated === true
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return false
      throw error
    }
  }
  const reservation = async (id) => {
    const directory = join(root, id)
    await ordinaryDirectory(directory)
    if (await isolated(id)) return null
    let raw = null,
      value = null,
      stamp = null
    try {
      const info = await lstat(join(directory, "owner.json"))
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("上传归属文件不是普通文件，原副本保留。")
      raw = await readFile(join(directory, "owner.json"), "utf8")
      stamp = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(
        ":"
      )
      try {
        value = JSON.parse(raw)
      } catch {
        /* The original bytes remain untouched. */
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    const valid =
      value?.id === id &&
      typeof value.clientId === "string" &&
      !!value.clientId &&
      typeof value.profileId === "string" &&
      !!value.profileId &&
      typeof value.phase === "string"
    if (valid && value.phase !== "receiving") return null
    return { raw, stamp, value: valid ? value : null }
  }
  const receiving = async (context) => {
    let total = 0,
      own = 0
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!/^[a-f0-9-]{36}$/.test(directory.name)) continue
      if (directory.isSymbolicLink()) {
        total++
        continue
      }
      if (!directory.isDirectory()) continue
      let slot
      try {
        slot = await reservation(directory.name)
      } catch {
        total++
        continue
      }
      if (!slot) continue
      const value = slot.value
      total++
      if (
        value?.clientId === context.clientId &&
        value?.profileId === context.profileId
      )
        own++
    }
    return { total, own }
  }
  const dataPath = (value) =>
    join(
      root,
      value.id,
      ...(value.storageDirectory === "file" ? ["file"] : []),
      value.name
    )
  const operation = (input, execute, remote = true) => ({
    remote,
    input,
    output,
    execute: async (...args) => ({ value: await execute(...args) }),
  })
  const record = async (id, context) => {
    await ordinaryDirectory(root)
    await ordinaryDirectory(join(root, id))
    if (await isolated(id))
      throw new Error("此上传接收已在本机取消占位；原副本保留，请重新上传。")
    const file = join(root, id, "owner.json")
    const value = JSON.parse(await readFile(file, "utf8"))
    if (
      value.id !== id ||
      basename(value.name || "") !== value.name ||
      !value.name ||
      dirname(resolve(root, id, value.name)) !== resolve(root, id)
    )
      throw new Error("上传归属或路径变化，副本保留。")
    if (
      value.clientId !== context.clientId ||
      value.profileId !== context.profileId
    )
      throw new Error("上传不属于当前端。")
    return { value, file }
  }
  const locked = async (id, context, action) => {
    const unlock = await lockfile.lock(join(root, id, "owner.json"), {
      realpath: false,
      retries: { retries: 40, minTimeout: 20, maxTimeout: 100 },
    })
    return withAcquiredLock(unlock, async (committed) => {
      const { value, file } = await record(id, context)
      return action(value, file, committed)
    })
  }
  return {
    uploadReservations: operation(
      object({}),
      async () => {
        await mkdir(root, { recursive: true })
        await ordinaryDirectory(root)
        reservations.clear()
        const items = []
        let more = false
        for (const directory of await readdir(root, { withFileTypes: true })) {
          if (
            !directory.isDirectory() ||
            directory.isSymbolicLink() ||
            !/^[a-f0-9-]{36}$/.test(directory.name)
          )
            continue
          let slot
          try {
            slot = await reservation(directory.name)
          } catch {
            continue
          }
          if (!slot) continue
          if (items.length >= 100) {
            more = true
            continue
          }
          const version = randomUUID()
          reservations.set(version, {
            id: directory.name,
            raw: slot.raw,
            stamp: slot.stamp,
          })
          items.push({
            token: directory.name,
            version,
            name:
              typeof slot.value?.name === "string"
                ? slot.value.name.slice(0, 256)
                : "归属记录缺失或损坏",
            bytes: Number.isSafeInteger(slot.value?.bytes)
              ? slot.value.bytes
              : null,
            offset: Number.isSafeInteger(slot.value?.offset)
              ? slot.value.offset
              : null,
            uncertain:
              !slot.value ||
              !!(
                slot.value.preparingMaterialId ||
                slot.value.pending ||
                slot.value.used
              ),
          })
        }
        return { items, more }
      },
      false
    ),
    uploadIsolate: operation(
      object({ token, version: token }),
      async (input, _context, signal) =>
        admit(async () => {
          const expected = reservations.get(input.version)
          if (!expected || expected.id !== input.token)
            throw new Error("接收记录列表已变化，请重新读取后再取消占位。")
          await ordinaryDirectory(root)
          await ordinaryDirectory(join(root, input.token))
          const unlock = await lockfile.lock(
            join(root, input.token, "owner.json"),
            {
              realpath: false,
              retries: { retries: 20, minTimeout: 20, maxTimeout: 100 },
            }
          )
          return withAcquiredLock(unlock, async (committed) => {
            signal?.throwIfAborted()
            const current = await reservation(input.token)
            if (
              !current ||
              current.raw !== expected.raw ||
              current.stamp !== expected.stamp
            )
              throw new Error("原上传已变化，请重新读取；未取消或改动副本。")
            // This excludes only the admission slot. Never rewrite/move owner.json,
            // uploaded bytes or an uncertain prepared/adopted material.
            await replaceJson(
              join(root, input.token, "reservation-isolated.json"),
              {
                id: input.token,
                isolated: true,
                isolatedAt: new Date().toISOString(),
              },
              { signal }
            )
            committed()
            reservations.delete(input.version)
            return { isolated: true, retained: true }
          })
        }),
      false
    ),
    uploadStart: operation(
      object({
        sessionId: text,
        cwd: text,
        name: text,
        mimeType: text,
        bytes: { type: "integer", minimum: 0, maximum: limit },
      }),
      async (input, context, signal) => {
        host.services().sessions.identity(input.sessionId)
        const cwd = await host.services().sessions.cwd(input.cwd)
        const id = randomUUID(),
          directory = join(root, id)
        const name = basename(input.name.replaceAll("\\", "/"))
        if (
          !name ||
          /[<>:"|?*]/u.test(name) ||
          Array.from(name).some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(name) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
        )
          throw new Error("文件名不能在Moon主机保存，请更名后上传。")
        const value = {
          id,
          clientId: context.clientId,
          profileId: context.profileId,
          sessionId: input.sessionId,
          cwd,
          name,
          mimeType: input.mimeType,
          bytes: input.bytes,
          offset: 0,
          phase: "receiving",
          storageDirectory: "file",
          used: false,
        }
        return admit(async () => {
          signal?.throwIfAborted()
          await mkdir(root, { recursive: true })
          await ordinaryDirectory(root)
          const counts = await receiving(context)
          if (counts.total >= 16 || counts.own >= 2)
            throw new Error(
              "上传尚未结束，请在本机设置 → 插件 → 远程访问中取消未完成的接收占位。"
            )
          let created = false
          try {
            await mkdir(directory, { recursive: false })
            created = true
            await mkdir(join(directory, "file"))
            await replaceJson(join(directory, "owner.json"), value)
            const file = await open(dataPath(value), "wx")
            await file.close()
            signal?.throwIfAborted()
            return { token: id, offset: 0 }
          } catch (error) {
            if (created) {
              try {
                if (dirname(resolve(directory)) !== root)
                  throw new Error("拒绝清理归属之外的上传目录。", {
                    cause: error,
                  })
                await ordinaryDirectory(root)
                await ordinaryDirectory(directory)
                await rm(directory, { recursive: true, force: true })
              } catch (cleanup) {
                throw new AggregateError(
                  [error, cleanup],
                  "上传创建失败且本次副本未清理，原记录保留。",
                  { cause: cleanup }
                )
              }
            }
            throw error
          }
        })
      }
    ),
    uploadChunk: operation(
      object({
        token,
        offset: { type: "integer", minimum: 0, maximum: limit },
        data: { type: "string", maxLength: Math.ceil(windowSize / 3) * 4 },
      }),
      async (input, context, signal) =>
        locked(input.token, context, async (value, manifest, committed) => {
          if (value.phase !== "receiving" || value.offset !== input.offset)
            throw new Error("上传位置已变化，请核对原上传，不能重复写入。")
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
            throw new Error("上传字节编码无效。")
          const bytes = Buffer.from(input.data, "base64")
          if (
            !bytes.length ||
            bytes.length > windowSize ||
            value.offset + bytes.length > value.bytes
          )
            throw new Error("上传字节超过当前文件边界。")
          signal?.throwIfAborted()
          const file = await open(dataPath(value), "r+")
          try {
            let offset = 0
            while (offset < bytes.length) {
              const result = await file.write(
                bytes,
                offset,
                bytes.length - offset,
                value.offset + offset
              )
              if (!result.bytesWritten) throw new Error("磁盘未能保存上传。")
              offset += result.bytesWritten
            }
            await file.sync()
          } finally {
            await file.close()
          }
          value.offset += bytes.length
          await replaceJson(manifest, value)
          committed()
          return { offset: value.offset }
        })
    ),
    uploadFinish: operation(object({ token }), async (input, context, signal) =>
      locked(input.token, context, async (value, manifest, committed) => {
        if (value.phase === "prepared" && value.material)
          return { material: value.material }
        if (value.phase !== "receiving" || value.offset !== value.bytes)
          throw new Error("上传尚未完整准备，不能发送。")
        const path = dataPath(value)
        if (!value.preparingMaterialId) {
          value.preparingMaterialId = (randomUUID() + randomUUID()).replaceAll(
            "-",
            ""
          )
          // Persist this copy's cache identity before its first write, so the
          // same owner can recover or discard a failed final manifest save.
          await replaceJson(manifest, value)
          committed()
        }
        const identity = {
          token: value.id,
          materialId: value.preparingMaterialId,
          source: path,
        }
        if (!/^[a-f0-9]{64}$/.test(identity.materialId))
          throw new Error("上传准备记录无效，原副本保留。")
        const material = /^image\/(png|jpeg|webp|gif)$/.test(value.mimeType)
          ? await materials.upload(
              value.sessionId,
              value.cwd,
              value.name,
              value.mimeType,
              (await readFile(path)).toString("base64"),
              signal,
              identity
            )
          : (
              await materials.prepare(
                value.sessionId,
                value.cwd,
                [path],
                "selected",
                signal,
                identity
              )
            )[0]
        if (material.status !== "ready")
          throw new Error(material.error || "上传文件无法准备。")
        value.material = material
        value.phase = "prepared"
        delete value.preparingMaterialId
        await replaceJson(manifest, value)
        committed()
        return { material }
      })
    ),
    uploadStatus: operation(object({ token }), async (input, context) => {
      const { value } = await record(input.token, context)
      return {
        offset: value.offset,
        phase: value.phase,
        material: value.phase === "prepared" ? value.material || null : null,
      }
    }),
    uploadDiscard: operation(object({ token }), async (input, context) => {
      let removed = false
      await locked(input.token, context, async (value, manifest, committed) => {
        if (value.used) return
        if (value.pending) {
          const adoption = await materials.uploadAdoption(
            value.pending,
            value.material?.id
          )
          if (adoption === "accepted") {
            value.used = true
            delete value.pending
            await replaceJson(manifest, value)
            committed()
            return
          }
          if (adoption !== "rejected") return
          delete value.pending
        }
        // Only this service's UUID directory and saved record belong to this transfer.
        const materialId = value.material?.id || value.preparingMaterialId
        if (materialId) {
          if (!/^[a-f0-9]{64}$/.test(materialId))
            throw new Error("材料记录无效，副本保留。")
          const materialFile = join(materials.directory, materialId + ".json")
          const cached = await readFile(materialFile, "utf8")
            .then(JSON.parse)
            .catch((error) => {
              if (error.code === "ENOENT") return null
              throw error
            })
          if (
            cached &&
            (cached.uploadToken !== value.id ||
              cached.id !== materialId ||
              cached.cwd !== value.cwd)
          )
            throw new Error("上传记录变化，副本保留。")
          await rm(materialFile, { force: true })
        }
        await rm(dataPath(value), { force: true })
        value.phase = "discarded"
        await replaceJson(manifest, value)
        committed()
        removed = true
      })
      return { removed, retained: !removed }
    }),
  }
}
