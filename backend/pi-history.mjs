import { mkdir, readFile } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"

import {
  CURRENT_SESSION_VERSION,
  parseSessionEntries,
  SessionManager,
} from "@earendil-works/pi-coding-agent"

import { requireValue, runFailureIssue } from "./conversation-core.mjs"

/** PiHistory: 只通过显式端口访问所属状态；Pi 正文仍是唯一权威。 */
export class PiHistory {
  constructor(ports) {
    this.ports = ports
  }
  safeHistory(manager, history = {}) {
    // Pi must retain the original diagnostic for its retry/overflow decisions.
    // Adapt only the public persistence boundary, leaving the event and agent
    // message untouched while keeping raw provider diagnostics off disk.
    const persistence = {
      error: undefined,
      onInput: undefined,
      stableEntryIds: true,
      migrationRequired: false,
      assistantIssues: new Map(),
      ...history,
    }
    this.ports.persistence.set(manager, persistence)
    for (const method of [
      "appendMessage",
      "appendCustomMessageEntry",
      "appendCustomEntry",
      "appendCompaction",
    ]) {
      const append = manager[method].bind(manager)
      manager[method] = (...args) => {
        // Pi updates its in-memory tree before attempting the disk write. Once
        // a write fails, do not let a later append flush that uncertain tree.
        if (persistence.error) throw persistence.error
        let savedIssue
        if (
          method === "appendMessage" &&
          args[0].role === "assistant" &&
          args[0].errorMessage
        ) {
          savedIssue = runFailureIssue(args[0].errorMessage)
          args[0] = {
            ...args[0],
            errorMessage: savedIssue.summary,
          }
        }
        let id
        const input =
          method === "appendMessage" && args[0].role === "user"
            ? persistence.beforeInput?.(args[0])
            : undefined
        try {
          id = append(...args)
        } catch (error) {
          persistence.error = error
          throw error
        }
        if (savedIssue && typeof id === "string")
          persistence.assistantIssues.set(id, savedIssue)
        if (
          (method === "appendMessage" && args[0].role === "user") ||
          (method === "appendCustomMessageEntry" &&
            args[0] === "moon-continuation")
        )
          persistence.onInput?.(args[0], input)
        return id
      }
    }
    return manager
  }
  historyNotice(manager) {
    const history = this.ports.persistence.get(manager)
    if (!history?.migrationRequired) return ""
    return history.stableEntryIds
      ? "旧格式历史仍需迁移，暂不能创建分支；继续发送一次消息后由 Pi 自动迁移。"
      : "旧格式历史尚未保存稳定的消息标识，暂不能创建分支；继续发送一次消息后由 Pi 自动迁移。"
  }
  async fileManager(record, persistent = false) {
    await mkdir(this.ports.directory, { recursive: true, mode: 0o700 })
    if (!record.sessionFile)
      return this.safeHistory(
        SessionManager.create(record.cwd, this.ports.directory)
      )
    const file = resolve(record.sessionFile)
    const within = relative(resolve(this.ports.directory), file)
    requireValue(
      within && !within.startsWith("..") && !isAbsolute(within),
      "会话文件不在应用数据目录内；未读取该文件。"
    )
    let content
    try {
      content = await readFile(file, "utf8")
    } catch (error) {
      // A first request can be accepted before Pi appends its first user message.
      // Its durable index still protects the request ID; never replay it here.
      if (
        error.code === "ENOENT" &&
        record.lastRequestId &&
        !record.lastMessage
      )
        return this.safeHistory(
          SessionManager.create(record.cwd, this.ports.directory)
        )
      throw new Error("会话历史文件不存在或无法读取；原记录未覆盖。", {
        cause: error,
      })
    }
    // Opening an empty file makes Pi initialize it; opening a legacy file or
    // one without its final newline can also repair it. Validate first, and
    // reconstruct read-only history through Pi's public in-memory API instead.
    try {
      for (const line of content.split("\n")) {
        if (!line.trim()) continue
        const entry = JSON.parse(line)
        requireValue(
          entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            typeof entry.type === "string" &&
            entry.type,
          "invalid entry"
        )
      }
    } catch (error) {
      throw new Error("会话历史文件损坏；原文件未覆盖。", { cause: error })
    }
    const entries = parseSessionEntries(content)
    const header = entries[0]
    requireValue(
      header?.type === "session" &&
        typeof header.id === "string" &&
        header.id.trim() &&
        typeof header.timestamp === "string" &&
        Number.isFinite(Date.parse(header.timestamp)) &&
        typeof header.cwd === "string" &&
        isAbsolute(header.cwd) &&
        entries.slice(1).every((entry) => entry.type !== "session") &&
        (header.version === undefined ||
          (Number.isInteger(header.version) && header.version >= 1)),
      "会话历史文件头损坏；原文件未覆盖。"
    )
    requireValue(
      (header.version ?? 1) <= CURRENT_SESSION_VERSION,
      "会话历史版本高于当前 Pi 支持版本；请升级后重试，原文件未覆盖。"
    )
    const sameCwd =
      process.platform === "win32"
        ? resolve(header.cwd).toLowerCase() ===
          resolve(record.cwd).toLowerCase()
        : resolve(header.cwd) === resolve(record.cwd)
    requireValue(sameCwd, "会话文件的工作目录与记录不一致；原文件未覆盖。")
    // Version migration and branch reconstruction remain Pi's responsibility.
    // Writes may open the persistent manager only after this preflight check.
    // Capture the source version before Pi's in-memory API migrates the entries.
    // v1 migration creates random IDs that cannot identify the unchanged file.
    const version = header.version ?? 1
    return this.safeHistory(
      persistent
        ? SessionManager.open(file, this.ports.directory, record.cwd)
        : SessionManager.inMemory(record.cwd, undefined, entries),
      {
        stableEntryIds: persistent || version >= 2,
        migrationRequired: !persistent && version < CURRENT_SESSION_VERSION,
      }
    )
  }
}
