import { mkdir, readFile } from "node:fs/promises"
import { join, resolve, relative, isAbsolute } from "node:path"
import { randomUUID, createHash } from "node:crypto"
import { nestedMcpTools, mcpResultsIndex } from "./mcp.mjs"
import {
  CURRENT_SESSION_VERSION,
  parseSessionEntries,
  SessionManager,
} from "@earendil-works/pi-coding-agent"
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { ConversationQueue } from "./conversation-queue.mjs"
import { ConversationControls } from "./conversation-controls.mjs"

const requireValue = (value, message) => {
  if (!value) throw new Error(message)
}
const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content || [])
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
const excerpt = (value, length = 32000) =>
  value.length > length ? value.slice(0, length) + "\n[输出已截断]" : value
const providerId = (connection) =>
  connection.kind === "subscription"
    ? connection.providerId
    : `moon-${connection.id}`
const selectionId = (connectionId, modelId) => `${connectionId}/${modelId}`
const identity = (value) =>
  requireValue(
    typeof value === "string" &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
      !["__proto__", "constructor", "prototype"].includes(value),
    "会话或请求标识无效。"
  )
// Provider bodies can echo credentials and request headers. Persist/display
// only fixed diagnostics; Pi classifies recovery using its untouched originals.
const errorText = (error) => {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|unauthoriz|invalid.{0,12}(api.?key|credential)/i.test(message))
    return "模型认证失败（401），请检查连接凭据。"
  if (/403|forbidden|permission.denied/i.test(message))
    return "模型访问被拒绝（403），请检查账号权限。"
  if (/429|rate.?limit|too.many.requests/i.test(message))
    return "模型服务请求过于频繁（429），请稍后重试。"
  if (/\b50[0-9]\b|overload|service.unavailable/i.test(message))
    return "模型服务暂时不可用（503 overloaded），请稍后重试。"
  if (
    /context.{0,20}(length|window|exceed|overflow)|token.{0,15}limit/i.test(
      message
    )
  )
    return "模型上下文超过限制（context overflow），请调整模型或新建会话。"
  if (/timeout|timed.out|ETIMEDOUT/i.test(message))
    return "模型连接超时（timeout），请检查网络后继续。"
  if (/ENOSPC|disk.{0,10}full/i.test(message))
    return "本地磁盘空间不足，无法保存会话。"
  if (/EACCES|EPERM/i.test(message)) return "本地会话文件权限不足，无法保存。"
  if (/abort|请求已停止/i.test(message)) return "请求已停止。"
  if (/400|invalid.request/i.test(message))
    return "模型服务拒绝请求（400），请检查模型、协议与能力配置。"
  if (/fetch.failed|ECONN|ENOTFOUND|network/i.test(message))
    return "无法连接模型服务，请检查端点与网络。"
  return "模型请求失败，请检查模型配置和服务状态后继续。"
}
const continuation =
  "请继续完成上一条用户请求；保留已经完成的工作和工具结果，不要重复执行已经成功的操作。"
const shellResult = (result, name) => {
  if (!["bash", "powershell"].includes(name)) return {}
  const content = result?.structuredContent
  if (!content || typeof content !== "object") return {}
  return {
    ...(Number.isInteger(content.exit_code)
      ? { exitCode: content.exit_code }
      : {}),
    ...(Number.isFinite(content.wall_time_seconds) &&
    content.wall_time_seconds >= 0
      ? { durationMs: Math.round(content.wall_time_seconds * 1000) }
      : {}),
  }
}
const toolOccurrenceKey = (entryId, index) => JSON.stringify([entryId, index])
const savedShellResult = (data) => ({
  ...(Number.isInteger(data.exitCode) ? { exitCode: data.exitCode } : {}),
  ...(Number.isFinite(data.durationMs) && data.durationMs >= 0
    ? { durationMs: data.durationMs }
    : {}),
})
const compactionReason = (reason) =>
  reason === "overflow"
    ? "上下文超过限制，Pi 正在压缩对话历史。"
    : reason === "manual"
      ? "Pi 正在压缩会话上下文。"
      : "上下文接近上限，Pi 正在压缩历史。"
const compactionErrorText = (message) =>
  errorText(
    String(message).replace(
      /^(Auto-compaction failed|Context overflow recovery failed):\s*/i,
      ""
    )
  )

// Moon indexes conversations; Pi is the sole authority for transcript, context,
// compaction, provider streaming, tool execution and the on-disk JSONL format.
export class ConversationService {
  constructor(directory, models, sessions, store, workspaces) {
    this.directory = join(directory, "conversations", "pi")
    this.models = models
    this.sessions = sessions
    this.store = store
    this.workspaces = workspaces
    this.active = new Map()
    this.persistence = new WeakMap()
    this.epoch = randomUUID()
    this.version = Date.now()
    this.closed = false
    this.queue = new ConversationQueue(directory, this)
    this.controls = new ConversationControls(this, directory)
  }
  ensureOpen() {
    requireValue(!this.closed, "对话服务已关闭，请重新打开 Moon。")
  }
  touch(state) {
    state.version = ++this.version
  }
  async selection(connectionId, modelId, thinking, signal) {
    signal?.throwIfAborted()
    const data = await this.models.store.read()
    const connection = data.connections.find((item) => item.id === connectionId)
    requireValue(connection, "所选模型连接已移除，请重新选择模型。")
    const definition = connection.models.find((item) => item.id === modelId)
    requireValue(definition, "所选模型已移除，请重新选择模型。")
    const presented = await this.models.present(connection, data)
    requireValue(!presented.issue, presented.issue)
    const runtime = await this.models.runtime(connection)
    const model = runtime.getModel(providerId(connection), modelId)
    requireValue(model, "Pi 未找到所选模型，请检查模型配置。")
    const levels = model.reasoning ? getSupportedThinkingLevels(model) : ["off"]
    requireValue(
      levels.includes(thinking),
      "所选模型不支持此思考等级，请重新选择。"
    )
    signal?.throwIfAborted()
    return { connection, model, runtime, thinking }
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
      ...history,
    }
    this.persistence.set(manager, persistence)
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
        if (
          method === "appendMessage" &&
          args[0].role === "assistant" &&
          args[0].errorMessage
        )
          args[0] = {
            ...args[0],
            errorMessage: errorText(args[0].errorMessage),
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
    const history = this.persistence.get(manager)
    if (!history?.migrationRequired) return ""
    return history.stableEntryIds
      ? "旧格式历史仍需迁移，暂不能创建分支；继续发送一次消息后由 Pi 自动迁移。"
      : "旧格式历史尚未保存稳定的消息标识，暂不能创建分支；继续发送一次消息后由 Pi 自动迁移。"
  }
  async fileManager(record, persistent = false) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (!record.sessionFile)
      return this.safeHistory(SessionManager.create(record.cwd, this.directory))
    const file = resolve(record.sessionFile)
    const within = relative(resolve(this.directory), file)
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
          SessionManager.create(record.cwd, this.directory)
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
        ? SessionManager.open(file, this.directory, record.cwd)
        : SessionManager.inMemory(record.cwd, undefined, entries),
      {
        stableEntryIds: persistent || version >= 2,
        migrationRequired: !persistent && version < CURRENT_SESSION_VERSION,
      }
    )
  }
  async restore(record, selected, signal) {
    const existing = this.active.get(record.id)
    if (existing) {
      if (existing.historyError) {
        existing.manager = await this.fileManager(record)
        try {
          await this.queue.reconcile(existing)
        } catch {
          existing.queueError =
            "历史已核对，但队列状态保存失败；请检查磁盘与权限后重试。"
        }
        existing.historyError = undefined
      }
      if (selected && !existing.session)
        await this.activate(existing, selected, signal)
      await this.controls.load(existing)
      return existing
    }
    // Reading a transcript must not choose a fallback model, require a surviving
    // workspace, or rewrite the file. A live agent is attached only for sending.
    const manager = await this.fileManager(record)
    const state = {
      record,
      manager,
      entry: { busy: false },
      version: ++this.version,
      pending: undefined,
      toolProgress: new Map(),
      run: undefined,
      stopRequested: false,
      stoppedToolIds: new Set(),
      stoppedToolCalls: new Set(),
      phase: record.status,
      error: record.lastError || "",
      requests: new Map(),
      inputAccepted: false,
      runtime: undefined,
      compactionActive: false,
      recoveredContext: undefined,
      notice: undefined,
    }
    await this.queue.load(state)
    let requestBeforeMessage
    for (const item of manager.getEntries()) {
      if (item.type === "custom" && item.customType === "moon-request")
        requestBeforeMessage = item.data?.clientRequestId
      if (
        requestBeforeMessage === record.lastRequestId &&
        ((item.type === "message" && item.message.role === "user") ||
          item.type === "custom_message")
      )
        state.inputAccepted = true
      if (
        item.type === "custom" &&
        item.customType === "moon-run-result" &&
        item.data?.runId === record.runId &&
        record.status === "idle" &&
        item.data.phase === "interrupted"
      )
        state.phase = "interrupted"
      if (
        item.type === "custom" &&
        item.customType === "moon-run-result" &&
        item.data?.runId === record.runId &&
        item.data.notice
      )
        state.notice = item.data.notice
      if (
        item.type === "custom" &&
        item.customType === "moon-request" &&
        item.data?.clientRequestId
      )
        state.requests.set(item.data.clientRequestId, item.data)
      // Statistics are stored in the authoritative Pi file, never in a parallel
      // transcript. A later compaction invalidates pre-compaction usage.
      if (item.type === "compaction")
        state.recoveredContext = {
          contextState: {
            status: "awaiting-response",
            observedAt: item.timestamp,
            reason: "历史已压缩，等待下一次模型回复更新上下文统计。",
          },
        }
      if (
        item.type === "custom" &&
        item.customType === "moon-context-usage" &&
        item.data?.modelId === record.modelId
      )
        state.recoveredContext = item.data.feedback
    }
    if (record.lastRequestId && !state.requests.has(record.lastRequestId))
      state.requests.set(record.lastRequestId, {
        clientRequestId: record.lastRequestId,
        fingerprint: record.lastRequestFingerprint,
        runId: record.runId,
      })
    if (selected) await this.activate(state, selected, signal)
    await this.controls.load(state)
    this.active.set(record.id, state)
    return state
  }
  async activate(state, selected, signal) {
    const record = state.record
    const config = await this.sessions.readExclusive(record.id, signal)
    requireValue(config, "此会话缺少工具与指令配置，请打开会话配置后重试。")
    signal?.throwIfAborted()
    if (!state.manager.isPersisted())
      state.manager = await this.fileManager(record, true)
    const session = await this.sessions.create(
      record.cwd,
      config.instructions,
      config.toolIds,
      signal,
      true,
      {
        sessionManager: state.manager,
        modelRuntime: selected.runtime,
        model: selected.model,
        thinking: selected.thinking,
        extensionFactories: [this.queue.factory(state)],
      }
    )
    if (this.closed) {
      session.dispose()
      this.ensureOpen()
    }
    this.sessions.active.get(record.id)?.session.dispose()
    state.entry = {
      revision: config.revision,
      session,
      persistent: true,
      busy: false,
    }
    this.sessions.active.set(record.id, state.entry)
    state.session = session
    this.persistence.get(state.manager).beforeInput = (message) =>
      this.queue.beforeInput(state, message)
    this.persistence.get(state.manager).onInput = (_message, queued) => {
      this.queue.afterInput(state, queued)
      if (!state.entry.busy) return
      state.inputAccepted = true
      state.acceptedResolve?.()
      this.touch(state)
    }
    state.unsubscribe = session.subscribe((event) => this.event(state, event))
  }
  toolHistory(branch) {
    const calls = new Map()
    const byPart = new Map()
    const results = new Map()
    const shellResults = new Map()
    let batch = []
    let runId
    for (const entry of branch) {
      if (entry.type === "custom" && entry.customType === "moon-request") {
        runId = entry.data?.runId
        batch = []
      }
      if (entry.type === "message" && entry.message.role === "assistant") {
        batch = []
        for (const [index, part] of (Array.isArray(entry.message.content)
          ? entry.message.content
          : []
        ).entries()) {
          if (part.type !== "toolCall") continue
          const call = {
            key: toolOccurrenceKey(entry.id, index),
            entryId: entry.id,
            index,
            part,
            runId,
          }
          calls.set(call.key, call)
          byPart.set(part, call)
          batch.push(call)
        }
      }
      if (entry.type === "message" && entry.message.role === "toolResult") {
        const result = entry.message
        const call = batch.find(
          (call) =>
            call.part.id === result.toolCallId &&
            call.part.name === result.toolName &&
            !results.has(call.key)
        )
        if (call) results.set(call.key, result)
      }
      if (entry.type === "custom" && entry.customType === "moon-shell-result") {
        const data = entry.data
        if (!data || !["bash", "powershell"].includes(data.toolName)) continue
        // New markers identify the exact official assistant entry and content
        // position. Older markers bind where Pi appended them, within that
        // assistant's tool batch; provider IDs need not be globally unique.
        const call =
          typeof data.callEntryId === "string" &&
          Number.isInteger(data.callIndex)
            ? calls.get(toolOccurrenceKey(data.callEntryId, data.callIndex))
            : batch.find(
                (call) =>
                  call.part.id === data.toolCallId &&
                  call.part.name === data.toolName &&
                  !shellResults.has(call.key)
              )
        if (
          call &&
          call.part.id === data.toolCallId &&
          call.part.name === data.toolName
        )
          shellResults.set(call.key, savedShellResult(data))
      }
    }
    return { calls, byPart, results, shellResults }
  }
  toolExecutionCall(state, event, starting = false) {
    if (!starting) {
      const active = [...state.toolProgress.entries()]
        .reverse()
        .find(
          ([, progress]) =>
            progress.status === "running" &&
            progress.toolCallId === event.toolCallId &&
            (!event.toolName || progress.name === event.toolName)
        )
      if (active) return { key: active[0], ...active[1] }
    }
    const candidates = [
      ...this.toolHistory(state.manager.getBranch()).calls.values(),
    ].filter(
      (call) =>
        call.runId === state.record.runId &&
        call.part.id === event.toolCallId &&
        call.part.name === event.toolName
    )
    const entryId = candidates.at(-1)?.entryId
    const call = candidates.find(
      (call) =>
        call.entryId === entryId &&
        (!starting || !state.toolProgress.has(call.key))
    )
    return (
      call && {
        key: call.key,
        entryId: call.entryId,
        index: call.index,
        toolCallId: call.part.id,
        name: call.part.name,
      }
    )
  }
  event(state, event) {
    if (event.type === "message_start" && event.message.role === "user")
      this.queue.inputStarted(state, event.message)
    if (
      ["message_start", "message_update"].includes(event.type) &&
      event.message?.role === "assistant"
    )
      state.pending = event.message
    if (event.type === "message_end") {
      if (event.message.role === "assistant") state.pending = undefined
      // message_end precedes persistence. Only the successful append adapter
      // may acknowledge input; a microtask runs even if the disk write failed.
      queueMicrotask(() => this.touch(state))
    }
    if (event.type === "tool_execution_start") {
      const call = this.toolExecutionCall(state, event, true)
      if (call)
        state.toolProgress.set(call.key, {
          ...call,
          status: "running",
          result: "",
        })
    }
    if (event.type === "tool_execution_update") {
      const call = this.toolExecutionCall(state, event)
      if (call)
        state.toolProgress.set(call.key, {
          ...call,
          status: "running",
          result: excerpt(textOf(event.partialResult?.content)),
        })
    }
    if (event.type === "tool_execution_end") {
      const call = this.toolExecutionCall(state, event)
      const metadata = shellResult(event.result, event.toolName)
      if (call && Object.keys(metadata).length) {
        // Pi emits structuredContent here, but its ToolResultMessage intentionally
        // keeps only content/details. Persist the actual execution metadata with
        // the public custom-entry API so settled results and restarts retain it.
        state.manager.appendCustomEntry("moon-shell-result", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          callEntryId: call.entryId,
          callIndex: call.index,
          ...metadata,
        })
      }
      if (call)
        state.toolProgress.set(call.key, {
          ...call,
          status:
            event.isError &&
            state.stoppedToolCalls.has(call.key) &&
            metadata.exitCode === undefined
              ? "stopped"
              : event.isError ||
                  (metadata.exitCode !== undefined && metadata.exitCode !== 0)
                ? "failed"
                : "success",
          result: excerpt(textOf(event.result?.content)),
          ...metadata,
        })
    }
    this.executionEvent(state, event)
    this.touch(state)
  }
  executionEvent(state, event) {
    // Pi compact() awaits abort() before creating its compaction controller.
    // A cancel accepted during that gap must abort once the controller exists,
    // including idle manual compaction whose reply phase is already terminal.
    if (
      event.type === "compaction_start" &&
      event.reason === "manual" &&
      state.controlCancelRequested
    )
      state.session?.abortCompaction()
    // Stop and terminal states take precedence over late SDK recovery events.
    if (state.phase !== "running" || state.stopRequested) return
    const stage = (phase, extra = {}) => {
      state.runtime = { phase, updatedAt: new Date().toISOString(), ...extra }
    }
    const retry = (source) =>
      stage("retrying", {
        ...(Number.isInteger(event.attempt) && event.attempt >= 0
          ? { attempt: event.attempt }
          : {}),
        ...(Number.isInteger(event.maxAttempts) && event.maxAttempts >= 0
          ? { maxAttempts: event.maxAttempts }
          : {}),
        ...(Number.isFinite(event.delayMs) && event.delayMs >= 0
          ? { retryAt: new Date(Date.now() + event.delayMs).toISOString() }
          : {}),
        reason: errorText(event.errorMessage || "模型请求失败"),
        retrySource: source,
      })
    if (
      ["agent_start", "turn_start", "message_start"].includes(event.type) &&
      !state.compactionActive &&
      (event.type !== "message_start" || event.message?.role === "assistant")
    )
      stage("responding")
    if (event.type === "tool_execution_start")
      stage("tool", event.toolName ? { toolName: event.toolName } : {})
    if (event.type === "tool_execution_end") {
      const activeTool = [...state.toolProgress.values()].find(
        (tool) => tool.status === "running"
      )
      stage(
        activeTool ? "tool" : "responding",
        activeTool?.name ? { toolName: activeTool.name } : {}
      )
    }
    if (event.type === "compaction_start") {
      state.compactionActive = true
      state.compactionReason = event.reason
      stage("compacting", { reason: compactionReason(event.reason) })
    }
    if (event.type === "compaction_end") {
      state.compactionActive = false
      stage(
        "responding",
        event.errorMessage
          ? { reason: compactionErrorText(event.errorMessage) }
          : {}
      )
      if (event.errorMessage && !event.aborted)
        state.notice = {
          kind: "compaction-failed",
          message: `上下文压缩未完成：${compactionErrorText(event.errorMessage)} 已生成的回复和工具结果已保留。`,
          occurredAt: new Date().toISOString(),
          runId: state.record.runId,
        }
    }
    if (event.type === "auto_retry_start") retry("response")
    if (event.type === "auto_retry_end") stage("responding")
    if (event.type === "summarization_retry_scheduled") retry("compaction")
    if (
      event.type === "summarization_retry_attempt_start" ||
      (event.type === "summarization_retry_finished" && state.compactionActive)
    )
      stage("compacting", {
        reason: compactionReason(event.reason || state.compactionReason),
      })
  }
  contextFeedback(state) {
    if (!state.session) {
      if (state.recoveredContext?.context)
        return {
          context: { ...state.recoveredContext.context, restored: true },
        }
      if (state.recoveredContext?.contextState) return state.recoveredContext
      return {
        contextState: {
          status: "unavailable",
          observedAt: new Date().toISOString(),
          reason: "此历史尚未记录 Pi 上下文统计；继续对话后由 Pi 更新。",
        },
      }
    }
    const usage = state.session.getContextUsage()
    const observedAt = new Date().toISOString()
    if (
      usage &&
      Number.isFinite(usage.contextWindow) &&
      usage.contextWindow > 0
    ) {
      if (Number.isFinite(usage.tokens) && usage.tokens >= 0)
        return {
          context: {
            usedTokens: Math.round(usage.tokens),
            contextWindow: usage.contextWindow,
            source: "pi-context-estimate",
            estimated: true,
            observedAt,
            restored: false,
          },
        }
      return {
        contextState: {
          status: "awaiting-response",
          contextWindow: usage.contextWindow,
          observedAt,
          reason:
            "Pi 尚无法确定当前用量；历史压缩后需等待下一次模型回复更新统计。",
        },
      }
    }
    return {
      contextState: {
        status: "unavailable",
        observedAt,
        reason: "当前没有可用的 Pi 上下文统计，继续对话后更新。",
      },
    }
  }
  cancellations(state, branch, history) {
    const interrupted = new Set()
    const stoppedCalls = new Set()
    let runId
    let lastAssistant
    let calls = []
    const mark = (toolIds = [], occurrences) => {
      // Only the terminal reply of this explicitly interrupted run changes its
      // display state; genuine failures earlier in the run or history remain.
      if (["error", "aborted"].includes(lastAssistant?.stopReason))
        interrupted.add(lastAssistant)
      if (occurrences) {
        for (const key of occurrences) {
          const call = history.calls.get(key)
          if (call?.runId === runId) stoppedCalls.add(call.part)
        }
      } else {
        // Old stop markers contain provider IDs only. Bind each to the latest
        // occurrence in that run, never an earlier failure sharing its ID.
        // Actual successful/nonzero results still take precedence in the DTO.
        for (const id of toolIds) {
          const call = [...calls].reverse().find((part) => part.id === id)
          if (call) stoppedCalls.add(call)
        }
      }
    }
    for (const entry of branch) {
      if (entry.type === "custom" && entry.customType === "moon-request") {
        runId = entry.data?.runId
        lastAssistant = undefined
        calls = []
      }
      if (entry.type === "message" && entry.message.role === "assistant") {
        lastAssistant = entry.message
        for (const part of Array.isArray(entry.message.content)
          ? entry.message.content
          : [])
          if (part.type === "toolCall") calls.push(part)
      }
      if (
        entry.type === "custom" &&
        entry.customType === "moon-run-result" &&
        entry.data?.runId === runId &&
        entry.data.phase === "interrupted"
      )
        mark(
          entry.data.stoppedToolIds,
          Array.isArray(entry.data.stoppedToolCalls)
            ? entry.data.stoppedToolCalls.map((call) =>
                toolOccurrenceKey(call.entryId, call.index)
              )
            : undefined
        )
    }
    // Live cancellation is authoritative before the durable terminal marker is
    // appended. Restored history uses its own per-run markers, never current phase.
    if (
      state.stopRequested &&
      runId === state.record.runId &&
      ["stopping", "interrupted"].includes(state.phase)
    )
      mark([...state.stoppedToolIds], state.stoppedToolCalls)
    return { interrupted, stoppedCalls }
  }
  transcript(state) {
    const messages = []
    const source = []
    const branch = state.manager.getBranch()
    const materialInputs = new WeakMap()
    let nextMaterials
    const history = this.toolHistory(branch)
    const nestedResults = mcpResultsIndex(branch)
    const cancellation = this.cancellations(state, branch, history)
    const entriesByMessage = new Map()
    const stableEntryIds = this.persistence.get(state.manager)?.stableEntryIds !== false
    branch.forEach((entry, historyIndex) => {
      if (entry.type === "message")
        entriesByMessage.set(entry.message, {
          ...(stableEntryIds ? { entryId: entry.id } : {}),
          historyIndex,
        })
    })
    for (const entry of branch) {
      if (entry.type === "custom" && entry.customType === "moon-request")
        nextMaterials = undefined
      else if (entry.type === "custom" && entry.customType === "moon-materials")
        nextMaterials = entry.data
      else if (entry.type === "message") {
        if (entry.message.role === "user" && nextMaterials) {
          materialInputs.set(entry.message, nextMaterials)
          nextMaterials = undefined
        }
        source.push(entry.message)
      } else if (entry.type === "custom_message" && entry.display)
        source.push({
          role: "user",
          content: entry.content,
          timestamp: Date.parse(entry.timestamp),
        })
    }
    if (state.pending) source.push(state.pending)
    const seen = new Map()
    for (const message of source) {
      if (!["user", "assistant"].includes(message.role)) continue
      const base = `${message.role}-${message.timestamp}`
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      const id = `${base}-${count}`
      const live = message === state.pending
      const item = {
        id,
        ...entriesByMessage.get(message),
        role: message.role,
        text: textOf(message.content),
        time: new Date(message.timestamp).toISOString(),
        status: live
          ? "streaming"
          : cancellation.interrupted.has(message) ||
              message.stopReason === "aborted"
            ? "interrupted"
            : message.stopReason === "error"
              ? "failed"
              : "settled",
      }
      const prepared = materialInputs.get(message)
      if (prepared && message.role === "user") {
        item.text = prepared.text
        item.materials = prepared.materials
        item.attachments = prepared.materials.map((material) => ({
          id: material.id,
          name: material.name,
          kind: material.type === "image" ? "image" : "file",
          source: material.source,
          materialType: material.type,
        }))
      }
      if (message.role === "assistant") {
        item.model = message.model || state.record.modelId
        item.forkable =
          !!item.entryId &&
          !this.historyNotice(state.manager) &&
          !live &&
          ["stop", "length"].includes(message.stopReason) &&
          !message.content.some((part) => part.type === "toolCall")
        const content = Array.isArray(message.content) ? message.content : []
        const thinkingText = content
          .filter((part) => part.type === "thinking")
          .map((part) => part.thinking)
          .join("\n")
        if (thinkingText) item.thinking = { text: thinkingText }
        const blocks = []
        const tools = []
        for (const [index, part] of content.entries()) {
          if (part.type === "text")
            blocks.push({ id: `${id}-${index}`, type: "text", text: part.text })
          if (part.type === "toolCall") {
            const call = history.byPart.get(part)
            const result = history.results.get(call?.key)
            const progress =
              call?.runId === state.record.runId
                ? state.toolProgress.get(call.key)
                : undefined
            const metadata = {
              ...history.shellResults.get(call?.key),
              ...(result
                ? shellResult(result, part.name)
                : {
                    ...(progress?.exitCode !== undefined
                      ? { exitCode: progress.exitCode }
                      : {}),
                    ...(progress?.durationMs !== undefined
                      ? { durationMs: progress.durationMs }
                      : {}),
                  }),
            }
            const status = result
              ? result.isError &&
                cancellation.stoppedCalls.has(part) &&
                metadata.exitCode === undefined
                ? "stopped"
                : result.isError ||
                    (metadata.exitCode !== undefined && metadata.exitCode !== 0)
                  ? "failed"
                  : "success"
              : progress?.status ||
                (cancellation.stoppedCalls.has(part) ? "stopped" : "not-run")
            const tool = {
              id: part.id,
              name: part.name,
              source: this.models.mcp?.toolSource(part.name) || "Pi",
              status,
              input: JSON.stringify(part.arguments, null, 2) || "{}",
              result: result
                ? excerpt(textOf(result.content))
                : progress?.result || "",
              ...metadata,
            }
            tools.push(tool)
            blocks.push({ id: `${id}-${index}`, type: "tool", tool })
            for (const nested of nestedMcpTools(
              result,
              nestedResults,
              call,
              (name) => this.models.mcp?.toolSource(name)
            )) {
              tools.push(nested)
              blocks.push({
                id: `${id}-${index}-${nested.id}`,
                type: "tool",
                tool: nested,
              })
            }
          }
        }
        if (tools.length) item.tools = tools
        if (blocks.length) item.blocks = blocks
        if (message.stopReason === "error" && !item.text)
          item.text = errorText(message.errorMessage || "模型请求失败。")
      }
      messages.push(item)
    }
    return messages
  }
  snapshot(state) {
    const record = state.record
    const slash = record.modelId.indexOf("/")
    const snapshot = {
      id: record.id,
      title: record.title,
      workspaceId: record.workspaceId,
      cwd: record.cwd,
      version: state.version,
      epoch: this.epoch,
      clientRequestId: record.lastRequestId || "",
      inputAccepted: state.inputAccepted,
      runId: record.runId || "",
      phase: state.phase,
      modelId: record.modelId,
      connectionId: slash < 0 ? "" : record.modelId.slice(0, slash),
      providerModelId: slash < 0 ? "" : record.modelId.slice(slash + 1),
      thinking: record.thinking || "off",
      error: state.error || "",
      messages: this.transcript(state),
      queue: this.queue.snapshot(state),
      ...(state.queueError ? { queueError: state.queueError } : {}),
      ...this.controls.projection(state),
      ...(record.lineage ? { lineage: record.lineage } : {}),
      ...(state.phase === "running" && state.runtime
        ? { runtime: state.runtime }
        : {}),
      ...(state.notice ? { notice: state.notice } : {}),
      ...(this.historyNotice(state.manager)
        ? { historyNotice: this.historyNotice(state.manager) }
        : {}),
      ...this.contextFeedback(state),
    }
    return snapshot
  }
  async read(sessionId, _afterVersion, signal) {
    identity(sessionId)
    return this.sessions.exclusive(sessionId, async () => {
      this.ensureOpen()
      signal?.throwIfAborted()
      const record = await this.store.get(sessionId, signal)
      requireValue(record, "会话不存在。")
      const state = await this.restore(record, undefined, signal)
      return this.snapshot(state)
    })
  }
  async send(
    sessionId,
    workspaceId,
    clientRequestId,
    text,
    connectionId,
    modelId,
    thinking,
    materials = [],
    signal
  ) {
    // Compatibility for direct callers written before message materials existed.
    if (materials instanceof AbortSignal) {
      signal = materials
      materials = []
    }
    identity(sessionId)
    identity(workspaceId)
    identity(clientRequestId)
    requireValue(
      typeof text === "string" &&
        (text.trim() || materials.length) &&
        text.length <= 100000,
      "请输入不超过 100000 字的消息。"
    )
    return this.start(
      {
        sessionId,
        workspaceId,
        clientRequestId,
        text,
        connectionId,
        modelId,
        thinking,
        materials,
        mode: "send",
      },
      signal
    )
  }
  async retry(
    sessionId,
    clientRequestId,
    connectionId,
    modelId,
    thinking,
    signal
  ) {
    identity(sessionId)
    identity(clientRequestId)
    return this.start(
      {
        sessionId,
        clientRequestId,
        text: continuation,
        connectionId,
        modelId,
        thinking,
        mode: "retry",
      },
      signal
    )
  }
  async start(input, signal) {
    const state = await this.sessions.exclusive(input.sessionId, async () => {
      this.ensureOpen()
      signal?.throwIfAborted()
      let record = await this.store.get(input.sessionId, signal)
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify([
            input.mode,
            input.text,
            input.connectionId,
            input.modelId,
            input.thinking,
            input.materials ?? [],
          ])
        )
        .digest("hex")
      if (record) {
        requireValue(
          !input.workspaceId || record.workspaceId === input.workspaceId,
          "已有会话不能更换工作区。"
        )
        const restored = await this.restore(record, undefined, signal)
        const queuedReceipt = restored.queue.items.find(
          (item) => item.clientRequestId === input.clientRequestId
        )
        if (queuedReceipt) {
          await this.queue.enqueueReceipt(restored, input)
          return restored
        }
        const accepted = restored.requests.get(input.clientRequestId)
        if (accepted) {
          requireValue(
            accepted.fingerprint === fingerprint,
            "请求标识已经用于不同内容，请重新发送。"
          )
          return restored
        }
        requireValue(!restored.controlBusy, "会话控制操作尚未完成，请稍候。")
        const unresolvedControl = this.controls.unresolvedReason(restored)
        requireValue(!unresolvedControl, unresolvedControl)
        if (restored.entry.busy && input.mode === "send") {
          requireValue(
            record.modelId === selectionId(input.connectionId, input.modelId) &&
              record.thinking === input.thinking,
            "运行中排队与补充沿用当前模型和思考强度；请等待结束后切换。"
          )
          await this.queue.enqueue(restored, input, signal)
          return restored
        }
        requireValue(
          !restored.entry.busy,
          "此会话正在执行，请先停止或等待完成。"
        )
        if (input.mode === "queue")
          requireValue(
            !restored.queue.paused &&
              restored.queue.items.some((item) => item.status === "pending"),
            "队列已暂停或没有可发送内容。"
          )
        if (input.mode === "retry") {
          requireValue(
            ["failed", "interrupted"].includes(restored.phase),
            "只有失败或中断的回复可以继续。"
          )
          requireValue(
            restored.inputAccepted &&
              this.transcript(restored).some(
                (message) => message.role === "user"
              ),
            "上一请求尚未写入对话，请在输入框重新发送。"
          )
        }
      } else requireValue(input.mode === "send", "会话不存在。")
      const workspace = await this.workspaces.get(
        record?.workspaceId || input.workspaceId,
        signal
      )
      requireValue(workspace, "工作区已移除，请重新添加目录。")
      const cwd = await this.sessions.cwd(workspace.path || workspace.cwd)
      requireValue(
        !record || record.cwd === cwd,
        "工作区路径已改变，请新建会话。"
      )
      const selected = await this.selection(
        input.connectionId,
        input.modelId,
        input.thinking,
        signal
      )
      input.preparedMaterials =
        input.materials?.length || input.text.startsWith("/skill:")
          ? await this.models.materials.resolveForPrompt({
              sessionId: input.sessionId,
              cwd,
              materials: input.materials ?? [],
              text: input.text,
              model: selected.model,
              signal,
            })
          : { textPrefix: "", images: [], displayMaterials: [] }
      let config = await this.sessions.readExclusive(input.sessionId, signal)
      if (this.sessions.refreshForRunExclusive)
        await this.sessions.refreshForRunExclusive(input.sessionId, signal)
      if (!config) {
        const catalog = await this.sessions.catalog(cwd, signal)
        config = await this.sessions.applyExclusive(
          input.sessionId,
          cwd,
          catalog.defaults.toolIds,
          catalog.defaults.instructionScope,
          undefined,
          signal
        )
      }
      requireValue(config.cwd === cwd, "会话配置与工作区目录不一致。")
      requireValue(
        config.unavailableToolIds.length === 0,
        "会话中有失效工具，请打开会话配置移除后再发送。"
      )
      signal?.throwIfAborted()
      if (!record)
        record = await this.store.create(
          {
            id: input.sessionId,
            workspaceId: input.workspaceId,
            cwd,
            title: (
              input.text.trim() ||
              input.preparedMaterials.displayMaterials
                .map((item) => item.name)
                .join("、")
            )
              .replace(/\s+/g, " ")
              .slice(0, 80),
            sessionFile: "",
            modelId: selectionId(input.connectionId, input.modelId),
            thinking: input.thinking,
          },
          signal
        )
      const state = await this.restore(record, selected, signal)
      const provider = providerId(selected.connection)
      const registered = selected.runtime.getRegisteredProviderConfig(provider)
      if (registered)
        state.session.modelRuntime.registerProvider(provider, registered)
      const model = state.session.modelRuntime.getModel(provider, input.modelId)
      requireValue(model, "Pi 未找到所选模型。")
      await state.session.setModel(model)
      state.session.setThinkingLevel(input.thinking)
      requireValue(
        state.session.thinkingLevel === input.thinking,
        "Pi 无法应用所选思考等级。"
      )
      signal?.throwIfAborted()
      this.ensureOpen()
      const runId = randomUUID()
      // Atomic index commit is the acceptance boundary. Closing the RPC caller
      // after this point must not cancel work; Stop identifies a specific run.
      state.record = await this.store.update(
        record.id,
        {
          sessionFile: state.manager.getSessionFile() || "",
          status: "running",
          unread: false,
          runId,
          lastError: "",
          modelId: selectionId(input.connectionId, input.modelId),
          thinking: input.thinking,
          lastRequestId: input.clientRequestId,
          lastRequestFingerprint: fingerprint,
        },
        signal
      )
      const request = {
        clientRequestId: input.clientRequestId,
        fingerprint,
        runId,
      }
      state.requests.set(input.clientRequestId, request)
      state.inputAccepted = false
      if (this.closed) {
        state.record = await this.store.update(record.id, {
          status: "idle",
          lastError: "应用关闭前请求尚未开始，请重新发送。",
        })
        state.phase = "interrupted"
        state.error = state.record.lastError
        return state
      }
      state.phase = "running"
      state.error = ""
      state.stopRequested = false
      state.stoppedToolIds.clear()
      state.stoppedToolCalls.clear()
      state.entry.busy = true
      state.pending = undefined
      state.toolProgress.clear()
      state.compactionActive = false
      state.runtime = {
        phase: "responding",
        updatedAt: new Date().toISOString(),
      }
      state.notice = undefined
      this.touch(state)
      state.accepted = new Promise((resolve) => {
        state.acceptedResolve = resolve
      })
      state.run = this.run(state, input)
      return state
    })
    // A successful send response never precedes Pi saving the user input. It
    // waits only for prompt preflight, not model generation or tool execution.
    if (
      state.queue.items.some(
        (item) => item.clientRequestId === input.clientRequestId
      )
    )
      return this.snapshot(state)
    await state.accepted
    return this.snapshot(state)
  }
  async run(state, input) {
    let failure
    const manager = state.manager
    const before = [manager.getHeader(), ...manager.getEntries()]
    try {
      state.manager.appendCustomEntry(
        "moon-request",
        state.requests.get(input.clientRequestId)
      )
      if (input.preparedMaterials?.displayMaterials.length)
        state.manager.appendCustomEntry("moon-materials", {
          clientRequestId: input.clientRequestId,
          text: input.text,
          materials: input.preparedMaterials.displayMaterials,
        })
      if (input.mode === "queue") await this.queue.seed(state)
      else if (input.mode === "retry")
        await state.session.sendCustomMessage(
          {
            customType: "moon-continuation",
            content: continuation,
            display: true,
          },
          { triggerTurn: true }
        )
      else
        await state.session.prompt(
          (input.preparedMaterials?.textPrefix ?? "") +
            ((input.preparedMaterials?.text ?? input.text) ||
              "请处理所附材料。"),
          {
            images: input.preparedMaterials?.images ?? [],
            expandPromptTemplates: false,
            preflightResult: () => {
              if (state.stopRequested || this.closed)
                throw new Error("请求已停止。")
            },
          }
        )
      const last = [...state.manager.getBranch()]
        .reverse()
        .find(
          (entry) =>
            entry.type === "message" && entry.message.role === "assistant"
        )?.message
      if (last?.stopReason === "error")
        failure = errorText(last.errorMessage || "模型请求失败。")
      if (last?.stopReason === "aborted") state.stopRequested = true
    } catch (error) {
      failure = errorText(error)
    } finally {
      await this.sessions.exclusive(state.record.id, async () => {
        const writeError = this.persistence.get(manager)?.error
        if (writeError) {
          failure = `会话历史保存失败：${errorText(writeError)}`
          state.unsubscribe?.()
          state.session?.dispose()
          state.session = undefined
          this.sessions.active.delete(state.record.id)
          state.toolProgress.clear()
          try {
            state.manager = await this.fileManager(state.record)
            try {
              await this.queue.reconcile(state)
            } catch {
              state.queueError =
                "历史已核对，但待处理状态保存失败；请检查磁盘与权限后重试。"
            }
          } catch (error) {
            // Preserve the file, including any partial write. A later read/send
            // validates it again; never reuse Pi's uncertain in-memory entries.
            state.manager = SessionManager.inMemory(
              state.record.cwd,
              undefined,
              before
            )
            state.historyError = error
            failure += ` ${error.message}`
          }
        }
        state.pending = undefined
        state.runtime = undefined
        state.compactionActive = false
        state.phase = state.stopRequested
          ? "interrupted"
          : failure
            ? "failed"
            : "completed"
        state.error = failure || ""
        for (const progress of state.toolProgress.values())
          if (progress.status === "running")
            progress.status = state.stopRequested ? "stopped" : "failed"
        const messages = this.transcript(state)
        const lastMessage =
          [...messages].reverse().find((message) => message.text)?.text || ""
        try {
          if (!writeError) {
            state.recoveredContext = this.contextFeedback(state)
            state.manager.appendCustomEntry("moon-context-usage", {
              modelId: state.record.modelId,
              feedback: state.recoveredContext,
            })
            state.manager.appendCustomEntry("moon-run-result", {
              runId: state.record.runId,
              phase: state.phase,
              error: state.error,
              ...(state.notice ? { notice: state.notice } : {}),
              ...(state.stoppedToolIds.size
                ? { stoppedToolIds: [...state.stoppedToolIds] }
                : {}),
              ...(state.stoppedToolCalls.size
                ? {
                    stoppedToolCalls: [...state.stoppedToolCalls].map((key) => {
                      const [entryId, index] = JSON.parse(key)
                      return { entryId, index }
                    }),
                  }
                : {}),
            })
          }
          state.record = await this.store.update(state.record.id, {
            status: state.phase === "interrupted" ? "idle" : state.phase,
            unread: true,
            lastError: state.error,
            lastMessage: lastMessage.slice(0, 2000),
            sessionFile: writeError
              ? state.record.sessionFile
              : state.manager.getSessionFile() || "",
          })
        } catch (error) {
          state.phase = "failed"
          state.error = `回复已结束，但会话记录保存失败：${errorText(error)}`
        }
        state.entry.busy = false
        if (state.phase !== "completed") {
          try {
            await this.queue.pause(state)
          } catch {
            state.queue.paused = true
            state.queueError =
              "执行已停止，但队列状态保存失败；请检查磁盘与权限。"
          }
        } else if (
          this.queuePending(state) &&
          !state.queue.paused &&
          !this.closed
        )
          queueMicrotask(() => {
            void this.queue.resume(state).catch(() => {
              state.queue.paused = true
              state.queueError = "队列启动失败，请重新读取后继续。"
              this.touch(state)
            })
          })
        state.acceptedResolve?.()
        this.touch(state)
      })
    }
  }
  async stop(sessionId, runId, signal) {
    identity(sessionId)
    identity(runId)
    return this.sessions.exclusive(sessionId, async () => {
      this.ensureOpen()
      const record = await this.store.get(sessionId, signal)
      requireValue(record, "会话不存在。")
      const state = await this.restore(record, undefined, signal)
      requireValue(
        state.record.runId === runId,
        "此运行已经变化，请重新读取对话。"
      )
      if (!state.entry.busy || state.stopRequested) return this.snapshot(state)
      signal?.throwIfAborted()
      try {
        await this.queue.pause(state)
      } catch {
        state.queue.paused = true
        state.queueError = "队列状态保存失败，消息保留；正在停止当前执行。"
      }
      state.record = await this.store.update(
        sessionId,
        { status: "stopping" },
        signal
      )
      state.stopRequested = true
      state.stoppedToolIds = new Set(
        [...state.toolProgress.values()]
          .filter((progress) => progress.status === "running")
          .map((progress) => progress.toolCallId)
      )
      state.stoppedToolCalls = new Set(
        [...state.toolProgress]
          .filter(([, progress]) => progress.status === "running")
          .map(([key]) => key)
      )
      state.phase = "stopping"
      state.runtime = undefined
      state.compactionActive = false
      this.touch(state)
      // abort() waits for Pi settlement; keep the transport request short.
      void state.session.abort().catch((error) => {
        state.error = errorText(error)
        this.touch(state)
      })
      return this.snapshot(state)
    })
  }
  close() {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this.closeActive()
    return this.closing
  }
  async closeActive() {
    await this.controls.close()
    const states = [...this.active.values()]
    for (const state of states)
      if (state.entry.busy) {
        state.stopRequested = true
        state.stoppedToolIds = new Set(
          [...state.toolProgress.values()]
            .filter((progress) => progress.status === "running")
            .map((progress) => progress.toolCallId)
        )
        state.stoppedToolCalls = new Set(
          [...state.toolProgress]
            .filter(([, progress]) => progress.status === "running")
            .map(([key]) => key)
        )
      }
    await Promise.allSettled(states.map((state) => state.session?.abort()))
    await Promise.allSettled(states.map((state) => state.run))
    for (const state of states) {
      state.unsubscribe?.()
      state.session?.dispose()
    }
    this.active.clear()
    await this.queue.close()
  }
  queuePending(state) {
    return this.queue.pending(state)
  }
  queueEdit(...args) {
    return this.queue.edit(...args)
  }
  queueRemove(...args) {
    return this.queue.remove(...args)
  }
  queueMode(...args) {
    return this.queue.mode(...args)
  }
  queueDeliver(...args) {
    return this.queue.deliver(...args)
  }
}
