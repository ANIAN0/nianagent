import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises"
import { join, isAbsolute } from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import lockfile from "proper-lockfile"
import { assertSchema } from "./schema.mjs"
import { conversationRecordSchema } from "./conversation-catalog-contract.mjs"

const check = (value, message) => {
  if (!value) throw new Error(message)
}
const identity = (value) =>
  check(
    typeof value === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
      !["__proto__", "constructor", "prototype"].includes(value),
    "会话标识无效。"
  )
const editable = new Set([
  "title",
  "sessionFile",
  "modelId",
  "thinking",
  "lastMessage",
  "lastError",
  "runId",
  "status",
  "unread",
  "updatedAt",
  "lastRequestId",
  "lastRequestFingerprint",
])

// Shared by the Pi runner and the list service. This file only owns metadata;
// Pi SessionManager owns transcript persistence and branching.
export class ConversationStore {
  constructor(directory) {
    this.directory = join(directory, "conversations")
    this.file = join(this.directory, "index.json")
  }
  validate(record) {
    assertSchema(conversationRecordSchema, record, "已保存会话摘要")
    identity(record.id)
    check(isAbsolute(record.cwd), "会话目录元数据损坏；原文件未覆盖。")
    check(
      !record.sessionFile || isAbsolute(record.sessionFile),
      "会话正文位置损坏；原文件未覆盖。"
    )
    check(
      Number.isFinite(Date.parse(record.createdAt)) &&
        Number.isFinite(Date.parse(record.updatedAt)),
      "会话时间元数据损坏；原文件未覆盖。"
    )
  }
  async document(signal) {
    signal?.throwIfAborted()
    let data
    try {
      data = JSON.parse(await readFile(this.file, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, conversations: [] }
      throw new Error("会话目录损坏或无法读取；原文件未覆盖。", {
        cause: error,
      })
    }
    check(
      data?.version === 1 && Array.isArray(data.conversations),
      "会话目录结构损坏；原文件未覆盖。"
    )
    const ids = new Set()
    for (const item of data.conversations) {
      check(
        item && typeof item === "object" && !Array.isArray(item),
        "会话目录条目损坏；原文件未覆盖。"
      )
      item.lastRequestId ??= ""
      item.lastRequestFingerprint ??= ""
      this.validate(item)
      check(!ids.has(item.id), "会话目录存在重复标识；原文件未覆盖。")
      ids.add(item.id)
    }
    signal?.throwIfAborted()
    return data
  }
  async acquire(signal) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted()
      try {
        return await lockfile.lock(this.directory, {
          realpath: false,
          retries: 0,
        })
      } catch (error) {
        if (error.code !== "ELOCKED" || attempt >= 100) throw error
        await delay(100, undefined, { signal })
      }
    }
  }
  async transaction(change, signal) {
    const unlock = await this.acquire(signal)
    const temporary = join(this.directory, `.index-${randomUUID()}.tmp`)
    try {
      signal?.throwIfAborted()
      const document = await this.document(signal)
      const { result, changed } = change(document)
      if (!changed) return structuredClone(result)
      document.conversations.forEach((record) => this.validate(record))
      await writeFile(temporary, JSON.stringify(document, null, 2), {
        flag: "wx",
        mode: 0o600,
      })
      signal?.throwIfAborted()
      await rename(temporary, this.file)
      return structuredClone(result)
    } finally {
      try {
        await rm(temporary, { force: true })
      } finally {
        await unlock()
      }
    }
  }
  async initialize({ recoverInterrupted = false } = {}, signal) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (!recoverInterrupted) {
      await this.document(signal)
      return
    }
    await this.transaction((data) => {
      let changed = false
      for (const record of data.conversations) {
        if (!["running", "stopping"].includes(record.status)) continue
        record.status = "failed"
        record.unread = true
        record.lastError = "上次运行意外中断。已保留对话，可重新发送消息继续。"
        record.revision++
        changed = true
      }
      return { result: null, changed }
    }, signal)
  }
  async list({ workspaceId, query = "" } = {}, signal) {
    check(typeof query === "string" && query.length <= 500, "搜索关键词无效。")
    const term = query.trim().toLocaleLowerCase()
    const { conversations } = await this.document(signal)
    return conversations
      .filter(
        (item) =>
          (!workspaceId || item.workspaceId === workspaceId) &&
          (!term ||
            `${item.title}\n${item.cwd}\n${item.lastMessage}`
              .toLocaleLowerCase()
              .includes(term))
      )
      .sort(
        (a, b) =>
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
          a.id.localeCompare(b.id)
      )
  }
  async get(id, signal) {
    identity(id)
    return (
      (await this.document(signal)).conversations.find(
        (item) => item.id === id
      ) ?? null
    )
  }
  async create(
    {
      id,
      workspaceId,
      cwd,
      title,
      sessionFile = "",
      modelId = "",
      thinking = "off",
    },
    signal
  ) {
    identity(id)
    return this.transaction((data) => {
      const previous = data.conversations.find((item) => item.id === id)
      if (previous) {
        check(
          previous.workspaceId === workspaceId && previous.cwd === cwd,
          "该会话标识已属于其他工作区。"
        )
        return { result: previous, changed: false }
      }
      const now = new Date().toISOString()
      const record = {
        id,
        workspaceId,
        cwd,
        title,
        sessionFile,
        modelId,
        thinking,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        status: "idle",
        unread: false,
        lastMessage: "",
        lastError: "",
        runId: "",
        lastRequestId: "",
        lastRequestFingerprint: "",
      }
      this.validate(record)
      data.conversations.push(record)
      return { result: record, changed: true }
    }, signal)
  }
  async update(id, patch, signal) {
    identity(id)
    check(
      patch &&
        typeof patch === "object" &&
        !Array.isArray(patch) &&
        Object.keys(patch).every((key) => editable.has(key)),
      "会话摘要修改字段无效。"
    )
    return this.transaction((data) => {
      const record = data.conversations.find((item) => item.id === id)
      check(record, "会话不存在，请刷新列表。")
      const next = {
        ...record,
        ...patch,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
        revision: record.revision + 1,
      }
      this.validate(next)
      Object.assign(record, next)
      return { result: record, changed: true }
    }, signal)
  }
  async markRead(id, revision, signal) {
    identity(id)
    check(
      Number.isSafeInteger(revision) && revision > 0,
      "标记已读需要已显示的会话版本。"
    )
    return this.transaction((data) => {
      const record = data.conversations.find((item) => item.id === id)
      check(record, "会话不存在，请刷新列表。")
      if (!record.unread || record.revision !== revision)
        return { result: record, changed: false }
      record.unread = false
      record.revision++
      return { result: record, changed: true }
    }, signal)
  }
}
