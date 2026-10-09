import { readFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve, join, isAbsolute } from "node:path"

/** 开发网页与独立Node使用同一引导；不再猜测用户目录中的旧运行实例。 */
export function developmentStorage() {
  const base = fileURLToPath(new URL("../.dev/moon/", import.meta.url))
  let directory = process.env.MOON_DATA_DIR
  if (!directory) {
    try {
      const bootstrap = JSON.parse(
        readFileSync(join(base, "bootstrap.json"), "utf8")
      )
      if (
        bootstrap.formatVersion !== 1 ||
        typeof bootstrap.dataRoot !== "string" ||
        (!isAbsolute(bootstrap.dataRoot) && bootstrap.dataRoot !== "data")
      )
        throw new Error()
      directory = isAbsolute(bootstrap.dataRoot)
        ? bootstrap.dataRoot
        : resolve(base, bootstrap.dataRoot)
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("开发数据引导损坏，请检查 .dev/moon/bootstrap.json。", {
          cause: error,
        })
      directory = join(base, "data")
    }
  }
  if (!isAbsolute(directory)) throw new Error("MOON_DATA_DIR 必须是绝对目录。")
  directory = resolve(directory)
  if (
    process.env.MOON_RUNTIME_FILE &&
    resolve(process.env.MOON_RUNTIME_FILE) !== join(directory, "runtime.json")
  )
    throw new Error(
      "MOON_RUNTIME_FILE 必须与有效MOON_DATA_DIR指向同一数据根的 runtime.json，不能连接两套目录。"
    )
  return {
    directory,
    runtimeFile:
      process.env.MOON_RUNTIME_FILE || join(directory, "runtime.json"),
  }
}

export function prepareNodeStorage() {
  const storage = developmentStorage()
  mkdirSync(join(storage.directory, "tmp"), { recursive: true })
  // 必须早于Pi动态import，否则自动工具下载与大输出会进入用户目录。
  process.env.MOON_DATA_DIR = storage.directory
  process.env.MOON_RUNTIME_FILE = storage.runtimeFile
  process.env.PI_CODING_AGENT_DIR = join(storage.directory, "agent")
  process.env.TEMP = join(storage.directory, "tmp")
  process.env.TMP = join(storage.directory, "tmp")
  return storage
}
