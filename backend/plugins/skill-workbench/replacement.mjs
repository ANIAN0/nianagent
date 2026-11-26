import {
  cp,
  lstat,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises"
import { dirname, join, relative, isAbsolute, sep } from "node:path"
import { compareTrees, manifest, mergeVersion } from "./package-tree.mjs"

const fileId = (stat) => [stat.dev, stat.ino].join(":")
async function identity(path) {
  try {
    return fileId(await lstat(path, { bigint: true }))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
}
function separate(a, b) {
  const inside = (x, y) => {
    const r = relative(x, y)
    return !isAbsolute(r) && r !== ".." && !r.startsWith(".." + sep)
  }
  if (inside(a, b) || inside(b, a))
    throw new Error("共享源、项目安装目录和暂存目录不可相互包含。")
}

export async function prepareReplacement(
  plan,
  dir,
  exportVersion,
  bindings,
  signal
) {
  const { mode, row, target } = plan
  const source = row.source
  if (!source || (await realpath(source)) !== source)
    throw new Error("共享源尚未登记或已移动。")
  const destination = mode === "publish" ? source : target
  if (mode !== "publish") separate(source, target)
  const state = await lstat(destination)
  if (
    mode === "detach" &&
    (!state.isSymbolicLink() || (await realpath(target)) !== source)
  )
    throw new Error("仅可将当前共享源链接转为独立副本。")
  if (
    mode === "takeover" &&
    (!state.isDirectory() || (await realpath(target)) !== target)
  )
    throw new Error("仅可接管普通独立目录。")
  const work = await mkdtemp(join(dir, "preview-"))
  try {
    separate(destination, work)
    const old = join(work, "original")
    const original = mode === "detach" ? source : destination
    await manifest(original, signal)
    await cp(original, old, { recursive: true })
    if ((await compareTrees(original, old, signal)).length)
      throw new Error("预览期间文件被修改。")
    let changes = []
    if (mode === "publish") {
      if (row.version < 1) throw new Error("请先发布工作台版本。")
      const next = await exportVersion(join(work, "next"), row.version)
      const base = plan.baseVersion
        ? await exportVersion(join(work, "base"), plan.baseVersion)
        : undefined
      const result = await mergeVersion(
        base,
        old,
        next,
        undefined,
        plan.decisions ?? {},
        signal
      )
      if (result.conflicts.length) {
        await rm(work, { recursive: true, force: true })
        return { conflicts: result.conflicts }
      }
      changes = result.changes
      plan.versionPaths = { next, base }
    } else if (mode === "takeover")
      changes = await compareTrees(old, source, signal)
    let sourceSnapshot
    if (mode === "takeover") {
      sourceSnapshot = join(work, "source")
      await manifest(source, signal)
      await cp(source, sourceSnapshot, { recursive: true })
    }
    plan.replacement = {
      sourceSnapshot,
      work,
      old,
      source,
      destination,
      originalId: await identity(destination),
      changes,
    }
    const affected = bindings
      .filter((item) => item.libraryId === row.id && item.mode === "link")
      .map((item) => item.target)
    return [
      mode === "publish"
        ? "发布到共享源"
        : mode === "detach"
          ? "转为独立副本"
          : "接管独立目录并保留原目录备份",
      destination,
      ...changes,
      ...affected,
    ].join("\n")
  } catch (error) {
    await rm(work, { recursive: true, force: true })
    throw error
  }
}

export async function applyReplacement(plan, save, signal) {
  const { replacement: r, mode } = plan
  const parent = dirname(r.destination)
  if ((await realpath(parent)) !== parent) throw new Error("目标父目录已改向。")
  if (
    !r.swap &&
    r.sourceSnapshot &&
    (await compareTrees(r.source, r.sourceSnapshot, signal)).length
  )
    throw new Error("共享源在预览后已变化。")
  if (!r.swap) {
    const original = mode === "detach" ? r.source : r.destination
    if (
      (await identity(r.destination)) !== r.originalId ||
      (await compareTrees(original, r.old, signal)).length
    )
      throw new Error("预览后源文件或目标目录已变化。")
    const temporary = await mkdtemp(join(parent, ".moon-swap-"))
    const stage = join(temporary, "new")
    try {
      if (mode === "takeover")
        await symlink(
          r.source,
          stage,
          process.platform === "win32" ? "junction" : "dir"
        )
      else {
        await cp(r.old, stage, { recursive: true })
        if (mode === "publish")
          await mergeVersion(
            plan.versionPaths.base,
            r.old,
            plan.versionPaths.next,
            stage,
            plan.decisions ?? {},
            signal
          )
      }
      r.swap = {
        stage,
        backup: join(temporary, "original"),
        newId: await identity(stage),
        temporary,
      }
      await save()
    } catch (e) {
      await rm(temporary, { recursive: true, force: true })
      throw e
    }
  }
  const { stage, backup, newId, temporary } = r.swap
  const targetId = await identity(r.destination)
  if (targetId !== newId) {
    if ((await identity(stage)) !== newId)
      throw new Error("暂存目录已变化，请核对实际文件。")
    if (targetId === r.originalId) {
      if (await identity(backup)) throw new Error("备份位置已存在。")
      if (
        (
          await compareTrees(
            mode === "detach" ? r.source : r.destination,
            r.old,
            signal
          )
        ).length
      )
        throw new Error("文件在提交前已变化。")
      signal?.throwIfAborted()
      await rename(r.destination, backup)
    } else if (targetId || (await identity(backup)) !== r.originalId)
      throw new Error("目标已变化，请核对原目录和备份。")
    try {
      await rename(stage, r.destination)
    } catch (error) {
      if (
        !(await identity(r.destination)) &&
        (await identity(backup)) === r.originalId
      )
        await rename(backup, r.destination)
      throw error
    }
  }
  if ((await identity(r.destination)) !== newId)
    throw new Error("替换结果待核对。")
  if (mode === "takeover") plan.reason = "原目录备份：" + backup
  else if ((await identity(backup)) === r.originalId) {
    if (
      mode === "publish" &&
      (await compareTrees(backup, r.old, signal)).length
    )
      plan.reason = "备份有外部修改，已保留：" + backup
    else await rm(temporary, { recursive: true, force: true })
  }
  await rm(r.work, { recursive: true, force: true })
}
