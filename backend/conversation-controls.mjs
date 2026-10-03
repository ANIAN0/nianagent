import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises"
import { join, resolve, relative, isAbsolute } from "node:path"
import { randomUUID } from "node:crypto"
import { assertSchema, schemas } from "./schema.mjs"

const check = (value, message) => {
  if (!value) throw new Error(message)
}
const terminal = new Set(["completed", "cancelled", "failed"])
const pendingQueue = (state) =>
  state.queue?.items?.some((item) =>
    ["pending", "dispatching", "failed"].includes(item.status)
  )
const safeError = (error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (/Nothing to compact|session too small/i.test(message))
    return "历史内容不足，尚无可压缩的内容。"
  if (/Already compacted/i.test(message))
    return "当前上下文已经压缩，尚无新增内容可压缩。"
  if (/401|unauthoriz/i.test(message)) return "模型认证失败，请检查连接凭据。"
  if (/abort|cancel/i.test(message)) return "压缩已取消，原上下文保留。"
  return "压缩未完成，请检查模型连接与本地存储后重试；原历史保留。"
}

// Durable control receipts are not a second transcript. All summaries and
// boundaries are projected from Pi; a receipt only identifies one operation.
export class ConversationControls {
  constructor(conversations, directory) {
    this.host = conversations
    this.directory = join(directory, "conversations", "controls")
    this.tasks = new Map()
  }
  file(id) {
    return join(this.directory, `${id}.json`)
  }
  present(operation) {
    const {
      targetSessionFile: _file,
      configuration: _configuration,
      ...result
    } = operation
    return structuredClone(result)
  }
  async load(state) {
    if (state.controlsLoaded) return
    try {
      const document = JSON.parse(
        await readFile(this.file(state.record.id), "utf8")
      )
      check(
        document.version === 1 && Array.isArray(document.operations),
        "控制记录结构无效。"
      )
      for (const operation of document.operations) {
        assertSchema(
          schemas.ConversationControlOperation,
          this.present(operation),
          "已保存控制回执"
        )
        check(
          operation.sessionId === state.record.id &&
            typeof operation.id === "string" &&
            ["compact", "fork"].includes(operation.kind) &&
            [
              "running",
              "cancelling",
              "completed",
              "cancelled",
              "failed",
              "unknown",
            ].includes(operation.status),
          "会话控制记录损坏；原文件未覆盖。"
        )
      }
      state.controls = document.operations
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      state.controls = []
    }
    state.controlsLoaded = true
    // The host has restarted. Reconcile Pi's actual commit boundary before
    // allowing any new operation; never repeat an unknown request automatically.
    for (const operation of state.controls) {
      if (terminal.has(operation.status)) continue
      if (operation.kind === "fork") {
        await this.reconcileFork(state, operation)
        continue
      }
      const committed = this.compactionFor(state, operation)
      if (committed) {
        operation.status = "completed"
        operation.compactionEntryId = committed.id
        operation.error = ""
      } else {
        operation.status = "failed"
        operation.error = "上次压缩已中断，未保存新摘要；原上下文保留。"
      }
      operation.updatedAt = new Date().toISOString()
      await this.persist(state)
    }
  }
  async persist(state, signal) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, operations: state.controls }),
        { flag: "wx", mode: 0o600 }
      )
      signal?.throwIfAborted()
      await rename(temporary, this.file(state.record.id))
    } finally {
      await rm(temporary, { force: true })
    }
  }
  compactionFor(state, operation) {
    if (operation.kind !== "compact") return undefined
    const entries = state.manager.getBranch()
    const boundary = entries.findIndex(
      (entry) => entry.id === operation.anchorId
    )
    return entries
      .slice(boundary + 1)
      .find(
        (entry) =>
          entry.type === "compaction" &&
          (boundary >= 0 || entry.id === operation.compactionEntryId)
      )
  }
  idleReason(state) {
    if (state.controlBusy) return "正在处理会话操作，请等待结果。"
    if (
      state.entry.busy ||
      ["running", "stopping"].includes(state.phase) ||
      (state.session && !state.session.isIdle)
    )
      return "会话正在执行，请等待回复结束。"
    if (state.questions?.length || state.phase === "waiting")
      return "请先回答当前问题。"
    if (pendingQueue(state)) return "请先处理或删除待发送消息。"
    if (
      (state.controls || []).some(
        (operation) => !terminal.has(operation.status)
      )
    )
      return "请先检查上次操作的结果。"
    return ""
  }
  projection(state) {
    const operations = state.controls || []
    const latest = operations.at(-1)
    return {
      control: {
        busy: !!state.controlBusy,
        compactDisabledReason:
          this.idleReason(state) ||
          (!state.manager.getBranch().some((entry) => entry.type === "message")
            ? "尚无可压缩的历史。"
            : ""),
        forkDisabledReason: this.idleReason(state),
        ...(latest ? { operation: this.present(latest) } : {}),
      },
      compactions: state.manager.getBranch().flatMap((entry, historyIndex) =>
        entry.type !== "compaction"
          ? []
          : [
              {
                id: entry.id,
                time: entry.timestamp,
                summary: entry.summary,
                firstKeptEntryId: entry.firstKeptEntryId,
                tokensBefore: entry.tokensBefore,
                source: operations.some(
                  (operation) => operation.compactionEntryId === entry.id
                )
                  ? "manual"
                  : "automatic",
                historyIndex,
                firstKeptHistoryIndex: state.manager
                  .getBranch()
                  .findIndex((item) => item.id === entry.firstKeptEntryId),
              },
            ]
      ),
    }
  }
  async state(sessionId, signal) {
    this.host.ensureOpen()
    signal?.throwIfAborted()
    const record = await this.host.store.get(sessionId, signal)
    check(record, "会话不存在。")
    return this.host.restore(record, undefined, signal)
  }
  async compactStart(sessionId, operationId, focus, signal) {
    return this.host.sessions.exclusive(sessionId, async () => {
      const state = await this.state(sessionId, signal)
      const previous = state.controls.find(
        (operation) => operation.id === operationId
      )
      if (previous) {
        check(
          previous.kind === "compact" && previous.focus === focus,
          "操作标识已用于不同内容。"
        )
        return this.present(previous)
      }
      check(!this.idleReason(state), this.idleReason(state))
      const slash = state.record.modelId.indexOf("/")
      check(slash > 0, "此会话尚未选择可用模型。")
      const selected = await this.host.selection(
        state.record.modelId.slice(0, slash),
        state.record.modelId.slice(slash + 1),
        state.record.thinking,
        signal
      )
      await this.host.restore(state.record, selected, signal)
      check(!this.idleReason(state), this.idleReason(state))
      signal?.throwIfAborted()
      const now = new Date().toISOString()
      const operation = {
        id: operationId,
        kind: "compact",
        sessionId,
        focus,
        status: "running",
        createdAt: now,
        updatedAt: now,
        error: "",
        anchorId: state.manager.getLeafId() || "",
      }
      state.controls.push(operation)
      try {
        await this.persist(state, signal)
      } catch (error) {
        state.controls.pop()
        throw error
      }
      // Reservation shares the same exclusive gate as send/retry/configuration.
      // Pi.compact() calls abort() first, so it must only see an idle session.
      state.controlBusy = true
      state.controlCancelRequested = false
      state.entry.busy = true
      this.host.touch(state)
      const task = this.runCompact(state, operation)
      this.tasks.set(operation.id, task)
      void task.finally(() => this.tasks.delete(operation.id)).catch(() => {})
      return this.present(operation)
    })
  }
  async runCompact(state, operation) {
    try {
      await state.session.compact(operation.focus || undefined)
      const committed = this.compactionFor(state, operation)
      check(committed, "Pi 未提供已保存的摘要。")
      operation.status = "completed"
      operation.compactionEntryId = committed.id
      operation.error = ""
    } catch (error) {
      const committed = this.compactionFor(state, operation)
      if (committed && !this.host.persistence.get(state.manager)?.error) {
        operation.status = "completed"
        operation.compactionEntryId = committed.id
        operation.error = ""
      } else {
        operation.status =
          operation.status === "cancelling" ? "cancelled" : "failed"
        operation.error = safeError(error)
        if (this.host.persistence.get(state.manager)?.error) {
          state.unsubscribe?.()
          state.session.dispose()
          state.session = undefined
          this.host.sessions.active.delete(state.record.id)
          state.manager = await this.host.fileManager(state.record)
          operation.status = "failed"
        }
      }
    } finally {
      await this.host.sessions.exclusive(state.record.id, async () => {
        operation.updatedAt = new Date().toISOString()
        try {
          await this.persist(state)
        } catch {
          operation.status = "unknown"
          operation.error = "无法保存操作回执，请检查压缩状态。"
        }
        state.controlBusy = false
        state.entry.busy = false
        state.runtime = undefined
        this.host.touch(state)
      })
    }
  }
  async read(sessionId, operationId, signal) {
    return this.host.sessions.exclusive(sessionId, async () => {
      const state = await this.state(sessionId, signal)
      const operation = state.controls.find((item) => item.id === operationId)
      if (!operation) return null
      if (operation.kind === "fork" && !terminal.has(operation.status))
        await this.reconcileFork(state, operation)
      const committed = this.compactionFor(state, operation)
      if (
        operation.kind === "compact" &&
        operation.status === "unknown" &&
        !committed &&
        !this.tasks.has(operation.id)
      ) {
        operation.status = "failed"
        operation.error = "未保存新摘要，原上下文保留；可以重新压缩。"
        await this.persist(state)
        this.host.touch(state)
      }
      if (
        committed &&
        operation.status !== "completed" &&
        !this.tasks.has(operation.id)
      ) {
        operation.status = "completed"
        operation.compactionEntryId = committed.id
        operation.error = ""
        await this.persist(state)
        this.host.touch(state)
      }
      return this.present(operation)
    })
  }
  async compactCancel(sessionId, operationId, signal) {
    return this.host.sessions.exclusive(sessionId, async () => {
      const state = await this.state(sessionId, signal)
      const operation = state.controls.find((item) => item.id === operationId)
      check(operation?.kind === "compact", "未找到本次压缩操作。")
      if (terminal.has(operation.status)) return this.present(operation)
      check(
        state.controlBusy && this.tasks.has(operation.id),
        "无法确认正在运行的压缩，请检查状态。"
      )
      signal?.throwIfAborted()
      const previousStatus = operation.status
      operation.status = "cancelling"
      operation.updatedAt = new Date().toISOString()
      try {
        await this.persist(state, signal)
      } catch (error) {
        operation.status = previousStatus
        throw error
      }
      state.session.abortCompaction()
      state.controlCancelRequested = true
      this.host.touch(state)
      return this.present(operation)
    })
  }
  async close() {
    for (const state of this.host.active.values())
      if (state.controlBusy) {
        state.controlCancelRequested = true
        state.session?.abortCompaction()
      }
    await Promise.allSettled([...this.tasks.values()])
  }
  async forkStart(sessionId, operationId, entryId, signal) {
    return this.host.sessions.exclusive(sessionId, async () => {
      const state = await this.state(sessionId, signal)
      const previous = state.controls.find((item) => item.id === operationId)
      if (previous) {
        check(
          previous.kind === "fork" && previous.anchorId === entryId,
          "操作标识已用于不同分支。"
        )
        if (!terminal.has(previous.status))
          await this.reconcileFork(state, previous)
        return this.present(previous)
      }
      check(!this.idleReason(state), this.idleReason(state))
      const entry = state.manager
        .getBranch()
        .find((item) => item.id === entryId)
      check(
        entry?.type === "message" &&
          entry.message.role === "assistant" &&
          ["stop", "length"].includes(entry.message.stopReason) &&
          !entry.message.content.some((part) => part.type === "toolCall"),
        "只能从已完成并保存的Agent回复创建分支。"
      )
      const configuration = await this.host.sessions.readExclusive(
        sessionId,
        signal
      )
      check(
        configuration && !configuration.unavailableToolIds.length,
        "会话配置包含不可用工具，请先调整。"
      )
      const slash = state.record.modelId.indexOf("/")
      check(slash > 0, "会话没有可用的模型。")
      const selected = await this.host.selection(
        state.record.modelId.slice(0, slash),
        state.record.modelId.slice(slash + 1),
        state.record.thinking,
        signal
      )
      signal?.throwIfAborted()
      const now = new Date().toISOString()
      const operation = {
        id: operationId,
        kind: "fork",
        sessionId,
        anchorId: entryId,
        targetSessionId: randomUUID(),
        status: "running",
        createdAt: now,
        updatedAt: now,
        error: "",
        configuration: structuredClone(configuration),
      }
      state.controls.push(operation)
      try {
        await this.persist(state, signal)
      } catch (error) {
        state.controls.pop()
        throw error
      }
      state.controlBusy = true
      state.entry.busy = true
      this.host.touch(state)
      try {
        // createBranchedSession is the public Pi operation used by runtime.fork
        // at an entry. Use an independently opened manager so source subscriptions,
        // active leaf and agent context remain untouched.
        const manager = await this.host.fileManager(state.record, true)
        manager.createBranchedSession(entryId)
        operation.targetSessionFile = manager.getSessionFile()
        manager.appendCustomEntry("moon-fork-lineage", {
          sessionId: operation.targetSessionId,
          sourceSessionId: sessionId,
          sourceTitle: state.record.title,
          sourceEntryId: entryId,
          operationId,
        })
        operation.targetSessionFile = manager.getSessionFile()
        await this.persist(state)
        await this.finishFork(state, operation, selected)
      } catch {
        operation.status = "unknown"
        operation.error = "分支结果待确认，请检查原操作状态；原会话保留。"
      } finally {
        operation.updatedAt = new Date().toISOString()
        try {
          await this.persist(state)
        } catch {
          operation.status = "unknown"
          operation.error = "无法保存分支回执，请检查原操作状态。"
        }
        state.controlBusy = false
        state.entry.busy = false
        this.host.touch(state)
      }
      return this.present(operation)
    })
  }
  async finishFork(state, operation, selected) {
    const within = relative(
      resolve(this.host.directory),
      resolve(operation.targetSessionFile)
    )
    check(
      within && !within.startsWith("..") && !isAbsolute(within),
      "派生历史不在应用数据目录中。"
    )
    assertSchema(
      schemas.SessionConfiguration,
      operation.configuration,
      "派生配置快照"
    )
    const lineage = {
      sourceSessionId: state.record.id,
      sourceTitle: state.record.title,
      sourceEntryId: operation.anchorId,
    }
    await this.host.sessions.copyConfiguration(
      operation.targetSessionId,
      operation.configuration
    )
    let record = await this.host.store.get(operation.targetSessionId)
    if (!record)
      record = await this.host.store.create({
        id: operation.targetSessionId,
        workspaceId: state.record.workspaceId,
        cwd: state.record.cwd,
        title: `${state.record.title}（分支）`.slice(0, 400),
        sessionFile: operation.targetSessionFile,
        modelId: state.record.modelId,
        thinking: state.record.thinking,
        lineage,
      })
    await this.host.restore(record, selected)
    operation.status = "completed"
    operation.error = ""
  }
  async reconcileFork(state, operation) {
    if (!operation.targetSessionFile) {
      // Recover a copied Pi path whose receipt write was interrupted. Match the
      // durable custom lineage identity, never a title or approximate timestamp.
      for (const file of await readdir(this.host.directory).catch((error) =>
        error.code === "ENOENT" ? [] : Promise.reject(error)
      )) {
        if (!file.endsWith(".jsonl")) continue
        const path = join(this.host.directory, file)
        const content = await readFile(path, "utf8")
        let matches = false
        try {
          matches = content
            .split("\n")
            .filter(Boolean)
            .some((line) => {
              const entry = JSON.parse(line)
              return (
                entry.type === "custom" &&
                entry.customType === "moon-fork-lineage" &&
                entry.data?.operationId === operation.id &&
                entry.data?.sessionId === operation.targetSessionId
              )
            })
        } catch {
          continue
        }
        if (matches) {
          operation.targetSessionFile = path
          break
        }
      }
    }
    if (operation.targetSessionFile && operation.configuration) {
      try {
        await this.finishFork(state, operation)
      } catch {
        operation.status = "unknown"
        operation.error =
          "分支历史已创建，配置或目录尚未确认；请检查原操作状态。"
      }
    } else {
      operation.status = "unknown"
      operation.error = "无法确认上次创建结果；请保留原操作标识，不重复创建。"
    }
    operation.updatedAt = new Date().toISOString()
    await this.persist(state)
  }
}
