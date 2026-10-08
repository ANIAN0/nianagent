import { ConversationTranscript } from "./conversation-transcript.mjs"
import { ConversationRun } from "./conversation-run.mjs"
import { PiHistory } from "./pi-history.mjs"
import { ConversationEvents } from "./conversation-events.mjs"
import {
  requireValue,
  providerId,
  identity,
  restoredIssue,
  storageIssue,
  queueFailure,
  continuation,
  acceptedInput,
} from "./conversation-core.mjs"
export { acceptedRequestIds } from "./conversation-core.mjs"

import { join } from "node:path"
import { randomUUID } from "node:crypto"

import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { ConversationQueue } from "./conversation-queue.mjs"
import { ConversationControls } from "./conversation-controls.mjs"
import { ConversationLive } from "./conversation-live.mjs"
import { ConversationPermissions } from "./conversation-permissions.mjs"
import { ConversationCommands } from "./conversation-commands.mjs"
import { conversationStatistics } from "./conversation-statistics.mjs"
import { publicFailure } from "./operation-issue.mjs"

import { assertSchema, schemas } from "./schema.mjs"

// Moon indexes conversations; Pi is the sole authority for transcript, context,
// compaction, provider streaming, tool execution and the on-disk JSONL format.
export class ConversationService {
  constructor(
    directory,
    models,
    sessions,
    store,
    workspaces,
    initializeStore = () => store.initialize()
  ) {
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
    const service = this
    this.queue = new ConversationQueue(directory, {
      epoch: this.epoch,
      touch: this.touch.bind(this),
      ensureOpen: this.ensureOpen.bind(this),
      models: {
        materials: {
          resolveForPrompt: this.models.materials.resolveForPrompt.bind(
            this.models.materials
          ),
        },
        store: { read: this.models.store.read.bind(this.models.store) },
      },
      sessions: { exclusive: this.sessions.exclusive.bind(this.sessions) },
      store: {
        get: this.store.get.bind(this.store),
        update: this.store.update.bind(this.store),
      },
      restore: this.restore.bind(this),
      snapshot: this.snapshot.bind(this),
      get closed() {
        return service.closed
      },
      active: this.active,
      start: this.start.bind(this),
    })
    this.controls = new ConversationControls(
      {
        historyNotice: this.historyNotice.bind(this),
        store: {
          get: this.store.get.bind(this.store),
          list: this.store.list.bind(this.store),
          create: this.store.create.bind(this.store),
        },
        ensureOpen: this.ensureOpen.bind(this),
        restore: this.restore.bind(this),
        sessions: {
          exclusive: this.sessions.exclusive.bind(this.sessions),
          active: this.sessions.active,
          readExclusive: this.sessions.readExclusive.bind(this.sessions),
          copyConfiguration: this.sessions.copyConfiguration.bind(
            this.sessions
          ),
        },
        selection: this.selection.bind(this),
        touch: this.touch.bind(this),
        persistence: this.persistence,
        fileManager: this.fileManager.bind(this),
        active: this.active,
        directory: this.directory,
      },
      directory
    )
    this.live = new ConversationLive({
      active: this.active,
      read: this.read.bind(this),
      ensureOpen: this.ensureOpen.bind(this),
      epoch: this.epoch,
      prepareMedia: this.prepareMedia.bind(this),
      snapshot: this.snapshot.bind(this),
    })
    this.permissions = new ConversationPermissions(directory, {
      sessions: {
        identity: this.sessions.identity.bind(this.sessions),
        exclusive: this.sessions.exclusive.bind(this.sessions),
      },
      active: this.active,
      touch: this.touch.bind(this),
      get closed() {
        return service.closed
      },
    })
    this.commands = new ConversationCommands(directory, {
      initializeStore,
      active: this.active,
      sessions: {
        active: this.sessions.active,
        identity: this.sessions.identity.bind(this.sessions),
        exclusive: this.sessions.exclusive.bind(this.sessions),
      },
      ensureOpen: this.ensureOpen.bind(this),
      store: this.store,
      restore: this.restore.bind(this),
      activate: this.activate.bind(this),
      selection: this.selection.bind(this),
      permissions: this.permissions,
      touch: this.touch.bind(this),
    })

    this.conversation_transcript = new ConversationTranscript({
      persistence: this.persistence,
      historyNotice: this.historyNotice.bind(this),
      models: {
        mcp: { toolSource: this.models.mcp.toolSource.bind(this.models.mcp) },
        extensions: {
          toolSource: this.models.extensions.toolSource.bind(
            this.models.extensions
          ),
          presentation: this.models.extensions.presentation.bind(
            this.models.extensions
          ),
        },
      },
    })

    this.conversation_run = new ConversationRun({
      sessions: this.sessions,
      ensureOpen: this.ensureOpen.bind(this),
      store: this.store,
      epoch: this.epoch,
      restore: this.restore.bind(this),
      queue: this.queue,
      persistence: this.persistence,
      fileManager: this.fileManager.bind(this),
      controls: this.controls,
      touch: this.touch.bind(this),
      lastStopReason: this.lastStopReason.bind(this),
      transcript: this.transcript.bind(this),
      workspaces: this.workspaces,
      selection: this.selection.bind(this),
      models: this.models,
      permissions: this.permissions,
      get closed() {
        return service.closed
      },
      snapshot: this.snapshot.bind(this),
      contextFeedback: this.contextFeedback.bind(this),
      handledNotice: this.handledNotice.bind(this),
      queuePending: this.queuePending.bind(this),
    })

    this.pi_history = new PiHistory({
      persistence: this.persistence,
      directory: this.directory,
    })

    this.conversation_events = new ConversationEvents({
      queue: this.queue,
      touch: this.touch.bind(this),
      toolExecutionCall: this.toolExecutionCall.bind(this),
    })
  }
  ensureOpen() {
    requireValue(!this.closed, "对话服务已关闭，请重新打开 Moon。")
  }
  touch(state) {
    state.version = ++this.version
    this.live.wake(state)
  }
  follow(...args) {
    return this.live.follow(...args)
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
    return this.pi_history.safeHistory(manager, history)
  }
  historyNotice(manager) {
    return this.pi_history.historyNotice(manager)
  }
  fileManager(record, persistent = false) {
    return this.pi_history.fileManager(record, persistent)
  }
  async restore(record, selected, signal) {
    const existing = this.active.get(record.id)
    if (existing) {
      if (
        existing.historyError ||
        (!existing.entry.busy && this.persistence.get(existing.manager)?.error)
      ) {
        existing.unsubscribe?.()
        existing.session?.dispose()
        existing.session = undefined
        this.sessions.active.delete(existing.record.id)
        existing.manager = await this.fileManager(record)
        try {
          await this.queue.reconcile(existing)
        } catch (error) {
          queueFailure(
            existing,
            error,
            "历史已读取，但待处理消息状态未能保存。请检查文件占用后重新读取。"
          )
        }
        existing.historyError = undefined
      }
      if (!existing.entry.busy && this.queue.hasStorageFailure(existing)) {
        try {
          await this.queue.reconcile(existing)
        } catch (error) {
          queueFailure(
            existing,
            error,
            "历史已读取，但待处理消息状态未能保存。请检查文件占用后重新读取。"
          )
        }
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
      issue: record.lastError
        ? publicFailure(new Error(record.lastError), "conversationRead").issue
        : undefined,
      queueIssue: undefined,
      requests: new Map(),
      inputAccepted: false,
      runtime: undefined,
      compactionActive: false,
      recoveredContext: undefined,
      notice: undefined,
    }
    await this.queue.load(state)
    state.permission = await this.permissions.read(record.id, signal)
    state.inputAccepted = acceptedInput(manager, record.lastRequestId)
    for (const item of manager.getEntries()) {
      if (
        item.type === "custom" &&
        item.customType === "moon-run-result" &&
        item.data?.runId === record.runId &&
        item.data.statistics
      ) {
        try {
          assertSchema(schemas.ConversationStatistics, item.data.statistics)
          state.recoveredStatistics = item.data.statistics
        } catch {
          /* Optional metrics never prevent history recovery. */
        }
      }
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
        item.customType === "moon-run-result" &&
        item.data?.runId === record.runId &&
        item.data.error === record.lastError
      ) {
        const issue = restoredIssue(item.data.issue)
        if (issue) {
          state.issue = issue
          if (typeof item.data.issueEntryId === "string")
            state.issueEntryId = item.data.issueEntryId
        }
      }
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
    const receipt = record.lastRequestId
      ? await this.store.request(record.id, record.lastRequestId, signal)
      : undefined
    if (receipt?.status === "handled") {
      state.inputDisposition = "handled"
      state.notice = this.handledNotice(receipt.runId, receipt.updatedAt)
    }
    if (selected) await this.activate(state, selected, signal)
    await this.controls.load(state)
    this.active.set(record.id, state)
    return state
  }
  async activate(state, selected, signal) {
    const record = state.record
    state.permission = await this.permissions.read(record.id, signal)
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
        extensionFactories: [
          this.nativeInputFactory(state),
          this.permissions.factory(state),
          this.queue.factory(state),
        ],
        uiContext: this.permissions.ui(state),
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
    this.persistence.get(state.manager).beforeInput = (message) => {
      const prompt = state.nativePrompt
      if (prompt?.message === message) {
        state.manager.appendCustomEntry("moon-request", prompt.request)
        // Even a pure Skill needs its original user text on live/read projection.
        state.manager.appendCustomEntry("moon-materials", {
          clientRequestId: prompt.request.clientRequestId,
          text: prompt.text,
          materials: prompt.materials,
        })
        return { nativePrompt: prompt }
      }
      return this.queue.beforeInput(state, message)
    }
    this.persistence.get(state.manager).onInput = (_message, input) => {
      if (!input?.nativePrompt) this.queue.afterInput(state, input)
      if (state.nativePrompt && input?.nativePrompt !== state.nativePrompt)
        return
      if (!state.entry.busy) return
      state.inputAccepted = true
      state.acceptedResolve?.()
      this.touch(state)
    }
    state.unsubscribe = session.subscribe((event) => this.event(state, event))
  }
  handledNotice(runId, occurredAt = new Date().toISOString()) {
    return {
      kind: "input-handled",
      message:
        "扩展已处理此次输入，未生成本次用户消息。请查看扩展反馈；不要重复发送。",
      occurredAt,
      runId,
    }
  }
  nativeInputFactory(state) {
    return (pi) => {
      pi.on("before_agent_start", () => {
        const prompt = state.nativePrompt
        if (!prompt?.context || prompt.contextConsumed) return
        prompt.contextConsumed = true
        return {
          message: {
            customType: "moon-input-material-context",
            content: prompt.context,
            display: false,
          },
        }
      })
      pi.on("message_start", (event) => {
        const prompt = state.nativePrompt
        if (prompt?.started && !prompt.message && event.message.role === "user")
          prompt.message = event.message
      })
    }
  }
  toolHistory(branch) {
    return this.conversation_transcript.toolHistory(branch)
  }
  toolExecutionCall(state, event, starting = false) {
    return this.conversation_transcript.toolExecutionCall(
      state,
      event,
      starting
    )
  }
  event(state, event) {
    return this.conversation_events.event(state, event)
  }
  executionEvent(state, event) {
    return this.conversation_events.executionEvent(state, event)
  }
  contextFeedback(state) {
    return this.conversation_transcript.contextFeedback(state)
  }
  cancellations(state, branch, history) {
    return this.conversation_transcript.cancellations(state, branch, history)
  }
  transcript(state) {
    return this.conversation_transcript.transcript(state)
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
      ...(state.inputDisposition
        ? { inputDisposition: state.inputDisposition }
        : {}),
      runId: record.runId || "",
      canContinue: this.canContinue(state),
      phase: state.phase,
      modelId: record.modelId,
      connectionId: slash < 0 ? "" : record.modelId.slice(0, slash),
      providerModelId: slash < 0 ? "" : record.modelId.slice(slash + 1),
      thinking: record.thinking || "off",
      error: state.error || "",
      ...(state.issue ? { issue: state.issue } : {}),
      ...(state.issueEntryId ? { issueEntryId: state.issueEntryId } : {}),
      messages: this.transcript(state),
      permission: state.permission || {
        sessionId: record.id,
        mode: "workspace",
        revision: 0,
      },
      approvals: this.permissions.pendingFor(record.id),
      statistics: conversationStatistics(state),
      ...(state.command ? { command: state.command } : {}),
      ...(state.extensionNotifications?.length
        ? { extensionNotifications: state.extensionNotifications }
        : {}),
      queue: this.queue.snapshot(state),
      ...(state.queueError
        ? {
            queueError: state.queueError,
            queueIssue:
              state.queueIssue ||
              storageIssue(
                new Error(state.queueError),
                "conversationRead",
                state.queueError,
                "queue_storage"
              ),
          }
        : {}),
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
    return this.live.remember(state, snapshot)
  }
  canContinue(state) {
    return this.conversation_transcript.canContinue(state)
  }
  lastStopReason(state) {
    return this.conversation_transcript.lastStopReason(state)
  }
  async prepareMedia(state, signal, retryFailed = false) {
    if (!this.models.materials?.captureImage) return
    state.mediaReferences ||= new WeakMap()
    state.mediaTasks ||= new WeakMap()
    const pending = []
    const entries = state.manager.getBranch()
    const source = entries
      .filter(
        (entry) =>
          entry.type === "message" &&
          ["assistant", "toolResult"].includes(entry.message.role)
      )
      .map((entry) => entry.message)
    if (state.pending) source.push(state.pending)
    for (const message of source) {
      for (const [index, part] of (Array.isArray(message.content)
        ? message.content
        : []
      ).entries()) {
        if (part.type !== "image") continue
        const reference = state.mediaReferences.get(part)
        if (
          reference &&
          !(retryFailed && reference.status === "failed" && reference.retryable)
        )
          continue
        let task = state.mediaTasks.get(part)
        if (!task) {
          task = this.models.materials
            .captureImage(
              state.record.cwd,
              `Pi-${message.role}-${message.timestamp}-${index}`,
              part.mimeType,
              part.data,
              signal
            )
            .then((result) => {
              const previous = state.mediaReferences.get(part)
              state.mediaReferences.set(part, result)
              if (JSON.stringify(previous) !== JSON.stringify(result))
                this.touch(state)
            })
          state.mediaTasks.set(part, task)
          task.finally(() => state.mediaTasks.delete(part)).catch(() => {})
        }
        pending.push(task)
      }
    }
    await Promise.all(pending)
  }
  async read(sessionId, _afterVersion, signal) {
    identity(sessionId)
    return this.sessions.exclusive(sessionId, async () => {
      this.ensureOpen()
      signal?.throwIfAborted()
      const record = await this.store.get(sessionId, signal)
      requireValue(record, "会话不存在。")
      const state = await this.restore(record, undefined, signal)
      await this.prepareMedia(state, signal, _afterVersion === undefined)
      return this.snapshot(state)
    })
  }
  async readReceipt(sessionId, clientRequestId, signal) {
    identity(sessionId)
    identity(clientRequestId)
    return this.sessions.exclusive(sessionId, async () => {
      this.ensureOpen()
      signal?.throwIfAborted()
      const receipt = await this.store.request(
        sessionId,
        clientRequestId,
        signal
      )
      const record = await this.store.get(sessionId, signal)
      const result = (state, issue) => ({
        sessionId,
        clientRequestId,
        state,
        ...(issue ? { issue } : {}),
      })
      let state
      if (record) {
        state = await this.restore(record, undefined, signal)
        if (
          state.queue.items.some(
            (item) => item.clientRequestId === clientRequestId
          )
        )
          return result("accepted")
        // Pi may have appended to its in-memory tree before a failing write.
        // Read disk rather than that uncertain tree when persistence failed.
        const manager = this.persistence.get(state.manager)?.error
          ? await this.fileManager(record)
          : state.manager
        if (acceptedInput(manager, clientRequestId)) return result("accepted")
      }
      if (receipt?.status === "handled") return result("handled")
      if (receipt?.status === "rejected")
        return result("rejected", restoredIssue(receipt.issue))
      const interrupted = {
        code: "request_not_accepted",
        summary:
          "原请求尚未接受，准备过程已中断；原输入保留，可以使用新请求重新发送。",
        recovery: "none",
        severity: "warning",
      }
      // A previous host's preparation cannot later execute. A current-host
      // preparing receipt whose rejection write failed remains unknown.
      if (receipt?.status === "preparing" && receipt.ownerEpoch !== this.epoch)
        return result("rejected", interrupted)
      // A committed start without this input's Pi/queue or terminal-ledger
      // evidence remains uncertain, including a readable older history file.
      return result("unknown")
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
    signal,
    delivery = "followUp"
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
        delivery,
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
  start(input, signal) {
    return this.conversation_run.start(input, signal)
  }
  run(state, input) {
    return this.conversation_run.run(state, input)
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
      } catch (error) {
        state.queue.paused = true
        queueFailure(
          state,
          error,
          "待处理消息状态未能保存，消息保留；正在停止当前执行。"
        )
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
      this.permissions.cancel(state)
      state.runtime = undefined
      state.compactionActive = false
      this.touch(state)
      // abort() waits for Pi settlement; keep the transport request short.
      void state.session.abort().catch((error) => {
        state.issue = {
          ...publicFailure(error, "conversationStop").issue,
          code: "run_stop_failed",
          summary: "暂时无法确认执行已停止，请检查会话状态。",
          recovery: "reload",
        }
        state.error = state.issue.summary
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
    for (const state of states) this.permissions.cancel(state)
    for (const state of states) this.live.close(state)
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
    await this.commands.close()
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
  queueEdit(
    sessionId,
    itemId,
    text,
    revision,
    materials,
    signal,
    clientEditId
  ) {
    return this.queue.edit(
      sessionId,
      itemId,
      text,
      revision,
      materials,
      signal,
      clientEditId
    )
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
  queueReceiptRead(...args) {
    return this.queue.readReceipt(...args)
  }
}
