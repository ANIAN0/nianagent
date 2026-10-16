import { opendir, realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"

export async function browseDirectories(path, signal) {
  signal?.throwIfAborted()
  if (!path) {
    const roots =
      process.platform === "win32"
        ? (
            await Promise.all(
              Array.from(
                { length: 26 },
                (_, index) => String.fromCharCode(65 + index) + ":\\"
              ).map(async (path) =>
                (await stat(path).catch(() => null))?.isDirectory()
                  ? { name: path, path }
                  : null
              )
            )
          ).filter(Boolean)
        : [{ name: "/", path: "/" }]
    return { path: "", parent: "", entries: roots, truncated: false }
  }
  if (!isAbsolute(path)) throw new Error("请输入主机目录的绝对路径。")
  const actual = await realpath(path)
  if (!(await stat(actual)).isDirectory()) throw new Error("所选路径不是目录。")
  const entries = []
  let truncated = false
  for await (const item of await opendir(actual)) {
    signal?.throwIfAborted()
    if (!item.isDirectory() && !item.isSymbolicLink()) continue
    if (
      item.isSymbolicLink() &&
      !(await stat(join(actual, item.name)).catch(() => null))?.isDirectory()
    )
      continue
    if (entries.length === 1000) {
      truncated = true
      break
    }
    entries.push({ name: item.name, path: join(actual, item.name) })
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return {
    path: actual,
    parent: dirname(actual) === actual ? "" : dirname(actual),
    entries,
    truncated,
  }
}
