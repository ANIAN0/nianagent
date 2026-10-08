// @ts-check

import { runStatisticsEvent } from "./conversation-statistics.mjs"

import {
  textOf,
  excerpt,
  errorText,
  shellResult,
  compactionReason,
  compactionErrorText,
} from "./conversation-core.mjs"

/** ConversationEvents: 只通过显式端口访问所属状态；Pi 正文仍是唯一权威。 */
export class ConversationEvents {
  /** @param {Pick<import("./conversations.mjs").ConversationService, "queue" | "toolExecutionCall" | "touch">} ports */
  constructor(ports) {
    this.ports = ports
  }
  event(state, event) {
    runStatisticsEvent(state, event)
    if (event.type === "message_start" && event.message.role === "user")
      this.ports.queue.inputStarted(state, event.message)
    if (
      ["message_start", "message_update"].includes(event.type) &&
      event.message?.role === "assistant"
    ) {
      state.pending = event.message
      const update = event.assistantMessageEvent
      if (event.type === "message_start") state.pendingContentIndex = undefined
      if (Number.isInteger(update?.contentIndex)) {
        if (update.type.endsWith("_end")) {
          if (state.pendingContentIndex === update.contentIndex)
            state.pendingContentIndex = undefined
        } else state.pendingContentIndex = update.contentIndex
      }
    }
    if (event.type === "message_end") {
      if (event.message.role === "assistant") {
        state.pending = undefined
        state.pendingContentIndex = undefined
      }
      // message_end precedes persistence. Only the successful append adapter
      // may acknowledge input; a microtask runs even if the disk write failed.
      queueMicrotask(() => this.ports.touch(state))
    }
    if (event.type === "tool_execution_start") {
      const call = this.ports.toolExecutionCall(state, event, true)
      if (call)
        state.toolProgress.set(call.key, {
          ...call,
          status: "running",
          result: "",
          resultAvailability: "missing",
        })
    }
    if (event.type === "tool_execution_update") {
      const call = this.ports.toolExecutionCall(state, event)
      if (call)
        state.toolProgress.set(call.key, {
          ...call,
          status: "running",
          result: excerpt(textOf(event.partialResult?.content)),
          resultAvailability: event.partialResult ? "partial" : "missing",
        })
    }
    if (event.type === "tool_execution_end") {
      const call = this.ports.toolExecutionCall(state, event)
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
          resultAvailability: event.result ? "available" : "missing",
          ...metadata,
        })
    }
    this.executionEvent(state, event)
    this.ports.touch(state)
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
}
