import { replaceJson, withAcquiredLock } from "./atomic-file.mjs"
import { mkdir, readFile } from "node:fs/promises"
import { join, isAbsolute } from "node:path"

import { setTimeout as delay } from "node:timers/promises"
import lockfile from "proper-lockfile"
import { assertSchema } from "./schema.mjs"
import { conversationRecordSchema } from "./conversation-catalog-contract.mjs"
import { conversationRequestReceiptStorageSchema } from "./conversation-contract.mjs"
import { archiveReceipt, readArchivedReceipt } from "./receipt-archive.mjs"

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
      if (error.code === "ENOENT")
        return { version: 1, conversations: [], requestReceipts: [] }
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
    data.requestReceipts ??= []
    this.validateReceipts(data.requestReceipts)
    signal?.throwIfAborted()
    return data
  }
  validateReceipts(receipts) {
    check(Array.isArray(receipts), "发送回执结构损坏；原文件未覆盖。")
    const identities = new Set()
    for (const receipt of receipts) {
      assertSchema(
        conversationRequestReceiptStorageSchema,
        receipt,
        "已保存发送回执"
      )
      identity(receipt.sessionId)
      identity(receipt.clientRequestId)
      if (receipt.status === "started" || receipt.status === "handled")
        identity(receipt.runId)
      check(
        Number.isFinite(Date.parse(receipt.updatedAt)),
        "发送回执时间损坏；原文件未覆盖。"
      )
      const key = JSON.stringify([receipt.sessionId, receipt.clientRequestId])
      check(!identities.has(key), "发送回执存在重复身份；原文件未覆盖。")
      identities.add(key)
    }
  }
  async request(sessionId, clientRequestId, signal) {
    identity(sessionId)
    identity(clientRequestId)
    return (
      (await this.document(signal)).requestReceipts.find(
        (receipt) =>
          receipt.sessionId === sessionId &&
          receipt.clientRequestId === clientRequestId
      ) ??
      (await this.archivedRequest(sessionId, clientRequestId)) ??
      null
    )
  }
  archivedRequest(sessionId, clientRequestId) {
    return readArchivedReceipt(
      join(this.directory, "request-receipts"),
      [sessionId, clientRequestId],
      (receipt) => {
        this.validateReceipts([receipt])
        check(
          receipt.sessionId === sessionId &&
            receipt.clientRequestId === clientRequestId,
          "发送归档身份不一致。"
        )
      }
    )
  }
  async compactRequests(document, signal) {
    if (document.requestReceipts.length <= 256) return
    const current = new Map(
      document.conversations.map((record) => [record.id, record])
    )
    const eligible = document.requestReceipts.filter(
      (receipt) =>
        ["rejected", "handled"].includes(receipt.status) ||
        (receipt.status === "started" &&
          current.get(receipt.sessionId)?.runId !== receipt.runId)
    )
    const moved = new Set()
    for (const receipt of eligible.slice(
      0,
      Math.min(64, document.requestReceipts.length - 128)
    )) {
      await archiveReceipt(
        join(this.directory, "request-receipts"),
        [receipt.sessionId, receipt.clientRequestId],
        receipt,
        (value) => this.validateReceipts([value]),
        signal
      )
      moved.add(receipt)
    }
    document.requestReceipts = document.requestReceipts.filter(
      (receipt) => !moved.has(receipt)
    )
  }
  beginRequest(sessionId, clientRequestId, fingerprint, ownerEpoch, signal) {
    identity(sessionId)
    identity(clientRequestId)
    return this.transaction(async (data) => {
      const previous =
        data.requestReceipts.find(
          (receipt) =>
            receipt.sessionId === sessionId &&
            receipt.clientRequestId === clientRequestId
        ) ?? (await this.archivedRequest(sessionId, clientRequestId))
      if (previous) {
        check(
          previous.fingerprint === fingerprint,
          "请求标识已经用于不同内容，请使用新标识。"
        )
        return { result: { receipt: previous, created: false }, changed: false }
      }
      const receipt = {
        sessionId,
        clientRequestId,
        fingerprint,
        ownerEpoch,
        status: "preparing",
        updatedAt: new Date().toISOString(),
      }
      data.requestReceipts.push(receipt)
      return { result: { receipt, created: true }, changed: true }
    }, signal)
  }
  rejectRequest(sessionId, clientRequestId, fingerprint, issue) {
    return this.transaction((data) => {
      const receipt = data.requestReceipts.find(
        (item) =>
          item.sessionId === sessionId &&
          item.clientRequestId === clientRequestId
      )
      if (!receipt || receipt.status !== "preparing")
        return { result: receipt ?? null, changed: false }
      check(receipt.fingerprint === fingerprint, "发送回执与原请求内容不一致。")
      Object.assign(receipt, {
        status: "rejected",
        issue,
        updatedAt: new Date().toISOString(),
      })
      return { result: receipt, changed: true }
    })
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
    return withAcquiredLock(unlock, async (committed) => {
      signal?.throwIfAborted()
      const document = await this.document(signal)
      const before = document.requestReceipts.length
      await this.compactRequests(document, signal)
      const outcome = await change(document)
      const { result } = outcome
      const changed =
        outcome.changed || before !== document.requestReceipts.length
      if (!changed) return structuredClone(result)
      document.conversations.forEach((record) => this.validate(record))
      this.validateReceipts(document.requestReceipts)
      await replaceJson(this.file, document, { signal, pretty: true })
      committed()
      return structuredClone(result)
    })
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
      lineage,
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
        ...(lineage ? { lineage } : {}),
      }
      this.validate(record)
      data.conversations.push(record)
      return { result: record, changed: true }
    }, signal)
  }
  async update(id, patch, signal, request) {
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
      if (request) {
        const receipt = data.requestReceipts.find(
          (item) =>
            item.sessionId === id &&
            item.clientRequestId === request.clientRequestId
        )
        check(
          receipt && receipt.fingerprint === request.fingerprint,
          "发送回执与原请求内容不一致。"
        )
        if (request.outcome === "rejected" || request.outcome === "handled") {
          check(
            receipt.status === "started" &&
              receipt.runId === request.runId &&
              record.runId === request.runId,
            "原请求运行已经变化；不能确认其他运行的结果。"
          )
          Object.assign(receipt, {
            status: request.outcome,
            updatedAt: new Date().toISOString(),
          })
          if (request.issue) receipt.issue = request.issue
          else delete receipt.issue
        } else {
          check(
            receipt.status === "preparing",
            "原请求不在可启动的准备阶段，请先核对原回执。"
          )
          Object.assign(receipt, {
            status: "started",
            runId: patch.runId,
            updatedAt: new Date().toISOString(),
          })
          delete receipt.issue
        }
      }
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
