import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { replaceJson } from "./atomic-file.mjs"
import { redactSensitive } from "./redact.mjs"

export const logRetention = {
  days: 14,
  maxEntries: 10000,
  maxBytes: 8 * 1024 * 1024,
}
function retained(entries) {
  const cutoff = Date.now() - logRetention.days * 86400000
  const items = entries
    .filter((item) => Date.parse(item.time) >= cutoff)
    .slice(-logRetention.maxEntries)
  let bytes = Buffer.byteLength(JSON.stringify(items)) + 32
  while (bytes > logRetention.maxBytes && items.length)
    bytes -= Buffer.byteLength(JSON.stringify(items.shift())) + 1
  return items
}
// This fallback never serializes values. Plugin summaries must explicitly choose
// safe fields; truncation is a size bound, not a claim of universal redaction.
export function valueSummary(value) {
  const describe = (item) =>
    item === null
      ? "null"
      : Array.isArray(item)
        ? `array(${item.length})`
        : typeof item === "string"
          ? `string(${item.length})`
          : typeof item
  return JSON.stringify(
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .slice(0, 24)
            .map(([key, item]) => [
              /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) ? key : "[field]",
              describe(item),
            ])
        )
      : { value: describe(value) }
  ).slice(0, 2048)
}
export function safeSummary(definition, values, fallback) {
  try {
    const text = definition?.summarize?.(values)
    if (typeof text === "string") return text.slice(0, 2048)
  } catch {
    // A presentation callback cannot change the business result, but its failure
    // must remain visible instead of looking like a successful custom summary.
    return `摘要生成失败；${valueSummary(fallback)}`
  }
  return valueSummary(fallback)
}
export class ActivityLog {
  constructor(directory) {
    this.file = join(directory, "logs", "external-tools.json")
    this.queue = Promise.resolve()
    this.issue = ""
  }
  async load() {
    this.loading ??= (async () => {
      try {
        const value = JSON.parse(await readFile(this.file, "utf8"))
        if (value.version !== 1 || !Array.isArray(value.entries))
          throw new Error("invalid")
        this.entries = value.entries
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("日志文件无法读取，原文件已保留。", { cause: error })
        this.entries = []
      }
    })().catch((error) => {
      this.loading = undefined
      throw error
    })
    return this.loading
  }
  append(record) {
    const pending = this.queue.then(async () => {
      await this.load()
      const entry = {
        id: randomUUID(),
        time: new Date().toISOString(),
        source: "mcp",
        plugin: "",
        tool: "",
        status: "info",
        durationMs: null,
        callId: "",
        client: "未提供",
        input: "",
        result: "",
        error: "",
        ...Object.fromEntries(
          [
            "source",
            "plugin",
            "tool",
            "status",
            "durationMs",
            "callId",
            "client",
            "input",
            "result",
            "error",
            "actorId",
            "credentialId",
          ]
            .filter((key) => Object.hasOwn(record, key))
            .map((key) => [key, record[key]])
        ),
      }
      // AC13：业务日志出口统一脱敏（MCP 事件、工作台事件、共享工具摘要共用本入口）
      entry.error = redactSensitive(
        typeof entry.error === "string" ? entry.error : ""
      )
      entry.input = redactSensitive(
        typeof entry.input === "string" ? entry.input : ""
      )
      entry.result = redactSensitive(
        typeof entry.result === "string" ? entry.result : ""
      )
      const entries = retained([...this.entries, entry])
      await replaceJson(this.file, { version: 1, entries })
      this.entries = entries
      this.issue = ""
    })
    this.queue = pending.catch(() => {
      this.issue =
        "日志持久写入失败；本次记录可能缺失，请检查数据目录权限和磁盘。"
      console.error(this.issue)
    })
    return this.queue
  }
  trim() {
    const pending = this.queue.then(async () => {
      await this.load()
      const entries = retained(this.entries)
      if (entries.length === this.entries.length && !this.retentionDirty) return
      this.entries = entries
      this.retentionDirty = true
      await replaceJson(this.file, { version: 1, entries })
      this.retentionDirty = false
      this.issue = ""
    })
    this.queue = pending.catch(() => {
      this.issue =
        "日志保留清理未能落盘或文件不可读；原文件保留，过期记录不在查询中展示，请检查数据目录。"
      console.error(this.issue)
    })
    return this.queue
  }
  async query(filter = {}) {
    await this.trim()
    await this.load()
    const {
      from = "",
      to = "",
      plugin = "",
      tool = "",
      status = "",
      offset = 0,
      limit = 50,
    } = filter
    const items = this.entries
      .filter(
        (item) =>
          (!from || item.time >= from) &&
          (!to || item.time <= to) &&
          (!plugin || item.plugin === plugin) &&
          (!tool || item.tool === tool) &&
          (!status || item.status === status)
      )
      .reverse()
    return {
      entries: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
      issue: this.issue,
      retention: logRetention,
    }
  }
  async detail(id) {
    await this.trim()
    await this.load()
    const entry = this.entries.find((item) => item.id === id)
    if (!entry) throw new Error("日志已过期或不存在，请重新读取。")
    return { entry, issue: this.issue }
  }
  async close() {
    await this.queue
    if (this.issue) throw new Error(this.issue)
  }
}
