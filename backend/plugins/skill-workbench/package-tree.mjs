import {
  lstat,
  mkdir,
  open,
  readdir,
  copyFile,
  rmdir,
  unlink,
} from "node:fs/promises"
import { dirname, join } from "node:path"

export async function manifest(root, signal) {
  const files = new Map()
  async function walk(prefix) {
    const path = join(root, prefix)
    const stat = await lstat(path)
    if (stat.isSymbolicLink())
      throw new Error("包内链接需要先单独处理：" + prefix)
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        signal?.throwIfAborted()
        await walk(join(prefix, name))
      }
    } else if (stat.isFile()) files.set(prefix, { path, size: stat.size })
    else throw new Error("不支持特殊文件：" + prefix)
  }
  if (root) await walk("")
  return files
}

export async function equalFile(a, b, signal) {
  if (!a || !b) return !a && !b
  if (a.size !== b.size) return false
  const left = await open(a.path, "r")
  try {
    const right = await open(b.path, "r")
    try {
      const x = Buffer.alloc(64 * 1024),
        y = Buffer.alloc(64 * 1024)
      for (let offset = 0; offset < a.size;) {
        signal?.throwIfAborted()
        const size = Math.min(x.length, a.size - offset)
        const [first, second] = await Promise.all([
          left.read(x, 0, size, offset),
          right.read(y, 0, size, offset),
        ])
        if (
          first.bytesRead !== size ||
          second.bytesRead !== size ||
          !x.subarray(0, size).equals(y.subarray(0, size))
        )
          return false
        offset += size
      }
      return true
    } finally {
      await right.close()
    }
  } finally {
    await left.close()
  }
}

export async function compareTrees(a, b, signal) {
  const left = await manifest(a, signal),
    right = await manifest(b, signal)
  const differences = []
  for (const name of new Set([...left.keys(), ...right.keys()])) {
    if (!(await equalFile(left.get(name), right.get(name), signal)))
      differences.push(
        (!left.has(name)
          ? "仅目标有"
          : !right.has(name)
            ? "仅原目录有"
            : "内容不同") +
          " · " +
          name
      )
  }
  return differences
}

export async function mergeVersion(
  baseRoot,
  diskRoot,
  newRoot,
  stage,
  decisions,
  signal
) {
  const [base, disk, next] = await Promise.all(
    [baseRoot, diskRoot, newRoot].map((root) => manifest(root, signal))
  )
  const changes = [],
    conflicts = []
  for (const name of new Set([...base.keys(), ...next.keys()])) {
    const old = base.get(name),
      current = disk.get(name),
      proposed = next.get(name)
    if (
      (await equalFile(old, proposed, signal)) ||
      (await equalFile(current, proposed, signal))
    )
      continue
    if (!(await equalFile(old, current, signal))) {
      if (decisions[name] === "local") continue
      if (decisions[name] !== "library") {
        conflicts.push(name)
        continue
      }
    }
    changes.push(name)
    if (!stage) continue
    const dest = join(stage, name)
    if (proposed) {
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(proposed.path, dest)
    } else if (current) {
      await unlink(dest)
      for (let dir = dirname(dest); dir !== stage; dir = dirname(dir)) {
        try {
          await rmdir(dir)
        } catch (error) {
          if (["ENOTEMPTY", "EEXIST"].includes(error.code)) break
          throw error
        }
      }
    }
  }
  return { changes, conflicts }
}
