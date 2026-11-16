// @ts-check
import {
  mkdir,
  rename,
  stat,
  appendFile,
  readFile,
  writeFile,
  unlink,
} from "node:fs/promises"
import { join } from "node:path"
import { redactSensitive } from "./redact.mjs"

export const DIAGNOSTIC_LIMITS = Object.freeze({
  file: 8 * 1024 * 1024,
  queue: 4 * 1024 * 1024,
  record: 16 * 1024,
  days: 14,
})
const levels = ["debug", "info", "warn", "error"]
const ageMs = DIAGNOSTIC_LIMITS.days * 86400000

/** Stack frames contain locations, not the exception's first line or input values. */
export function diagnosticFrames(error) {
  return typeof error?.stack === "string"
    ? redactSensitive(
        error.stack
          .split("\n")
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 12)
          .join("\n")
      )
        .replace(/(?:file:\/\/\/)?[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/g, "[user]")
        .replace(/\/(?:home|Users)\/[^/\s]+/g, "[user]")
        .slice(0, 1600)
    : ""
}

export async function readDiagnosticFile(file) {
  let content
  try {
    content = await readFile(file, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
  return content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      let record
      try {
        record = JSON.parse(line)
      } catch {
        throw new Error(`诊断文件第 ${index + 1} 行损坏。`)
      }
      if (
        record.schemaVersion !== 1 ||
        !Number.isFinite(Date.parse(record.timestamp)) ||
        !levels.includes(record.level)
      )
        throw new Error(`诊断文件第 ${index + 1} 行格式无效。`)
      return record
    })
}

export function filterDiagnosticRecords(
  records,
  {
    traceId = "",
    module = "",
    errorId = "",
    level = "",
    from = "",
    to = "",
    limit = 200,
  } = {}
) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    (level && !levels.includes(level)) ||
    (from && !Number.isFinite(Date.parse(from))) ||
    (to && !Number.isFinite(Date.parse(to))) ||
    (from && to && Date.parse(from) > Date.parse(to))
  )
    throw new TypeError("诊断查询参数无效。")
  const cutoff = Date.now() - ageMs
  return records
    .filter(
      (record) =>
        Date.parse(record.timestamp) >= cutoff &&
        (!traceId || record.traceId === traceId) &&
        (!module || record.module === module) &&
        (!errorId || record.error?.errorId === errorId) &&
        (!level || record.level === level) &&
        (!from || Date.parse(record.timestamp) >= Date.parse(from)) &&
        (!to || Date.parse(record.timestamp) <= Date.parse(to))
    )
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-limit)
}

/** One process-owned writer. Consumers receive append or query ports, never lifecycle ownership. */
export function createBoundedJsonlLogger({
  directory,
  name = "moon",
  level = "info",
}) {
  if (!/^[a-z0-9-]+$/.test(name) || !levels.includes(level))
    throw new TypeError("诊断日志配置无效。")
  const file = join(directory, `${name}.jsonl`)
  let writing = Promise.resolve()
  let draining = false
  let closed = false
  let bytesWritten = 0
  let initialized = false
  let prunedAt = 0
  let failureCount = 0
  let failureCode = ""
  let dropped = 0
  let queuedBytes = 0
  const queue = []
  const repeats = new Map()
  const issue = () =>
    failureCount
      ? `日志写入失败 ${failureCount} 次（${failureCode}），丢弃 ${dropped} 条。`
      : ""

  async function prune() {
    const cutoff = Date.now() - ageMs
    for (const path of [`${file}.1`, file]) {
      const records = await readDiagnosticFile(path)
      const retained = records.filter(
        (record) => Date.parse(record.timestamp) >= cutoff
      )
      if (retained.length === records.length) continue
      const temporary = `${path}.pending`
      try {
        await writeFile(
          temporary,
          retained.map((record) => JSON.stringify(record) + "\n").join(""),
          "utf8"
        )
        await rename(temporary, path)
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error
        })
      }
    }
    prunedAt = Date.now()
  }
  async function flushOne(item) {
    if (!initialized || Date.now() - prunedAt >= 3600000) {
      await mkdir(directory, { recursive: true })
      await prune()
      try {
        bytesWritten = (await stat(file)).size
      } catch (error) {
        if (error.code !== "ENOENT") throw error
        bytesWritten = 0
      }
      initialized = true
    }
    if (bytesWritten + item.bytes > DIAGNOSTIC_LIMITS.file) {
      await rename(file, `${file}.1`)
      bytesWritten = 0
    }
    await appendFile(file, item.line + "\n", "utf8")
    bytesWritten += item.bytes
  }
  function drain() {
    if (draining) return
    draining = true
    writing = (async () => {
      try {
        while (queue.length) {
          const next = queue.shift()
          queuedBytes -= next.bytes
          try {
            await flushOne(next)
            failureCount = 0
            failureCode = ""
          } catch (error) {
            failureCount++
            failureCode = /^[A-Z0-9_]+$/.test(error.code || "")
              ? error.code
              : "diagnostic_storage_failure"
            dropped += 1 + queue.length
            queue.length = 0
            queuedBytes = 0
            initialized = false
            break
          }
        }
      } finally {
        draining = false
      }
    })()
  }
  function enqueue(record) {
    const line = JSON.stringify(record)
    const bytes = Buffer.byteLength(line) + 1
    if (bytes > DIAGNOSTIC_LIMITS.record)
      throw new RangeError("诊断记录超过单条容量。")
    while (queuedBytes + bytes > DIAGNOSTIC_LIMITS.queue) {
      // A debug record must not evict an info/warn/error record.
      let index = queue.findIndex((item) => item.level === "debug")
      if (index < 0 && record.level !== "debug")
        index = queue.findIndex((item) => item.level === "info")
      if (index < 0) {
        dropped++
        return
      }
      queuedBytes -= queue.splice(index, 1)[0].bytes
      dropped++
    }
    queue.push({ line, bytes, level: record.level })
    queuedBytes += bytes
    drain()
  }
  function append(record) {
    if (closed) throw new Error("诊断写入器已关闭。")
    if (
      !record ||
      !levels.includes(record.level) ||
      typeof record.event !== "string" ||
      !record.event
    )
      throw new TypeError("诊断记录缺少合法级别或事件。")
    if (levels.indexOf(record.level) < levels.indexOf(level)) return writing
    const normalized = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      process: `${name}-${process.pid}`,
      module: String(record.module ?? "").slice(0, 64),
      event: record.event.slice(0, 200),
      level: record.level,
      traceId: String(record.traceId ?? "").slice(0, 128),
      operationId: String(record.operationId ?? "").slice(0, 64),
      ...(Number.isFinite(record.durationMs)
        ? { durationMs: Math.max(0, Math.round(record.durationMs)) }
        : {}),
      outcome: ["committed", "rejected", "unknown"].includes(record.outcome)
        ? record.outcome
        : "",
      ...(record.error
        ? {
            error: {
              code: String(record.error.code ?? "").slice(0, 64),
              errorId: String(record.error.errorId ?? "").slice(0, 8),
              cause: redactSensitive(String(record.error.cause ?? "")).slice(
                0,
                400
              ),
              ...(record.error.frames
                ? {
                    frames: redactSensitive(String(record.error.frames)).slice(
                      0,
                      1600
                    ),
                  }
                : {}),
            },
          }
        : {}),
    }
    // Only explicitly marked background failures aggregate; foreground error IDs always have a record.
    if (record.repeatKey) {
      const key = `${normalized.module}:${normalized.event}:${String(record.repeatKey).slice(0, 128)}`
      const previous = repeats.get(key)
      if (previous && Date.now() - previous.at < 60000) {
        previous.count++
        return writing
      }
      if (previous?.count)
        enqueue({
          ...previous.record,
          timestamp: normalized.timestamp,
          repeated: previous.count,
        })
      if (repeats.size >= 128 && !repeats.has(key)) {
        const first = repeats.keys().next().value
        const expired = repeats.get(first)
        if (expired.count)
          enqueue({
            ...expired.record,
            timestamp: normalized.timestamp,
            repeated: expired.count,
          })
        repeats.delete(first)
      }
      repeats.set(key, { at: Date.now(), count: 0, record: normalized })
    }
    enqueue(normalized)
    return writing
  }
  async function flush() {
    for (const value of repeats.values()) {
      if (value.count) {
        enqueue({
          ...value.record,
          timestamp: new Date().toISOString(),
          repeated: value.count,
        })
        value.count = 0
      }
    }
    while (draining || queue.length) {
      if (!draining) drain()
      await writing
    }
  }
  return {
    append,
    flush,
    issue,
    dropped: () => dropped,
    async query(input = {}) {
      await flush()
      return filterDiagnosticRecords(
        [
          ...(await readDiagnosticFile(`${file}.1`)),
          ...(await readDiagnosticFile(file)),
        ],
        input
      )
    },
    status: () => ({
      file,
      bytesWritten,
      queued: queue.length,
      queuedBytes,
      dropped,
      issue: issue(),
    }),
    async close() {
      closed = true
      await flush()
    },
  }
}
