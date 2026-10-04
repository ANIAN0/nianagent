import { readdir, lstat, realpath } from "node:fs/promises"
import { join, relative, resolve, isAbsolute } from "node:path"

// Only distributable source participates in the host identity. The same fixed
// scope is published by backend/package.json; tests and user data are excluded.
export async function backendSourceFiles(directory) {
  const root = resolve(directory)
  const files = []
  async function visit(path, nested) {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()) throw new Error("后端正式源码不能通过符号链接指向目录外。")
    const local = relative(root, path)
    if (local.startsWith("..") || isAbsolute(local)) throw new Error("后端源码超出正式目录。")
    if (entry.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await visit(join(path, child), true)
    } else if (entry.isFile() && path.endsWith(".mjs")) files.push(local.replaceAll("\\", "/"))
    else if (nested && entry.isFile() && !path.endsWith(".md")) throw new Error("扩展正式目录仅支持mjs源码与说明文档。")
  }
  for (const name of (await readdir(root)).sort()) {
    if (name.endsWith(".mjs")) await visit(join(root, name), false)
    else if (name === "extensions") await visit(join(root, name), true)
  }
  return files.sort()
}
