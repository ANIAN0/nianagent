import { readdir, lstat, realpath } from "node:fs/promises"
import { basename, join, relative, resolve, isAbsolute } from "node:path"

// 枚举可打包源码，与 backend/package.json 的发布范围一致；本地说明和用户数据不打包。
// 宿主使用固定通信协议版本，修改源码后须重启 dev 宿主才能加载。
export async function backendSourceFiles(directory) {
  const root = resolve(directory)
  const files = []
  async function visit(path, kind) {
    const entry = await lstat(path)
    if (
      entry.isSymbolicLink() ||
      (await realpath(path)).toLowerCase() !== resolve(path).toLowerCase()
    )
      throw new Error("后端正式源码不能通过符号链接指向目录外。")
    const local = relative(root, path)
    if (local.startsWith("..") || isAbsolute(local))
      throw new Error("后端源码超出正式目录。")
    if (entry.isDirectory()) {
      // 测试夹具只服务单测，不进入运行时源码清单；依赖目录由 deploy 按清单安装，
      // 且其内部符号链接指向工作区 .pnpm 存储，不属于正式源码。
      if (
        basename(path) === "test-fixtures" ||
        basename(path) === "node_modules"
      )
        return
      for (const child of (await readdir(path)).sort())
        await visit(join(path, child), kind)
    } else if (
      entry.isFile() &&
      (path.endsWith(".mjs") ||
        (kind === "plugins" && basename(path) === "manifest.json")) &&
      !basename(path).endsWith(".test.mjs")
    )
      files.push(local.replaceAll("\\", "/"))
    else if (kind === "extensions" && entry.isFile() && !path.endsWith(".md"))
      throw new Error("扩展正式目录仅支持mjs源码与说明文档。")
  }
  for (const name of (await readdir(root)).sort()) {
    if (name.endsWith(".mjs")) await visit(join(root, name), "root")
    else if (["extensions", "plugins"].includes(name))
      await visit(join(root, name), name)
  }
  return files.sort()
}
