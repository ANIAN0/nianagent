// @ts-check

import { nestedMcpTools, mcpResultsIndex } from "./mcp.mjs"

import {
  projectedResult,
  projectedDetails,
  toolTarget,
  fileArtifact,
} from "./conversation-projection.mjs"
import {
  textOf,
  restoredIssue,
  runFailureIssue,
  shellResult,
  toolOccurrenceKey,
  savedShellResult,
} from "./conversation-core.mjs"

/** ConversationTranscript: 只通过显式端口访问所属状态；Pi 正文仍是唯一权威。 */
export class ConversationTranscript {
  /** @param {Pick<import("./conversations.mjs").ConversationService, "historyNotice" | "models" | "persistence">} ports */
  constructor(ports) {
    this.ports = ports
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
    const issuesByEntry = new Map(
      this.ports.persistence.get(state.manager)?.assistantIssues || []
    )
    const stableEntryIds =
      this.ports.persistence.get(state.manager)?.stableEntryIds !== false
    let sourceRunId
    branch.forEach((entry, historyIndex) => {
      if (entry.type === "custom" && entry.customType === "moon-request")
        sourceRunId = entry.data?.runId
      if (entry.type === "message")
        entriesByMessage.set(entry.message, {
          ...(stableEntryIds ? { entryId: entry.id } : {}),
          historyIndex,
          ...(sourceRunId ? { runId: sourceRunId } : {}),
        })
    })
    for (const entry of branch) {
      if (
        entry.type !== "custom" ||
        entry.customType !== "moon-run-result" ||
        typeof entry.data?.issueEntryId !== "string"
      )
        continue
      const issue = restoredIssue(entry.data.issue)
      if (issue) issuesByEntry.set(entry.data.issueEntryId, issue)
    }
    sourceRunId = undefined
    for (const [historyIndex, entry] of branch.entries()) {
      if (entry.type === "custom" && entry.customType === "moon-request") {
        nextMaterials = undefined
        sourceRunId = entry.data?.runId
      } else if (
        entry.type === "custom" &&
        entry.customType === "moon-materials"
      )
        nextMaterials = entry.data
      else if (entry.type === "message") {
        if (entry.message.role === "user" && nextMaterials) {
          materialInputs.set(entry.message, nextMaterials)
          nextMaterials = undefined
        }
        source.push(entry.message)
      } else if (entry.type === "custom_message" && entry.display) {
        const message = {
          role: "user",
          content: entry.content,
          timestamp: Date.parse(entry.timestamp),
        }
        entriesByMessage.set(message, {
          ...(stableEntryIds ? { entryId: entry.id } : {}),
          historyIndex,
          ...(sourceRunId ? { runId: sourceRunId } : {}),
          ...(entry.customType === "moon-continuation"
            ? { inputKind: "continuation" }
            : {}),
        })
        source.push(message)
      }
    }
    if (state.pending) {
      entriesByMessage.set(state.pending, {
        historyIndex: branch.length,
        ...(state.record.runId ? { runId: state.record.runId } : {}),
      })
      source.push(state.pending)
    }
    const seen = new Map()
    let userTurnId
    for (const message of source) {
      if (!["user", "assistant"].includes(message.role)) continue
      const base = `${message.role}-${message.timestamp}`
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      const id = `${base}-${count}`
      const previousUserTurnId = userTurnId
      if (message.role === "user") userTurnId = id
      const live = message === state.pending
      const item = {
        id,
        ...entriesByMessage.get(message),
        ...(userTurnId ? { userTurnId } : {}),
        ...(entriesByMessage.get(message)?.inputKind === "continuation" &&
        previousUserTurnId
          ? { continuationOf: previousUserTurnId }
          : {}),
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
        if (
          !live &&
          ["stop", "length", "toolUse", "error", "aborted"].includes(
            message.stopReason
          )
        )
          item.stopReason = message.stopReason
        if (live && Number.isInteger(state.pendingContentIndex))
          item.activeBlockId = `${id}-${state.pendingContentIndex}`
        item.forkable =
          !!item.entryId &&
          !this.ports.historyNotice(state.manager) &&
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
          const blockId = `${id}-${index}`
          const phase = item.activeBlockId === blockId ? "running" : "settled"
          if (part.type === "text")
            blocks.push({ id: blockId, type: "text", text: part.text, phase })
          if (part.type === "thinking")
            blocks.push({
              id: blockId,
              type: "thinking",
              text: part.thinking,
              phase,
            })
          if (part.type === "image" && state.mediaReferences?.has(part))
            blocks.push({
              id: blockId,
              type: "image",
              image: state.mediaReferences.get(part),
            })
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
            const finalProgress = progress?.resultAvailability === "available"
            const shellEnded = Object.keys(metadata).length > 0
            const status = result
              ? result.isError &&
                cancellation.stoppedCalls.has(part) &&
                metadata.exitCode === undefined
                ? "stopped"
                : result.isError ||
                    (metadata.exitCode !== undefined && metadata.exitCode !== 0)
                  ? "failed"
                  : "success"
              : finalProgress
                ? progress.status
                : shellEnded
                  ? metadata.exitCode !== undefined && metadata.exitCode !== 0
                    ? "failed"
                    : "returned"
                  : progress?.status ||
                    (cancellation.stoppedCalls.has(part)
                      ? "stopped"
                      : "unknown")
            // A missing ToolResultMessage can coexist with a durable shell-end
            // marker. Keep that end/exit fact without inventing output or a
            // successful outcome. Old stopReason or absent events do not prove
            // that a tool was never dispatched.
            const resultAvailability = result
              ? "available"
              : finalProgress
                ? "available"
                : progress?.resultAvailability || "missing"
            const target = toolTarget(part, state.record.cwd)
            const details = projectedDetails(result)
            const artifact = fileArtifact(part, target, status)
            const presentation = this.ports.models.extensions?.presentation(
              result,
              part.name
            )
            const images = (
              Array.isArray(result?.content) ? result.content : []
            )
              .filter(
                (content) =>
                  content.type === "image" &&
                  state.mediaReferences?.has(content)
              )
              .map((content) => state.mediaReferences.get(content))
            const tool = {
              id: part.id,
              name: part.name,
              source:
                this.ports.models.mcp?.toolSource(part.name) ||
                this.ports.models.extensions?.toolSource(part.name, result) ||
                "Pi",
              status,
              resultAvailability,
              input: JSON.stringify(part.arguments, null, 2) || "{}",
              ...(result
                ? projectedResult(result)
                : { result: progress?.result || "" }),
              occurrenceId:
                stableEntryIds && call?.key
                  ? call.key
                  : toolOccurrenceKey(id, index),
              ...(target ? { target } : {}),
              ...(details ? { details } : {}),
              ...(artifact ? { artifact } : {}),
              ...(presentation ? { presentation } : {}),
              ...(images.length ? { images } : {}),
              ...metadata,
            }
            tools.push(tool)
            blocks.push({ id: `${id}-${index}`, type: "tool", tool })
            for (const nested of nestedMcpTools(
              result,
              nestedResults,
              call,
              (name) => this.ports.models.mcp?.toolSource(name)
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
        if (item.status === "failed")
          item.issue =
            issuesByEntry.get(item.entryId) ||
            runFailureIssue(message.errorMessage || "模型请求失败。")
      }
      messages.push(item)
    }
    return messages
  }
  canContinue(state) {
    if (!state.inputAccepted || state.entry.busy) return false
    if (["failed", "interrupted"].includes(state.phase)) return true
    return (
      state.phase === "completed" && this.lastStopReason(state) === "length"
    )
  }
  lastStopReason(state) {
    return [...state.manager.getBranch()]
      .reverse()
      .find(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant"
      )?.message.stopReason
  }
}
