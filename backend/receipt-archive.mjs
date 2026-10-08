import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { replaceJson } from "./atomic-file.mjs"
const safePart = (value) => {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value) ||
    ["__proto__", "constructor", "prototype"].includes(value)
  )
    throw new Error("归档回执标识无效。")
  return value
}
/** 终态先复制到按身份寻址的归档，再从热文档移出；中断最多留下相同副本，不丢失去重事实。 */
export async function readArchivedReceipt(directory, parts, validate) {
  try {
    const value = JSON.parse(
      await readFile(join(directory, ...parts.map(safePart)) + ".json", "utf8")
    )
    validate(value)
    return value
  } catch (error) {
    if (error.code === "ENOENT") return undefined
    throw new Error("原操作归档无法读取，记录保留，请核对存储。", {
      cause: error,
    })
  }
}
export async function archiveReceipt(
  directory,
  parts,
  value,
  validate,
  signal
) {
  validate(value)
  const previous = await readArchivedReceipt(directory, parts, validate)
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(value))
      throw new Error("原操作归档存在不同结果，记录保留。")
    return
  }
  await replaceJson(join(directory, ...parts.map(safePart)) + ".json", value, {
    signal,
  })
}
