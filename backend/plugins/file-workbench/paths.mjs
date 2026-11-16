import { realpath, stat, open } from "node:fs/promises"
import { resolve, relative, isAbsolute, sep, extname } from "node:path"
import { assertLocalPath } from "../../local-path.mjs"

export const within = (root, path) => {
  const local = relative(root, path)
  return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`)
}
export const same = (a, b) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
export const version = (path, value) =>
  JSON.stringify([
    path,
    value.dev,
    value.ino,
    value.size,
    value.mtimeMs,
    value.ctimeMs,
  ])
export async function targetPath(context, input, directory = false) {
  if (
    !context.cwd ||
    typeof input !== "string" ||
    !input ||
    input.includes("\0") ||
    input.length > 4096
  )
    throw new Error("文件路径无效。")
  // 拒绝 UNC/设备路径：realpath 阶段会向远端发起 SMB 认证泄漏本机凭据。
  assertLocalPath(input, "文件路径")
  const root = await realpath(context.cwd)
  const requested = resolve(root, input)
  let path
  try {
    path = await realpath(requested)
  } catch {
    throw new Error("文件不存在或无法读取，请刷新后重新打开。")
  }
  if (directory && !within(root, path))
    throw new Error("目录树只能浏览当前会话工作目录。")
  return { root, requested, path }
}
export async function openTarget(context, input) {
  const target = await targetPath(context, input)
  const file = await open(target.path, "r")
  try {
    const value = await file.stat()
    if (!value.isFile()) throw new Error("目标不是普通文件。")
    const current = await stat(target.path)
    if (value.dev !== current.dev || value.ino !== current.ino)
      throw new Error("文件在打开期间被替换，请重新读取。")
    return { ...target, file, value, version: version(target.path, value) }
  } catch (error) {
    await file.close()
    throw error
  }
}
export async function unchanged(target, context, input) {
  const current = await targetPath(context, input)
  if (
    !same(current.path, target.path) ||
    target.version !== version(target.path, await target.file.stat()) ||
    target.version !== version(target.path, await stat(target.path))
  )
    throw new Error("文件在读取期间变化，未拼接或保存部分结果，请重新读取。")
}
export function format(path, bytes) {
  const extension = extname(path).toLowerCase()
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { kind: "image", mimeType: "image/png" }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { kind: "image", mimeType: "image/jpeg" }
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString()))
    return { kind: "image", mimeType: "image/gif" }
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return { kind: "image", mimeType: "image/webp" }
  if (bytes.subarray(0, 2).toString() === "BM")
    return { kind: "image", mimeType: "image/bmp" }
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])))
    return { kind: "image", mimeType: "image/x-icon" }
  if (bytes.subarray(0, 5).toString() === "%PDF-")
    return { kind: "pdf", mimeType: "application/pdf" }
  if (extension === ".svg" && /<svg(?:\s|>)/.test(bytes.toString("utf8")))
    return { kind: "image", mimeType: "image/svg+xml" }
  if (
    /\.(docx?|xlsx?|pptx?|zip|exe|dll|woff2?|ttf|otf|7z|rar)$/.test(
      extension
    ) ||
    bytes.includes(0)
  )
    return { kind: "unsupported", mimeType: "application/octet-stream" }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true })
  } catch {
    return { kind: "unsupported", mimeType: "application/octet-stream" }
  }
  return {
    kind: /\.(md|markdown|mdown)$/.test(extension) ? "markdown" : "text",
    mimeType: /\.(html|htm)$/.test(extension) ? "text/html" : "text/plain",
  }
}
