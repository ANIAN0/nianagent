// @ts-check
// workbench/ 源码指纹：构建脚本写入 bundle，宿主重载时核对产物是否落后于源码。
import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** 计算目录内文件名与内容的指纹；目录缺失或含子目录时返回 null，调用方跳过核对（打包安装不含源码）。 */
export async function workbenchFingerprint(
  directory = join(dirname(fileURLToPath(import.meta.url)), "workbench")
) {
  try {
    const names = (await readdir(directory)).sort()
    const hash = createHash("sha256")
    for (const name of names) {
      const file = join(directory, name)
      if (!(await stat(file)).isFile()) return null
      hash.update(name)
      hash.update(await readFile(file))
    }
    return hash.digest("hex").slice(0, 32)
  } catch {
    return null
  }
}
