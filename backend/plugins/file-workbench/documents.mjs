import { opendir, stat } from "node:fs/promises"
import { basename, join, relative } from "node:path"
import { targetPath, openTarget, unchanged, version, format } from "./paths.mjs"

export class Documents {
  constructor(host) {
    this.host = host
  }
  async tree({ path = "." }, context, signal) {
    const target = await targetPath(context, path, true)
    if (!(await stat(target.path)).isDirectory())
      throw new Error("目标不是目录。")
    const entries = []
    let truncated = false
    const directory = await opendir(target.path)
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (entries.length === 2000) {
        truncated = true
        break
      }
      entries.push({
        name: entry.name,
        path: join(target.path, entry.name),
        directory: entry.isDirectory(),
        linked: entry.isSymbolicLink(),
      })
    }
    entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true })
    )
    return { cwd: target.root, path: target.path, entries, truncated }
  }
  async info({ path }, context, signal) {
    const target = await openTarget(context, path)
    try {
      signal?.throwIfAborted()
      const buffer = Buffer.alloc(Math.min(target.value.size, 4096))
      const { bytesRead } = await target.file.read(buffer, 0, buffer.length, 0)
      await unchanged(target, context, path)
      return {
        path: target.path,
        requested: target.requested,
        name: basename(target.requested),
        displayPath: relative(target.root, target.requested),
        bytes: target.value.size,
        version: target.version,
        ...format(target.path, buffer.subarray(0, bytesRead)),
      }
    } finally {
      await target.file.close()
    }
  }
  async text(
    { path, offset = 0, line = 1, atLine, expected = "" },
    context,
    signal
  ) {
    const target = await openTarget(context, path)
    try {
      if (expected && target.version !== expected)
        throw new Error("文件已更新，请重新读取当前文件。")
      if (atLine !== undefined) {
        if (!Number.isSafeInteger(atLine) || atLine < 1)
          throw new Error("文本行位置无效。")
        line = 1
        offset = 0
        const scan = Buffer.alloc(65536)
        let position = 0
        let previousCR = false
        while (line < atLine && position < target.value.size) {
          signal?.throwIfAborted()
          const { bytesRead } = await target.file.read(
            scan,
            0,
            Math.min(scan.length, target.value.size - position),
            position
          )
          if (!bytesRead) break
          for (let index = 0; index < bytesRead; index++) {
            const byte = scan[index]
            if (byte === 10 && previousCR) {
              previousCR = false
              offset = position + index + 1
              continue
            }
            previousCR = byte === 13
            if (byte === 10 || byte === 13) {
              line++
              offset = position + index + 1
              if (line === atLine) {
                if (byte === 13 && offset < target.value.size) {
                  const next = Buffer.alloc(1)
                  await target.file.read(next, 0, 1, offset)
                  if (next[0] === 10) offset++
                }
                break
              }
            }
          }
          position += bytesRead
        }
      }
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > target.value.size ||
        !Number.isSafeInteger(line) ||
        line < 1
      )
        throw new Error("文本读取位置无效。")
      const buffer = Buffer.alloc(
        Math.min(2 * 1024 * 1024, target.value.size - offset)
      )
      let count = 0
      while (count < buffer.length) {
        const next = await target.file.read(
          buffer,
          count,
          buffer.length - count,
          offset + count
        )
        if (!next.bytesRead) break
        count += next.bytesRead
        signal?.throwIfAborted()
      }
      let bytes = buffer.subarray(0, count)
      if (bytes.includes(0))
        throw new Error("该文件包含二进制内容，不支持文本预览。")
      const eof = offset + count === target.value.size
      const newlineOffsets = []
      for (let index = 0; index < bytes.length; index++) {
        if (bytes[index] === 13 || bytes[index] === 10) {
          if (bytes[index] === 13) {
            if (bytes[index + 1] === 10) index++
            else if (index + 1 === bytes.length && !eof) {
              const next = Buffer.alloc(1)
              await target.file.read(next, 0, 1, offset + count)
              // A CRLF pair belongs to one page; never split its two bytes.
              if (next[0] === 10) break
            }
          }
          newlineOffsets.push(index + 1)
          if (newlineOffsets.length === 5000) break
        }
      }
      if (newlineOffsets.length === 5000)
        bytes = bytes.subarray(0, newlineOffsets.at(-1))
      else if (!eof) {
        if (!newlineOffsets.length)
          throw new Error("单行超过2MiB，无法完整预览；请使用外部编辑器打开。")
        bytes = bytes.subarray(0, newlineOffsets.at(-1))
      }
      let content
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      } catch {
        throw new Error("该文件不是合法UTF-8文本，请使用外部程序打开。")
      }
      await unchanged(target, context, path)
      const next = offset + bytes.length
      return {
        path: target.path,
        content,
        offset,
        next,
        line,
        nextLine: line + (content.match(/\r\n|\r|\n/g)?.length || 0),
        complete: next === target.value.size,
        version: target.version,
      }
    } finally {
      await target.file.close()
    }
  }
  async bytes(
    { path, offset = 0, expected = "", purpose = "preview" },
    context,
    signal
  ) {
    const target = await openTarget(context, path)
    try {
      if (
        (purpose === "preview" || context.source === "remote") &&
        target.value.size > 32 * 1024 * 1024
      )
        throw new Error(
          "图片/PDF预览及远程下载完整文件上限32MiB，请在本机外部打开或导出。"
        )
      if (expected && expected !== target.version)
        throw new Error("文件已变化，未继续下载部分内容。")
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > target.value.size
      )
        throw new Error("文件读取位置无效。")
      const buffer = Buffer.alloc(
        Math.min(2 * 1024 * 1024, target.value.size - offset)
      )
      let count = 0
      while (count < buffer.length) {
        const next = await target.file.read(
          buffer,
          count,
          buffer.length - count,
          offset + count
        )
        if (!next.bytesRead) break
        count += next.bytesRead
        signal?.throwIfAborted()
      }
      await unchanged(target, context, path)
      return {
        path: target.path,
        name: basename(target.path),
        bytes: target.value.size,
        data: buffer.subarray(0, count).toString("base64"),
        offset,
        next: offset + count,
        complete: offset + count === target.value.size,
        version: target.version,
      }
    } finally {
      await target.file.close()
    }
  }
  async state({ path }, context) {
    const target = await targetPath(context, path)
    const value = await stat(target.path)
    return { path: target.path, version: version(target.path, value) }
  }
  async reference({ path }, context, signal) {
    const target = await targetPath(context, path)
    const [material] = await this.host
      .services()
      .materials.prepare(
        context.sessionId,
        context.cwd,
        [target.requested],
        "selected",
        signal
      )
    return { material }
  }
}
