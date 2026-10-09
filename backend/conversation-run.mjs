// @ts-check

import { randomUUID, createHash } from "node:crypto"

import { SessionManager } from "@earendil-works/pi-coding-agent"

import { conversationStatistics } from "./conversation-statistics.mjs"
import { publicFailure, operationError } from "./operation-issue.mjs"

import {
  requireValue,
  providerId,
  selectionId,
  storageIssue,
  runFailureIssue,
  queueFailure,
  continuation,
  acceptedInput,
} from "./conversation-core.mjs"

/** ConversationRun: 只通过显式端口访问所属状态；Pi 正文仍是唯一权威。 */
export class ConversationRun {
  /** @param {Pick<import("./conversations.mjs").ConversationService, "closed" | "contextFeedback" | "controls" | "ensureOpen" | "epoch" | "fileManager" | "handledNotice" | "lastStopReason" | "models" | "permissions" | "persistence" | "queue" | "queuePending" | "restore" | "selection" | "sessions" | "snapshot" | "store" | "touch" | "transcript" | "workspaces">} ports */
  constructor(ports) {
    this.ports = ports
  }
  /** @param {Omit<import("../src/contracts/rpc.generated.ts").RpcRequests["conversationSend"], "workspaceId"> & {workspaceId?:string, mode:"send"|"retry"|"queue", preparedMaterials?: Awaited<ReturnType<import("./materials.mjs").MaterialService["resolveForPrompt"]>>}} input @param {AbortSignal} [signal] */
  async start(input, signal) {
    const state = await this.ports.sessions.exclusive(
      input.sessionId,
      async () => {
        this.ports.ensureOpen()
        signal?.throwIfAborted()
        let record = await this.ports.store.get(input.sessionId, signal)
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
        let tracked = false
        const begin = async () => {
          if (input.mode === "queue") return
          const { receipt, created } = await this.ports.store.beginRequest(
            input.sessionId,
            input.clientRequestId,
            fingerprint,
            this.ports.epoch,
            signal
          )
          if (!created && receipt.status === "started")
            throw operationError(
              "result_unknown",
              "原请求已进入启动阶段，请先核对原回执；不会重新执行。",
              "check"
            )
          tracked = true
          if (!created)
            throw operationError(
              "request_not_accepted",
              "原请求尚未接受，请保留输入并使用新请求重新发送。",
              "none"
            )
        }
        try {
          if (record) {
            requireValue(
              !input.workspaceId || record.workspaceId === input.workspaceId,
              "已有会话不能更换工作区。"
            )
            const restored = await this.ports.restore(record, undefined, signal)
            const storedReceipt = await this.ports.store.request(
              record.id,
              input.clientRequestId,
              signal
            )
            if (storedReceipt?.status === "handled") {
              requireValue(
                storedReceipt.fingerprint === fingerprint,
                "请求标识已经用于不同内容，请重新发送。"
              )
              return restored
            }
            const queuedReceipt = restored.queue.items.find(
              (item) => item.clientRequestId === input.clientRequestId
            )
            if (queuedReceipt) {
              await this.ports.queue.enqueueReceipt(restored, input)
              return restored
            }
            const accepted = restored.requests.get(input.clientRequestId)
            if (accepted) {
              requireValue(
                accepted.fingerprint === fingerprint,
                "请求标识已经用于不同内容，请重新发送。"
              )
              const manager = this.ports.persistence.get(restored.manager)
                ?.error
                ? await this.ports.fileManager(record)
                : restored.manager
              if (acceptedInput(manager, input.clientRequestId)) return restored
              const receipt = await this.ports.store.request(
                record.id,
                input.clientRequestId,
                signal
              )
              if (
                receipt?.status === "rejected" &&
                receipt.fingerprint === fingerprint &&
                record.lastRequestId === input.clientRequestId &&
                ["failed", "interrupted"].includes(restored.phase)
              )
                return restored
            }
            await begin()
            requireValue(
              !restored.controlBusy,
              "会话控制操作尚未完成，请稍候。"
            )
            requireValue(
              !restored.commandRunning,
              "当前扩展命令结束后才能发送消息。"
            )
            const unresolvedControl =
              this.ports.controls.unresolvedReason(restored)
            requireValue(!unresolvedControl, unresolvedControl)
            if (restored.entry.busy && input.mode === "send") {
              requireValue(
                record.modelId ===
                  selectionId(input.connectionId, input.modelId) &&
                  record.thinking === input.thinking,
                "运行中排队与补充沿用当前模型和思考强度；请等待结束后切换。"
              )
              await this.ports.queue.enqueue(restored, input, signal)
              if (input.delivery === "steer")
                queueMicrotask(() => {
                  void this.ports.queue
                    .boundary(restored, "steer")
                    .catch((error) => {
                      queueFailure(
                        restored,
                        error,
                        "补充消息交付尚未完成，消息保留。"
                      )
                      this.ports.touch(restored)
                    })
                })
              return restored
            }
            requireValue(
              !restored.entry.busy,
              "此会话正在执行，请先停止或等待完成。"
            )
            if (input.mode === "queue")
              requireValue(
                !restored.queue.paused &&
                  restored.queue.items.some(
                    (item) => item.status === "pending"
                  ),
                "队列已暂停或没有可发送内容。"
              )
            if (input.mode === "retry") {
              requireValue(
                ["failed", "interrupted"].includes(restored.phase) ||
                  (restored.phase === "completed" &&
                    this.ports.lastStopReason(restored) === "length"),
                "只有失败、中断或输出达到上限的回复可以继续。"
              )
              requireValue(
                restored.inputAccepted &&
                  this.ports
                    .transcript(restored)
                    .some((message) => message.role === "user"),
                "上一请求尚未写入对话，请在输入框重新发送。"
              )
            }
          } else {
            requireValue(input.mode === "send", "会话不存在。")
            await begin()
          }
          const workspace = await this.ports.workspaces.get(
            record?.workspaceId || input.workspaceId,
            signal
          )
          requireValue(workspace, "工作区已移除，请重新添加目录。")
          const cwd = await this.ports.sessions.cwd(
            workspace.path || workspace.cwd
          )
          requireValue(
            !record || record.cwd === cwd,
            "工作区路径已改变，请新建会话。"
          )
          const selected = await this.ports.selection(
            input.connectionId,
            input.modelId,
            input.thinking,
            signal
          )
          input.preparedMaterials =
            input.materials?.length ||
            (input.mode !== "send" && input.text.startsWith("/skill:"))
              ? await this.ports.models.materials.resolveForPrompt({
                  sessionId: input.sessionId,
                  cwd,
                  materials: input.materials ?? [],
                  text: input.text,
                  model: selected.model,
                  nativeSkills: input.mode === "send",
                  signal,
                })
              : { textPrefix: "", images: [], displayMaterials: [] }
          let config = await this.ports.sessions.readExclusive(
            input.sessionId,
            signal
          )
          if (this.ports.sessions.refreshForRunExclusive)
            await this.ports.sessions.refreshForRunExclusive(
              input.sessionId,
              signal
            )
          if (!config) {
            const catalog = await this.ports.sessions.catalog(cwd, signal)
            config = await this.ports.sessions.applyExclusive(
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
            record = await this.ports.store.create(
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
          const state = await this.ports.restore(record, selected, signal)
          const provider = providerId(selected.connection)
          const registered =
            selected.runtime.getRegisteredProviderConfig(provider)
          if (registered)
            state.session.modelRuntime.registerProvider(provider, registered)
          const model = state.session.modelRuntime.getModel(
            provider,
            input.modelId
          )
          requireValue(model, "Pi 未找到所选模型。")
          await state.session.setModel(model)
          state.session.setThinkingLevel(input.thinking)
          requireValue(
            state.session.thinkingLevel === input.thinking,
            "Pi 无法应用所选思考等级。"
          )
          signal?.throwIfAborted()
          this.ports.ensureOpen()
          const runId = randomUUID()
          state.permission = await this.ports.permissions.read(
            input.sessionId,
            signal
          )
          // Atomic index commit authorizes the run, but does not yet prove Pi input
          // acceptance. After this boundary, caller cancellation cannot stop work;
          // Stop identifies the committed run while receipt reads inspect Pi input.
          state.record = await this.ports.store.update(
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
            signal,
            input.mode === "queue"
              ? undefined
              : {
                  clientRequestId: input.clientRequestId,
                  fingerprint,
                }
          )
          const request = {
            clientRequestId: input.clientRequestId,
            fingerprint,
            runId,
          }
          state.requests.set(input.clientRequestId, request)
          state.inputAccepted = false
          state.inputDisposition = undefined
          state.issue = undefined
          state.issueEntryId = undefined
          if (this.ports.closed) {
            state.record = await this.ports.store.update(
              record.id,
              {
                status: "idle",
                lastError: "应用关闭前请求尚未开始，请重新发送。",
              },
              undefined,
              input.mode === "queue"
                ? undefined
                : {
                    clientRequestId: input.clientRequestId,
                    fingerprint,
                    runId,
                    outcome: "rejected",
                    issue: {
                      code: "request_not_accepted",
                      summary: "应用关闭前原请求尚未接受，输入已保留。",
                      recovery: "none",
                      severity: "info",
                    },
                  }
            )
            state.phase = "interrupted"
            state.error = state.record.lastError
            state.issue = {
              code: "run_not_started",
              summary: state.error,
              recovery: "retry",
              severity: "info",
            }
            return state
          }
          state.phase = "running"
          state.command = undefined
          state.runMetrics = {
            startedAt: performance.now(),
            modelDurationMs: 0,
            outputTokens: 0,
            hasUsage: false,
          }
          state.error = ""
          state.issue = undefined
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
          this.ports.touch(state)
          state.accepted = new Promise((resolve) => {
            state.acceptedResolve = resolve
          })
          state.run = this.run(state, input)
          return state
        } catch (error) {
          if (tracked) {
            try {
              await this.ports.store.rejectRequest(
                input.sessionId,
                input.clientRequestId,
                fingerprint,
                publicFailure(error, "conversationSend").issue
              )
            } catch (storageError) {
              throw operationError(
                "result_unknown",
                "请求尚未确认：准备结果未能保存，请先核对原回执，输入副本保留。",
                "check",
                publicFailure(storageError, "conversationReceiptRead").issue
                  .details
              )
            }
          }
          throw error
        }
      }
    )
    // Wait for Pi's public input-append boundary, not generation/tool completion.
    // Installed Pi 1.0.0 flushes the first user entry before append returns.
    // A startup commit alone is earlier; a missing file still cannot distinguish
    // a crash before input append from loss of previously accepted history.
    if (
      state.queue.items.some(
        (item) => item.clientRequestId === input.clientRequestId
      )
    )
      return this.ports.snapshot(state)
    await state.accepted
    return this.ports.snapshot(state)
  }
  async run(state, input) {
    let failure
    let failureEntryId
    const manager = state.manager
    const before = [manager.getHeader(), ...manager.getEntries()]
    const beforeEntryIds = new Set(before.map((entry) => entry.id))
    const nativePrompt =
      input.mode === "send"
        ? {
            request: state.requests.get(input.clientRequestId),
            text: input.text,
            materials: input.preparedMaterials?.displayMaterials ?? [],
            context: input.preparedMaterials?.textPrefix ?? "",
            contextConsumed: false,
            started: false,
            handled: false,
            message: undefined,
          }
        : undefined
    state.nativePrompt = nativePrompt
    try {
      if (!nativePrompt) {
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
      }
      if (input.mode === "queue") await this.ports.queue.seed(state)
      else if (input.mode === "retry")
        await state.session.sendCustomMessage(
          {
            customType: "moon-continuation",
            content: continuation,
            display: true,
          },
          { triggerTurn: true }
        )
      else {
        if (state.stopRequested || this.ports.closed)
          throw new Error("请求已停止。")
        await state.session.prompt(input.text || "请处理所附材料。", {
          images: input.preparedMaterials?.images ?? [],
          preflightResult: (disposition) => {
            if (disposition === "handled") {
              nativePrompt.handled = true
              return
            }
            if (state.stopRequested || this.ports.closed)
              throw new Error("请求已停止。")
            if (disposition === "started") nativePrompt.started = true
          },
        })
      }
      const lastEntry = [...state.manager.getBranch()]
        .reverse()
        .find(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "assistant" &&
            !beforeEntryIds.has(entry.id)
        )
      const last = lastEntry?.message
      if (last?.stopReason === "error") {
        failure =
          this.ports.persistence
            .get(state.manager)
            ?.assistantIssues.get(lastEntry.id) ||
          runFailureIssue(last.errorMessage || "模型请求失败。")
        failureEntryId = lastEntry.id
      }
      if (last?.stopReason === "aborted") state.stopRequested = true
    } catch (error) {
      failure = runFailureIssue(error)
    } finally {
      // Keep only the terminal disposition locally. Never carry original text,
      // user-object binding or path context into another input/queued turn.
      state.nativePrompt = undefined
      await this.ports.sessions.exclusive(state.record.id, async () => {
        const writeError = this.ports.persistence.get(manager)?.error
        if (writeError) {
          state.maintenanceSaveError = true
          failure = storageIssue(
            writeError,
            "conversationRead",
            `会话历史未能保存。${publicFailure(writeError, "conversationRead").issue.summary}`
          )
          failureEntryId = undefined
          state.unsubscribe?.()
          state.session?.dispose()
          state.session = undefined
          this.ports.sessions.active.delete(state.record.id)
          state.toolProgress.clear()
          try {
            state.manager = await this.ports.fileManager(state.record)
            try {
              await this.ports.queue.reconcile(state)
            } catch (error) {
              queueFailure(
                state,
                error,
                "历史已读取，但待处理消息状态未能保存。请检查文件占用后重新读取。"
              )
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
            failure = {
              ...failure,
              code: "history_unreadable",
              summary: `${failure.summary} 当前历史无法读取，原文件保留。`,
            }
          }
        }
        state.pending = undefined
        if (state.runMetrics)
          state.runMetrics.durationMs =
            performance.now() - state.runMetrics.startedAt
        state.runtime = undefined
        state.compactionActive = false
        state.phase = state.stopRequested
          ? "interrupted"
          : failure
            ? "failed"
            : "completed"
        state.issue = failure
        state.issueEntryId = failure ? failureEntryId : undefined
        state.error = failure?.summary || ""
        for (const progress of state.toolProgress.values())
          if (progress.status === "running")
            progress.status = state.stopRequested ? "stopped" : "failed"
        const messages = this.ports.transcript(state)
        const lastMessage =
          [...messages].reverse().find((message) => message.text)?.text || ""
        try {
          if (!writeError) {
            state.recoveredContext = this.ports.contextFeedback(state)
            state.manager.appendCustomEntry("moon-context-usage", {
              modelId: state.record.modelId,
              feedback: state.recoveredContext,
            })
            state.manager.appendCustomEntry("moon-run-result", {
              runId: state.record.runId,
              phase: state.phase,
              statistics: conversationStatistics(state),
              error: state.error,
              ...(state.issue ? { issue: state.issue } : {}),
              ...(state.issue && failureEntryId
                ? { issueEntryId: failureEntryId }
                : {}),
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
          state.record = await this.ports.store.update(
            state.record.id,
            {
              status: state.phase === "interrupted" ? "idle" : state.phase,
              unread: true,
              lastError: state.error,
              lastMessage: lastMessage.slice(0, 2000),
              sessionFile: writeError
                ? state.record.sessionFile
                : state.manager.getSessionFile() || "",
            },
            undefined,
            nativePrompt?.handled
              ? {
                  clientRequestId: input.clientRequestId,
                  fingerprint: nativePrompt.request.fingerprint,
                  runId: state.record.runId,
                  outcome: "handled",
                }
              : input.mode !== "queue" &&
                  !nativePrompt?.started &&
                  !state.inputAccepted &&
                  !writeError &&
                  !acceptedInput(manager, input.clientRequestId)
                ? {
                    clientRequestId: input.clientRequestId,
                    fingerprint: state.requests.get(input.clientRequestId)
                      ?.fingerprint,
                    runId: state.record.runId,
                    outcome: "rejected",
                    issue: state.issue ?? {
                      code: "request_not_accepted",
                      summary: "原请求尚未接受，输入已保留。",
                      recovery: "none",
                      severity: "info",
                    },
                  }
                : undefined
          )
          if (nativePrompt?.handled) {
            state.inputDisposition = "handled"
            state.notice = this.ports.handledNotice(
              state.record.runId,
              state.record.updatedAt
            )
          }
        } catch (error) {
          state.phase = "failed"
          state.maintenanceSaveError = true
          state.issue = nativePrompt?.handled
            ? {
                ...publicFailure(error, "conversationReceiptRead").issue,
                code: "result_unknown",
                summary:
                  "扩展输入的处理回执未能保存，请核对原回执；不要重复发送。",
                recovery: "check",
              }
            : storageIssue(
                error,
                "conversationRead",
                `回复已结束，但会话记录未能保存。${publicFailure(error, "conversationRead").issue.summary}`
              )
          state.error = state.issue.summary
        }
        state.entry.busy = false
        if (state.phase !== "completed") {
          try {
            await this.ports.queue.pause(state)
          } catch (error) {
            state.queue.paused = true
            queueFailure(
              state,
              error,
              "执行已停止，但待处理消息状态未能保存。消息保留，请检查文件占用后重新读取。"
            )
          }
        } else if (
          this.ports.queuePending(state) &&
          !state.queue.paused &&
          !this.ports.closed
        )
          queueMicrotask(() => {
            void this.ports.queue.resume(state).catch((error) => {
              state.queue.paused = true
              state.queueIssue = {
                ...publicFailure(error, "conversationRead").issue,
                code: "queue_resume_failed",
                summary: "待处理消息暂时无法发送，请重新读取后继续。",
                recovery: "reload",
              }
              state.queueError = state.queueIssue.summary
              this.ports.touch(state)
            })
          })
        state.acceptedResolve?.()
        this.ports.touch(state)
      })
    }
  }
}
