import type { ConversationService } from "@/features/conversation/conversation-service"
import type { ConversationControlService } from "@/features/conversation/controls/conversation-control-service"
import type { createCommandService } from "@/features/conversation/controls/command-service"
import type { PermissionService } from "@/features/conversation/permissions/permission-service"
import type { SessionService } from "@/features/session/session-service"
import type { MaterialService } from "@/features/materials/material-service"
import { RpcRequestRejected, RpcTransportError } from "@/lib/rpc/client"
import type {
  ConversationSnapshot,
  ConversationApproval,
  ConversationChatMessage,
  OperationIssue,
  ConversationRequestReceipt,
  ConversationQueueOperationReceipt,
  ConversationControlOperation,
  ConversationCompaction,
  MaterialReference,
  RpcRequests,
  SessionConfiguration,
  SessionCatalog,
} from "@/contracts/rpc.generated"
import type { ComposerDraft } from "@/lib/composer/types"
import { createExtensionFixtureService } from "./extensions"

export type IdleInputScenario =
  | "idle-submit"
  | "compact-command"
  | "submission-rejected"
  | "submission-unknown"
  | "model-unavailable"
  | "long-materials"
  | "auxiliary-visibility"
  | "running-normal"
  | "running-rejected"
  | "running-unknown"
  | "running-paused"
  | "approval-tool"
  | "approval-rejected"
  | "approval-unknown"
  | "approval-extension"
  | "context-usage"

export type ContextReadingScenario =
  "current" | "history" | "zero" | "overflow" | "awaiting" | "unavailable"
const contextReading = (
  kind: ContextReadingScenario
): Pick<ConversationSnapshot, "context" | "contextState"> => {
  const observedAt = kind === "history" ? stamp : new Date().toISOString()
  if (kind === "awaiting" || kind === "unavailable")
    return {
      context: undefined,
      contextState: {
        status: kind === "awaiting" ? "awaiting-response" : "unavailable",
        contextWindow: kind === "awaiting" ? 64000 : undefined,
        observedAt,
        reason:
          kind === "awaiting"
            ? "当前上下文读数待下一次模型回复更新。"
            : "当前没有已记录的上下文用量。",
      },
    }
  return {
    context: {
      usedTokens:
        kind === "zero"
          ? 0
          : kind === "history"
            ? 450
            : kind === "overflow"
              ? 68000
              : 28800,
      contextWindow: 64000,
      source: "pi-context-estimate",
      estimated: true,
      observedAt,
      restored: kind === "history",
    },
    contextState: undefined,
  }
}

type SendInput = RpcRequests["conversationSend"]
type RetryInput = RpcRequests["conversationRetry"]
type PendingSend = {
  input: SendInput | RetryInput
  kind: "send" | "retry"
  resolve: (snapshot: ConversationSnapshot) => void
  reject: (error: unknown) => void
  cleanup: () => void
}
const stamp = "2026-10-07T08:00:00.000Z"
const nextHistoryIndex = (snapshot: ConversationSnapshot) =>
  Math.max(
    -1,
    ...snapshot.messages.map((message, index) => message.historyIndex ?? index),
    ...(snapshot.compactions ?? []).map((record) => record.historyIndex)
  ) + 1
export type TerminalFailureKind = "reply" | "long" | "settings" | "reload"
const replyIssue = (kind: TerminalFailureKind = "reply"): OperationIssue => ({
  code:
    kind === "settings"
      ? "model_unavailable"
      : kind === "reload"
        ? "session_save_failed"
        : "model_request_failed",
  summary:
    kind === "settings"
      ? "所选模型已从示例目录移除，请恢复模型目录后继续。"
      : kind === "reload"
        ? "回复已生成，但会话记录尚未保存完成，请重新读取记录。"
        : kind === "long"
          ? "模型连接在整理项目说明时中断，最后一段回复尚未生成。已经产生的回复仍保留；请检查连接后继续回复，或在输入框提出下一项需求。下一稿和材料仍可编辑，继续回复不会发送下一稿。"
          : "模型连接在生成最后一段回复时中断，请稍后继续。",
  recovery:
    kind === "settings" ? "settings" : kind === "reload" ? "reload" : "retry",
  severity: kind === "reload" ? "warning" : "error",
  details:
    kind === "long"
      ? Array.from(
          { length: 48 },
          (_, index) =>
            `诊断 ${index + 1}：隔离连接中断；保留原轮次和未发送的下一稿。request_scope=conversation/terminal-feedback/${"segment/".repeat(12)}${index + 1}`
        ).join("\n")
      : "隔离演示数据：没有运行真实模型或执行命令。",
})
const lostResponse = () =>
  new RpcTransportError({
    code: "result_unknown",
    summary: "未收到原操作的回应，原内容和下一稿已保留，请核对原请求。",
    recovery: "check",
    severity: "warning",
  })

/** In-memory service ports only. Admission, recovery and draft ownership remain formal. */
export function createIdleInputEnvironment(scenario: IdleInputScenario) {
  const approvalScenario = scenario.startsWith("approval-")
  const runningScenario = scenario.startsWith("running-") || approvalScenario
  const compactCommandScenario =
    scenario === "idle-submit" || scenario === "compact-command"
  const compactEnabled =
    compactCommandScenario ||
    scenario === "auxiliary-visibility" ||
    scenario === "context-usage"
  const initialModel = scenario === "running-paused" ? "vision" : "demo"
  const id = `catalog-idle-${crypto.randomUUID()}`
  const otherId = `${id}-other`
  const ids = [id, otherId]
  const cwd = "/catalog/conversation-idle"
  const workspaceId = `${id}-workspace`
  let disposed = false
  let attempts = 0
  let materialSequence = 16
  let approvalSequence = 0
  let approvalAttempts = 0
  const approvalReplies = new Map<
    string,
    {
      request: ConversationApproval
      answer: string
      resolve: () => void
      reject: (error: unknown) => void
    }
  >()
  const approvalTools = new Map<string, ConversationApproval>()
  let approvalAnswer: string | undefined
  const listeners = new Set<() => void>()
  const pending = new Map<string, PendingSend>()
  const missingModels = new Set<string>()
  const savedRecords = new Map<string, ConversationSnapshot>()
  const reloadRecords = new Set<string>()
  const stops = new Map<
    string,
    {
      runId: string
      resolve: (snapshot: ConversationSnapshot) => void
      reject: (error: unknown) => void
    }
  >()
  const unknownInputs = new Map<
    string,
    { input: SendInput; confirmable: boolean }
  >()
  const receipts = new Map<string, ConversationRequestReceipt>()
  const queueReceipts = new Map<string, ConversationQueueOperationReceipt>()
  const queueInputs = new Map<string, RpcRequests["conversationQueueMode"]>()
  const compactOperations = new Map<string, ConversationControlOperation>()
  let failNextMode = false
  const waiters = new Set<{
    sessionId: string
    version: number
    resolve: (value: ConversationSnapshot) => void
    reject: (error: unknown) => void
    cleanup: () => void
  }>()
  const snapshots = new Map<string, ConversationSnapshot>(
    ids.map((sessionId, index) => [
      sessionId,
      {
        id: sessionId,
        title: index
          ? "另一个讨论"
          : approvalScenario
            ? "确认 Agent 操作"
            : runningScenario
              ? "运行中继续提出需求"
              : scenario === "context-usage"
                ? "查看上下文用量"
                : "继续完善项目说明",
        workspaceId,
        cwd,
        version: 1,
        epoch: `${id}-epoch`,
        clientRequestId: `${sessionId}-previous`,
        inputAccepted: true,
        runId: `${sessionId}-previous-run`,
        phase: runningScenario && index === 0 ? "running" : "completed",
        modelId: `idle/${initialModel}`,
        connectionId: "idle",
        providerModelId: initialModel,
        thinking: "off",
        error: "",
        permission: { sessionId, mode: "workspace", revision: 0 },
        control: {
          busy: false,
          compactDisabledReason: compactEnabled
            ? ""
            : "此场景不演示上下文压缩，请打开“提交 /compact 并查看结果”。",
          forkDisabledReason: "此输入示例不创建真实会话分支。",
        },
        queue: {
          revision: 0,
          mode: "single",
          paused: !(runningScenario && index === 0),
          items: [],
          acceptedRequestIds: [],
        },
        contextState: {
          status: "unavailable",
          reason: "尚无对应上下文读数。",
          observedAt: stamp,
        },
        ...(scenario === "compact-command" ? contextReading("current") : {}),
        ...(scenario === "context-usage" && index === 0
          ? {
              ...contextReading("current"),
              statistics: {
                input: 74200,
                output: 12000,
                cacheRead: 192000,
                cacheWrite: 0,
                totalTokens: 278200,
                toolCalls: 14,
                turns: 3,
                steps: 18,
                durationMs: 54300,
                modelDurationMs: 18900,
                outputTokens: 512,
                tokensPerSecond: 27.1,
              },
            }
          : {}),
        messages: [
          {
            id: `${sessionId}-user-0`,
            entryId: `${sessionId}-user-0`,
            role: "user",
            text: index ? "整理文档目录。" : "先检查项目说明的阅读顺序。",
            time: stamp,
            status: "settled",
            historyIndex: 0,
          },
          {
            id: `${sessionId}-answer-0`,
            entryId: `${sessionId}-answer-0`,
            role: "assistant",
            text: index
              ? "可以先从目录结构继续。"
              : "项目说明按用途、启动方式和目录职责展开。接下来可以补充需要说明的内容。",
            time: stamp,
            status: runningScenario && index === 0 ? "streaming" : "settled",
            historyIndex: 1,
            userTurnId: `${sessionId}-user-0`,
            runId: `${sessionId}-previous-run`,
            stopReason: runningScenario && index === 0 ? undefined : "stop",
            ...(runningScenario && index === 0
              ? {
                  activeBlockId: `${sessionId}-answer-0-text`,
                  blocks: [
                    {
                      id: `${sessionId}-answer-0-text`,
                      type: "text" as const,
                      text: "正在检查项目说明的阅读顺序。",
                      phase: "running" as const,
                    },
                  ],
                  text: "正在检查项目说明的阅读顺序。",
                }
              : {}),
          },
        ],
      },
    ])
  )
  let driver = {
    pending: 0,
    unknown: 0,
    confirmable: false,
    modeUnknown: false,
    running: false,
    compactActive: false,
    missingModels: [] as string[],
    pendingKind: undefined as "send" | "retry" | undefined,
    approvalPendingSession: undefined as string | undefined,
    approvalToolSession: undefined as string | undefined,
    approvalAnswer: undefined as string | undefined,
  }
  const rejectExecution = async (): Promise<never> => {
    throw new RpcRequestRejected("隔离输入示例不执行此操作，当前内容已保留。", {
      code: "catalog_execution_disabled",
      summary: "隔离输入示例不执行此操作，当前内容已保留。",
      recovery: "none",
      severity: "warning",
    })
  }
  const owned = (sessionId: string) => {
    if (disposed || !snapshots.has(sessionId))
      throw new Error("此隔离会话已关闭或不存在。")
    return snapshots.get(sessionId)!
  }
  const notify = () => {
    driver = {
      pending: pending.size,
      unknown: unknownInputs.size,
      confirmable: [...unknownInputs.values()].some(
        (value) => value.confirmable
      ),
      modeUnknown: [...queueReceipts.values()].some(
        (value) => value.state === "unknown"
      ),
      running: [...snapshots.values()].some(
        (value) => value.phase === "running"
      ),
      compactActive: [...compactOperations.values()].some((value) =>
        ["running", "cancelling", "unknown"].includes(value.status)
      ),
      missingModels: [...missingModels],
      pendingKind: pending.values().next().value?.kind,
      approvalPendingSession: approvalReplies.keys().next().value,
      approvalToolSession: approvalTools.keys().next().value,
      approvalAnswer,
    }
    listeners.forEach((listener) => listener())
  }
  const publish = (snapshot: ConversationSnapshot) => {
    if (disposed) return
    snapshots.set(snapshot.id, { ...snapshot, version: snapshot.version + 1 })
    for (const waiter of [...waiters]) {
      if (waiter.sessionId !== snapshot.id) continue
      waiters.delete(waiter)
      waiter.cleanup()
      waiter.resolve(structuredClone(owned(snapshot.id)))
    }
    notify()
  }
  const read = (
    sessionId: string,
    signal?: AbortSignal,
    previous?: ConversationSnapshot
  ): Promise<ConversationSnapshot> => {
    signal?.throwIfAborted()
    if (reloadRecords.delete(sessionId)) {
      const saved = savedRecords.get(sessionId)
      if (saved) {
        savedRecords.delete(sessionId)
        publish({ ...saved, version: owned(sessionId).version })
      }
    }
    const snapshot = owned(sessionId)
    if (
      !previous ||
      previous.epoch !== snapshot.epoch ||
      previous.version !== snapshot.version
    )
      return Promise.resolve(structuredClone(snapshot))
    return new Promise((resolve, reject) => {
      const abort = () => {
        waiters.delete(waiter)
        waiter.cleanup()
        reject(signal?.reason ?? new DOMException("已取消", "AbortError"))
      }
      const waiter = {
        sessionId,
        version: snapshot.version,
        resolve,
        reject,
        cleanup: () => {
          if (heartbeat !== undefined) clearTimeout(heartbeat)
          signal?.removeEventListener("abort", abort)
        },
      }
      waiters.add(waiter)
      signal?.addEventListener("abort", abort, { once: true })
      // A quiet follow still completes as a heartbeat; a manual reload must
      // settle even when the original receipt remains unknown.
      const heartbeat = setTimeout(() => {
        waiters.delete(waiter)
        waiter.cleanup()
        resolve(structuredClone(owned(sessionId)))
      }, 1200)
    })
  }
  const acceptInput = (
    input: SendInput | RetryInput,
    kind: "send" | "retry" = "send"
  ) => {
    const snapshot = owned(input.sessionId)
    if (receipts.get(input.clientRequestId)?.state === "accepted")
      return structuredClone(snapshot)
    const userId = `${input.sessionId}-user-${snapshot.messages.length}`
    const previousUser = snapshot.messages.findLast(
      (message) => message.role === "user"
    )
    const runId = `${input.clientRequestId}-run`
    receipts.set(input.clientRequestId, {
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId,
      state: "accepted",
    })
    unknownInputs.delete(input.clientRequestId)
    if (kind === "send" && snapshot.phase === "running") {
      const request = input as SendInput
      const queue = snapshot.queue!
      publish({
        ...snapshot,
        queue: {
          ...queue,
          paused: false,
          revision: queue.revision + 1,
          acceptedRequestIds: [
            ...queue.acceptedRequestIds,
            request.clientRequestId,
          ],
          items: [
            ...queue.items,
            {
              id: request.clientRequestId,
              clientRequestId: request.clientRequestId,
              text: request.text,
              materials: request.materials ?? [],
              delivery: request.delivery ?? "followUp",
              status: "pending",
              error: "",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      })
      return structuredClone(owned(input.sessionId))
    }
    publish({
      ...snapshot,
      clientRequestId: input.clientRequestId,
      inputAccepted: true,
      runId,
      phase: "running",
      error: "",
      issue: undefined,
      issueEntryId: undefined,
      canContinue: false,
      runtime: { phase: "responding", updatedAt: new Date().toISOString() },
      statistics: {
        input: 2870,
        output: 512,
        cacheRead: 16908,
        cacheWrite: 880,
        totalTokens: 21170,
        toolCalls: 1,
        turns: 2,
        steps: 3,
        durationMs: 54300,
        modelDurationMs: 18900,
        outputTokens: 512,
        tokensPerSecond: 27.1,
        cost: 0.0362,
      },
      modelId: `idle/${input.modelId}`,
      providerModelId: input.modelId,
      thinking: input.thinking,
      messages: [
        ...snapshot.messages,
        {
          id: userId,
          role: "user",
          text:
            kind === "retry"
              ? "继续完成上次尚未完成的回复。"
              : (input as SendInput).text,
          userTurnId: userId,
          runId,
          ...(kind === "retry"
            ? {
                inputKind: "continuation" as const,
                continuationOf: previousUser?.id,
              }
            : {}),
          time: new Date().toISOString(),
          status: "settled",
          historyIndex: nextHistoryIndex(snapshot),
          materials:
            kind === "send" ? (input as SendInput).materials : undefined,
          attachments: (kind === "send"
            ? (input as SendInput).materials
            : undefined
          )?.map((value) => ({
            id: value.id,
            name: value.name,
            kind: value.type === "image" ? "image" : "file",
            source: value.source,
            materialType: value.type,
          })),
        },
      ],
    })
    return structuredClone(owned(input.sessionId))
  }
  const waitForAdmission = (
    input: SendInput | RetryInput,
    kind: "send" | "retry",
    signal?: AbortSignal
  ) =>
    new Promise<ConversationSnapshot>((resolve, reject) => {
      const abort = () => {
        pending.delete(input.clientRequestId)
        request.cleanup()
        reject(signal?.reason ?? new DOMException("已取消", "AbortError"))
        notify()
      }
      const request: PendingSend = {
        input: structuredClone(input),
        kind,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      }
      pending.set(input.clientRequestId, request)
      signal?.addEventListener("abort", abort, { once: true })
      notify()
    })
  const assistantMessage = (
    snapshot: ConversationSnapshot
  ): ConversationChatMessage => {
    const user = snapshot.messages.findLast(
      (message) => message.role === "user"
    )!
    const entryId = `${snapshot.runId}-step-${snapshot.messages.length}`
    return {
      id: entryId,
      entryId,
      historyIndex: nextHistoryIndex(snapshot),
      userTurnId: user.id,
      runId: snapshot.runId,
      role: "assistant",
      text: "",
      time: new Date().toISOString(),
      model: snapshot.modelId,
      status: "streaming",
      blocks: [],
    }
  }
  const finishExecution = (sessionId: string) => {
    const snapshot = owned(sessionId)
    if (snapshot.approvals?.length || approvalTools.has(sessionId)) return
    if (snapshot.phase !== "running") return
    const tail = snapshot.messages.at(-1)
    const answer =
      tail?.role === "assistant" && tail.status === "streaming" && tail.text
        ? tail
        : {
            ...assistantMessage(snapshot),
            text: "项目说明已按用途、启动方式和目录职责整理。",
          }
    publish({
      ...snapshot,
      phase: "completed",
      runtime: undefined,
      canContinue: false,
      messages: [
        ...(answer === tail
          ? snapshot.messages.slice(0, -1)
          : snapshot.messages),
        {
          ...answer,
          status: "settled",
          stopReason: "stop",
          activeBlockId: undefined,
          blocks: [
            {
              id: `${answer.id}-text`,
              type: "text",
              text: answer.text,
              phase: "settled",
            },
          ],
        },
      ],
    })
  }
  const generateAnswer = (sessionId: string) => {
    const snapshot = owned(sessionId)
    if (snapshot.approvals?.length || approvalTools.has(sessionId)) return
    if (snapshot.phase !== "running") return
    const message = assistantMessage(snapshot)
    const text = "继续补充项目说明。下一稿仍留在输入框中。"
    publish({
      ...snapshot,
      runtime: { phase: "responding", updatedAt: new Date().toISOString() },
      messages: [
        ...snapshot.messages,
        {
          ...message,
          text,
          activeBlockId: `${message.id}-text`,
          blocks: [
            { id: `${message.id}-text`, type: "text", text, phase: "running" },
          ],
        },
      ],
    })
  }
  const failExecution = (
    sessionId: string,
    kind: TerminalFailureKind = "reply"
  ) => {
    const snapshot = owned(sessionId)
    if (snapshot.phase !== "running") return
    const issue = replyIssue(kind)
    const tail = snapshot.messages.at(-1)
    const failed =
      kind !== "reload" &&
      tail?.role === "assistant" &&
      tail.status === "streaming" &&
      tail.runId === snapshot.runId
        ? {
            ...tail,
            status: "failed" as const,
            stopReason: "error" as const,
            activeBlockId: undefined,
            blocks: tail.blocks?.map((block) =>
              block.type === "text"
                ? { ...block, phase: "settled" as const }
                : block
            ),
            issue,
          }
        : {
            ...assistantMessage(snapshot),
            status:
              kind === "reload" ? ("settled" as const) : ("failed" as const),
            stopReason:
              kind === "reload" ? ("stop" as const) : ("error" as const),
            text:
              kind === "reload"
                ? "保存前已生成的示例回复：项目说明按用途、启动方式和目录职责展开。"
                : "",
            ...(kind === "reload" ? {} : { issue }),
          }
    const messages = [
      ...(failed.id === tail?.id
        ? snapshot.messages.slice(0, -1)
        : snapshot.messages),
      failed,
    ]
    if (kind === "settings") missingModels.add(sessionId)
    if (kind === "reload")
      savedRecords.set(sessionId, {
        ...snapshot,
        messages,
        phase: "completed",
        runtime: undefined,
        issue: undefined,
        issueEntryId: undefined,
        error: "",
        canContinue: false,
      })
    publish({
      ...snapshot,
      phase: "failed",
      runtime: undefined,
      error: issue.summary,
      issue,
      issueEntryId: kind === "reload" ? undefined : failed.entryId,
      messages,
      canContinue: kind !== "reload",
    })
  }
  function deliverQueued(sessionId: string, itemId?: string) {
    const snapshot = owned(sessionId)
    const queue = snapshot.queue!
    if (queue.paused && !itemId) return
    const eligible = queue.items.filter((item) =>
      itemId
        ? item.id === itemId
        : snapshot.phase === "running"
          ? item.delivery === "steer"
          : true
    )
    const selected =
      queue.mode === "all" && !itemId ? eligible : eligible.slice(0, 1)
    if (!selected.length) return
    const selectedIds = new Set(selected.map((item) => item.id))
    const runId =
      snapshot.phase === "running"
        ? snapshot.runId!
        : `${selected[0].clientRequestId}-run`
    const messages = snapshot.messages.map((message) =>
      message.status === "streaming"
        ? {
            ...message,
            status: "settled" as const,
            activeBlockId: undefined,
            blocks: message.blocks?.map((block) =>
              block.type === "text"
                ? { ...block, phase: "settled" as const }
                : block
            ),
          }
        : message
    )
    selected.forEach((item) =>
      messages.push({
        id: `${item.id}-user`,
        userTurnId: `${item.id}-user`,
        runId,
        role: "user",
        text: item.text,
        time: new Date().toISOString(),
        status: "settled",
        historyIndex: nextHistoryIndex({ ...snapshot, messages }),
        materials: item.materials,
        attachments: item.materials.map((material) => ({
          ...material,
          kind: material.type === "image" ? "image" : "file",
          materialType: material.type,
        })),
      })
    )
    publish({
      ...snapshot,
      phase: "running",
      runId,
      inputAccepted: true,
      canContinue: false,
      clientRequestId:
        snapshot.phase === "running"
          ? snapshot.clientRequestId
          : selected[0].clientRequestId,
      messages,
      queue: {
        ...queue,
        paused: false,
        revision: queue.revision + 1,
        items: queue.items.filter((item) => !selectedIds.has(item.id)),
        retiredItems: [
          ...(queue.retiredItems ?? []),
          ...selected.map((item) => ({
            id: item.id,
            clientRequestId: item.clientRequestId,
            status: "delivered" as const,
            editBaseRevision: item.editBaseRevision,
            editRequestId: item.editRequestId,
          })),
        ],
      },
    })
  }
  const service: ConversationService = {
    read: (sessionId, signal) => read(sessionId, signal),
    follow: (sessionId, previous, signal) => read(sessionId, signal, previous),
    send: (input, signal) => {
      signal?.throwIfAborted()
      if (owned(input.sessionId).phase === "running" && !runningScenario)
        return rejectExecution()
      if (receipts.has(input.clientRequestId))
        return Promise.reject(lostResponse())
      attempts += 1
      receipts.set(input.clientRequestId, {
        sessionId: input.sessionId,
        clientRequestId: input.clientRequestId,
        state: "unknown",
      })
      if (
        ["submission-unknown", "running-unknown"].includes(scenario) &&
        attempts === 1
      ) {
        unknownInputs.set(input.clientRequestId, {
          input: structuredClone(input),
          confirmable: false,
        })
        notify()
        return Promise.reject(lostResponse())
      }
      return waitForAdmission(input, "send", signal)
    },
    receipt: async (sessionId, requestId, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      const unknown = unknownInputs.get(requestId)
      if (unknown?.input.sessionId === sessionId && unknown.confirmable)
        acceptInput(unknown.input)
      const receipt = receipts.get(requestId)
      return receipt?.sessionId === sessionId
        ? structuredClone(receipt)
        : { sessionId, clientRequestId: requestId, state: "unknown" }
    },
    queueReceipt: async (sessionId, operationRequestId, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      return structuredClone(
        queueReceipts.get(operationRequestId) ?? {
          sessionId,
          operationRequestId,
          state: "unknown",
        }
      )
    },
    queueMode: async (input) => {
      const snapshot = owned(input.sessionId)
      const queue = snapshot.queue!
      if (failNextMode && input.operationRequestId) {
        failNextMode = false
        queueInputs.set(input.operationRequestId, structuredClone(input))
        queueReceipts.set(input.operationRequestId, {
          sessionId: input.sessionId,
          operationRequestId: input.operationRequestId,
          operation: "conversationQueueMode",
          baseRevision: input.revision,
          mode: input.mode,
          state: "unknown",
        })
        notify()
        throw lostResponse()
      }
      publish({
        ...snapshot,
        queue: { ...queue, mode: input.mode, revision: queue.revision + 1 },
      })
      return structuredClone(owned(input.sessionId))
    },
    stop: (sessionId, runId) => {
      const snapshot = owned(sessionId)
      if (snapshot.phase !== "running" || snapshot.runId !== runId)
        return rejectExecution()
      const reply = approvalReplies.get(sessionId)
      approvalReplies.delete(sessionId)
      reply?.reject(
        new RpcRequestRejected("当前运行正在停止，确认请求已取消。")
      )
      const executingTool = approvalTools.get(sessionId)
      approvalTools.delete(sessionId)
      const requests = [
        ...(snapshot.approvals ?? []),
        ...(executingTool ? [executingTool] : []),
      ]
      publish({
        ...snapshot,
        phase: "stopping",
        approvals: [],
        messages: requests.reduce(
          (messages, request) =>
            request.kind === "tool"
              ? setApprovalToolResult({ ...snapshot, messages }, request, false)
              : messages,
          snapshot.messages
        ),
      })
      return new Promise((resolve, reject) => {
        stops.set(sessionId, { runId, resolve, reject })
        notify()
      })
    },
    retry: (input) => {
      const snapshot = owned(input.sessionId)
      if (
        !["failed", "interrupted"].includes(snapshot.phase) ||
        snapshot.issue?.recovery === "reload" ||
        missingModels.has(input.sessionId)
      )
        return rejectExecution()
      receipts.set(input.clientRequestId, {
        sessionId: input.sessionId,
        clientRequestId: input.clientRequestId,
        state: "unknown",
      })
      return waitForAdmission(input, "retry")
    },
    queueEdit: async (input) => {
      if (!runningScenario) return rejectExecution()
      const snapshot = owned(input.sessionId)
      const queue = snapshot.queue!
      if (queue.revision !== input.revision)
        throw new RpcRequestRejected("队列已变化，请重新读取。")
      const item = queue.items.find((value) => value.id === input.itemId)
      if (!item) throw new RpcRequestRejected("原消息已经离开队列。")
      publish({
        ...snapshot,
        queue: {
          ...queue,
          revision: queue.revision + 1,
          items: queue.items.map((value) =>
            value.id === input.itemId
              ? {
                  ...value,
                  text: input.text,
                  materials: input.materials ?? value.materials,
                  editBaseRevision: input.revision,
                  editRequestId: input.clientEditId,
                }
              : value
          ),
        },
      })
      return structuredClone(owned(input.sessionId))
    },
    queueRemove: async (input) => {
      if (!runningScenario) return rejectExecution()
      const snapshot = owned(input.sessionId)
      if (
        input.operationRequestId &&
        queueReceipts.get(input.operationRequestId)?.state === "committed"
      )
        return structuredClone(snapshot)
      const queue = snapshot.queue!
      if (queue.revision !== input.revision)
        throw new RpcRequestRejected("队列已变化，请重新读取。")
      const item = queue.items.find((value) => value.id === input.itemId)
      if (!item) throw new RpcRequestRejected("原消息已经离开队列。")
      publish({
        ...snapshot,
        queue: {
          ...queue,
          revision: queue.revision + 1,
          items: queue.items.filter((value) => value.id !== item.id),
          retiredItems: [
            ...(queue.retiredItems ?? []),
            {
              id: item.id,
              clientRequestId: item.clientRequestId,
              status: "removed",
              editBaseRevision: item.editBaseRevision,
              editRequestId: item.editRequestId,
            },
          ],
        },
      })
      if (input.operationRequestId)
        queueReceipts.set(input.operationRequestId, {
          ...input,
          operationRequestId: input.operationRequestId,
          operation: "conversationQueueRemove",
          baseRevision: input.revision,
          revision: queue.revision + 1,
          state: "committed",
        })
      return structuredClone(owned(input.sessionId))
    },
    queueDeliver: async (input) => {
      if (!runningScenario) return rejectExecution()
      const snapshot = owned(input.sessionId)
      if (
        input.operationRequestId &&
        queueReceipts.get(input.operationRequestId)?.state === "committed"
      )
        return structuredClone(snapshot)
      if (snapshot.queue!.revision !== input.revision)
        throw new RpcRequestRejected("队列已变化，请重新读取。")
      const item = snapshot.queue!.items.find(
        (value) => value.id === input.itemId
      )
      if (!item) throw new RpcRequestRejected("原消息已经离开队列。")
      publish({
        ...snapshot,
        queue: {
          ...snapshot.queue!,
          paused: false,
          revision: snapshot.queue!.revision + 1,
          items: snapshot.queue!.items.map((value) =>
            value.id === input.itemId ? { ...value, delivery: "steer" } : value
          ),
        },
      })
      if (input.operationRequestId)
        queueReceipts.set(input.operationRequestId, {
          ...input,
          operationRequestId: input.operationRequestId,
          operation: "conversationQueueDeliver",
          baseRevision: input.revision,
          revision: snapshot.queue!.revision + 1,
          state: "committed",
        })
      deliverQueued(input.sessionId, item.id)
      return structuredClone(owned(input.sessionId))
    },
  }
  const tools: SessionCatalog["tools"] = [
    {
      id: "read",
      name: "读取文件",
      description: "读取工作区文本。",
      group: "Pi 内置",
      detail: "本示例只保存配置，不执行真实工具。",
      available: true,
      unavailableReason: "",
    },
  ]
  const instructions: SessionCatalog["instructions"] = [
    {
      path: `${cwd}/AGENTS.md`,
      source: "directory",
      content: "保持用户正文与附件归属，说明实际处理结果。",
    },
  ]
  const configurations = new Map<string, SessionConfiguration>()
  const session: SessionService = {
    catalog: async (path, signal) => {
      signal?.throwIfAborted()
      return {
        cwd: path,
        tools,
        instructions,
        defaults: { toolIds: ["read"], instructionScope: "directory" },
      }
    },
    read: async (sessionId, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      return structuredClone(
        configurations.get(sessionId) ?? {
          sessionId,
          cwd,
          revision: 0,
          toolIds: ["read"],
          effectiveToolIds: ["read"],
          unavailableToolIds: [],
          instructionScope: "directory",
          instructions,
        }
      )
    },
    apply: async (input, signal) => {
      signal?.throwIfAborted()
      owned(input.sessionId)
      const value: SessionConfiguration = {
        ...input,
        revision: (configurations.get(input.sessionId)?.revision ?? 0) + 1,
        effectiveToolIds: input.toolIds,
        unavailableToolIds: [],
        instructions: input.instructionScope === "none" ? [] : instructions,
      }
      configurations.set(input.sessionId, structuredClone(value))
      return value
    },
  }
  const setApprovalToolResult = (
    snapshot: ConversationSnapshot,
    request: ConversationApproval,
    allowed: boolean
  ) =>
    snapshot.messages.map((message) => {
      if (
        message.runId !== request.runId ||
        !message.blocks?.some(
          (block) =>
            block.type === "tool" && block.tool.id === request.toolCallId
        )
      )
        return message
      return {
        ...message,
        status: "settled" as const,
        stopReason: "toolUse" as const,
        activeBlockId: undefined,
        blocks: message.blocks.map((block) =>
          block.type === "tool" && block.tool.id === request.toolCallId
            ? {
                ...block,
                tool: {
                  ...block.tool,
                  status: allowed ? ("success" as const) : ("failed" as const),
                  resultAvailability: "available" as const,
                  result: allowed
                    ? "隔离示例：操作已完成；未执行真实命令或写入真实文件。"
                    : "用户拒绝或取消了本次操作，工具没有执行。",
                  ...(allowed && block.tool.name === "bash"
                    ? { exitCode: 0 }
                    : {}),
                },
              }
            : block
        ),
      }
    })
  const requestApproval = (
    sessionId: string,
    kind: ConversationApproval["kind"] = "tool",
    file = false
  ) => {
    const snapshot = owned(sessionId)
    if (
      !approvalScenario ||
      snapshot.phase !== "running" ||
      snapshot.approvals?.length ||
      approvalTools.has(sessionId)
    )
      return
    const callId = `${snapshot.runId}-call-${++approvalSequence}`
    const request: ConversationApproval = {
      id: `${sessionId}-approval-${approvalSequence}`,
      runId: snapshot.runId,
      kind,
      title:
        kind === "tool"
          ? file
            ? "访问工作区外文件"
            : "执行命令"
          : kind === "confirm"
            ? "确认生成目录说明"
            : kind === "select"
              ? "选择文档格式"
              : "补充本次说明的标题",
      message:
        kind === "tool"
          ? file
            ? "允许此工具本次访问：/catalog/shared/notes.md"
            : "此操作可访问本机文件与网络。请确认具体内容，允许仅对这一次生效。"
          : kind === "confirm"
            ? "扩展请求生成文档目录说明。"
            : kind === "select"
              ? "请选择本次输出的格式。"
              : "请输入要交给扩展的标题。",
      ...(kind === "tool"
        ? {
            toolName: file ? "write" : "bash",
            toolCallId: callId,
            input: JSON.stringify(
              file
                ? {
                    path: "../shared/notes.md",
                    content: "项目用途和目录说明。",
                  }
                : { command: "git status --short", timeout: 60 },
              null,
              2
            ),
          }
        : {}),
      ...(kind === "select"
        ? {
            options: [
              "Markdown",
              "纯文本",
              "按模块列出用途、启动方式和目录职责",
            ],
          }
        : {}),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    }
    publish({
      ...snapshot,
      approvals: [request],
      runtime: {
        phase: kind === "tool" ? "tool" : "responding",
        updatedAt: new Date().toISOString(),
      },
      messages:
        kind === "tool"
          ? [
              ...snapshot.messages.map((message) =>
                message.status === "streaming"
                  ? {
                      ...message,
                      status: "settled" as const,
                      activeBlockId: undefined,
                      blocks: message.blocks?.map((block) =>
                        "phase" in block
                          ? { ...block, phase: "settled" as const }
                          : block
                      ),
                    }
                  : message
              ),
              {
                ...assistantMessage(snapshot),
                stopReason: "toolUse",
                blocks: [
                  {
                    id: callId,
                    type: "tool",
                    tool: {
                      id: callId,
                      name: request.toolName!,
                      source: "系统工具",
                      status: "running",
                      input: request.input ?? "",
                      resultAvailability: "missing",
                      result: "",
                      target: file
                        ? {
                            kind: "file",
                            path: "../shared/notes.md",
                            displayPath: "/catalog/shared/notes.md",
                          }
                        : {
                            kind: "command",
                            command: "git status --short",
                            cwd,
                          },
                    },
                  },
                ],
              },
            ]
          : snapshot.messages,
    })
  }
  const acknowledgeApproval = (sessionId: string) => {
    const reply = approvalReplies.get(sessionId)
    if (!reply) return
    const snapshot = owned(sessionId)
    approvalReplies.delete(sessionId)
    if (
      snapshot.runId !== reply.request.runId ||
      !snapshot.approvals?.some((request) => request.id === reply.request.id)
    ) {
      reply.reject(new RpcRequestRejected("原确认请求已结束，请读取当前状态。"))
      notify()
      return
    }
    approvalAnswer = reply.answer
    const allowed = reply.answer === "allow"
    if (reply.request.kind === "tool" && allowed)
      approvalTools.set(sessionId, reply.request)
    publish({
      ...snapshot,
      approvals: snapshot.approvals.filter(
        (request) => request.id !== reply.request.id
      ),
      messages:
        reply.request.kind === "tool" && !allowed
          ? setApprovalToolResult(snapshot, reply.request, false)
          : snapshot.messages,
    })
    reply.resolve()
  }
  const permission: PermissionService = {
    read: async (sessionId, signal) => {
      signal?.throwIfAborted()
      return structuredClone(owned(sessionId).permission!)
    },
    set: async (current, mode) => {
      const snapshot = owned(current.sessionId)
      const value = { ...current, mode, revision: current.revision + 1 }
      publish({ ...snapshot, permission: value })
      return value
    },
    reply: (sessionId, approvalId, runId, answer) => {
      if (!approvalScenario) return rejectExecution()
      const snapshot = owned(sessionId)
      const request = snapshot.approvals?.find(
        (request) => request.id === approvalId && request.runId === runId
      )
      if (
        !request ||
        snapshot.runId !== runId ||
        Date.parse(request.expiresAt) <= Date.now()
      )
        return Promise.reject(
          new RpcRequestRejected("原确认请求已结束或过期，请读取当前状态。", {
            code: "approval_stale",
            summary: "原确认请求已结束或过期，请读取当前状态。",
            severity: "info",
            recovery: "check",
          })
        )
      if (approvalReplies.has(sessionId)) return Promise.reject(lostResponse())
      approvalAttempts += 1
      if (scenario === "approval-rejected" && approvalAttempts === 1)
        return Promise.reject(
          new RpcRequestRejected("本次决定明确未被接收，请再次选择。", {
            code: "approval_rejected",
            summary: "本次决定明确未被接收，请再次选择。",
            recovery: "retry",
            severity: "error",
          })
        )
      return new Promise<null>((resolve, reject) => {
        approvalReplies.set(sessionId, {
          request,
          answer,
          resolve: () => resolve(null),
          reject,
        })
        notify()
        if (scenario === "approval-unknown" && approvalAttempts === 1)
          reject(lostResponse())
      })
    },
  }
  const canvas = document.createElement("canvas")
  canvas.width = 89
  canvas.height = 89
  const paint = canvas.getContext("2d")
  if (paint) {
    paint.fillStyle = "#e7eef8"
    paint.fillRect(0, 0, 89, 89)
    paint.fillStyle = "#4a6b99"
    paint.beginPath()
    paint.arc(44, 44, 25, 0, Math.PI * 2)
    paint.fill()
    paint.fillStyle = "#ffffff"
    paint.font = "14px sans-serif"
    paint.textAlign = "center"
    paint.fillText("Moon", 44, 49)
  }
  const imageData = canvas.toDataURL("image/png").split(",")[1]
  const files: MaterialReference[] = [
    {
      id: "1".repeat(64),
      name: "README.md",
      kind: "附件",
      type: "file",
      status: "ready",
      source: `${cwd}/README.md`,
      description: "项目用途和启动方式。",
    },
    {
      id: "2".repeat(64),
      name: "layout.png",
      kind: "附件",
      type: "image",
      status: "ready",
      source: `${cwd}/layout.png`,
      description: "输入布局示意图。",
      mimeType: "image/png",
      bytes: 2048,
    },
  ]
  const fixed = new Map(files.map((value) => [value.id, value]))
  const images = new Map([
    [files[1].id, { data: imageData, mimeType: "image/png" }],
  ])
  const skills: MaterialReference[] = [
    {
      id: "3".repeat(64),
      name: "review",
      kind: "Skill",
      type: "skill",
      status: "ready",
      source: `${cwd}/skills/review/SKILL.md`,
      description: "检查说明是否清楚并提出改进。",
    },
  ]
  const materials: MaterialService = {
    catalog: async (sessionId, path, query, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      const match = (value: MaterialReference) =>
        `${value.name} ${value.description ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      return {
        cwd: path,
        files: files.filter((value) => value.type === "file" && match(value)),
        skills: skills.filter(match),
        diagnostics: [],
        commands: [],
      }
    },
    choose: async (sessionId, _path, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      return structuredClone(files)
    },
    prepare: async (sessionId, _path, paths, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      return paths.map((path) => {
        const value = [...fixed.values()].find((item) => item.source === path)
        if (!value)
          throw new RpcRequestRejected("此演示目录没有该文件，请重新选择。")
        return structuredClone(value)
      })
    },
    upload: async (sessionId, path, file, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      const value: MaterialReference = {
        id: (++materialSequence).toString(16).padStart(64, "0"),
        name: file.name,
        kind: "附件",
        type: "image",
        status: "ready",
        source: `${path}/${file.name}`,
        mimeType: file.mimeType,
        bytes: Math.floor((file.data.length * 3) / 4),
      }
      fixed.set(value.id, value)
      images.set(value.id, { data: file.data, mimeType: file.mimeType })
      return structuredClone(value)
    },
    preview: async (_path, materialId, signal) => {
      signal?.throwIfAborted()
      if (disposed) throw new Error("此演示已关闭。")
      const value = fixed.get(materialId)
      if (!value)
        throw new RpcRequestRejected("此演示材料已不存在，请重新选择。")
      return {
        id: value.id,
        name: value.name,
        source: value.source,
        label: value.type === "image" ? "待发送图片" : "当前文件",
        content:
          value.type === "file"
            ? "# Moon 项目说明\n\nMoon 是本地 Agent 应用。\n\n## 启动\n\n使用项目已有 dev 命令。\n\n## 目录\n\nsrc 保存正式界面，backend 保存宿主服务。"
            : "",
        mimeType: images.get(materialId)?.mimeType ?? "",
        data: images.get(materialId)?.data ?? "",
        truncated: false,
      }
    },
    restore: async (sessionId, _path, values, signal) => {
      signal?.throwIfAborted()
      owned(sessionId)
      return values.map((value) =>
        structuredClone(
          fixed.get(value.id) ?? {
            ...value,
            type: value.type ?? "file",
            status: "failed" as const,
            source: value.source ?? "",
            error: "此演示材料已不存在，请重新选择或移除。",
            retryable: false,
          }
        )
      )
    },
  }
  const command: ReturnType<typeof createCommandService> = {
    run: rejectExecution,
    read: rejectExecution,
  }
  const controls: ConversationControlService = {
    compact: async (sessionId, operationId, focus) => {
      if (!compactEnabled) return rejectExecution()
      const snapshot = owned(sessionId)
      const previous = compactOperations.get(operationId)
      if (previous)
        return previous.sessionId === sessionId
          ? structuredClone(previous)
          : rejectExecution()
      if (
        snapshot.control?.busy ||
        ["running", "stopping"].includes(snapshot.phase) ||
        snapshot.approvals?.length ||
        snapshot.queue?.items.length ||
        [...pending.values()].some(
          (value) => value.input.sessionId === sessionId
        )
      )
        return rejectExecution()
      const now = new Date().toISOString()
      const operation: ConversationControlOperation = {
        id: operationId,
        sessionId,
        kind: "compact",
        status: compactCommandScenario ? "running" : "unknown",
        createdAt: now,
        updatedAt: now,
        error: "",
        focus,
        anchorId: snapshot.messages.at(-1)?.entryId,
      }
      compactOperations.set(operationId, operation)
      publish({
        ...snapshot,
        control: { ...snapshot.control!, busy: true, operation },
      })
      return structuredClone(operation)
    },
    read: async (sessionId, operationId, signal) => {
      if (!compactEnabled) return rejectExecution()
      signal?.throwIfAborted()
      owned(sessionId)
      const operation = compactOperations.get(operationId)
      if (operation && operation.sessionId !== sessionId)
        return rejectExecution()
      return operation ? structuredClone(operation) : null
    },
    cancel: async (sessionId, operationId) => {
      if (!compactEnabled) return rejectExecution()
      const snapshot = owned(sessionId)
      const current = compactOperations.get(operationId)
      if (!current || current.sessionId !== sessionId) return rejectExecution()
      if (!["running", "cancelling"].includes(current.status))
        return structuredClone(current)
      const operation: ConversationControlOperation = {
        ...current,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      }
      compactOperations.set(operationId, operation)
      publish({
        ...snapshot,
        control: { ...snapshot.control!, busy: false, operation },
      })
      return structuredClone(operation)
    },
    fork: rejectExecution,
  }
  const draftFor = (sessionId: string): ComposerDraft => ({
    sessionId,
    workspaceId,
    text: "",
    model:
      scenario === "model-unavailable"
        ? "idle/removed"
        : `idle/${initialModel}`,
    thinking: "off",
    materials: [],
    session: { toolIds: ["read"], instructionScope: "directory" },
  })
  return {
    id,
    otherId,
    ids,
    cwd,
    workspaceId,
    service,
    session,
    permission,
    materials,
    command,
    controls,
    tools,
    draftFor,
    extensions: createExtensionFixtureService(),
    requestApproval,
    acknowledgeApproval,
    completeApprovalTool(sessionId: string) {
      const request = approvalTools.get(sessionId)
      if (!request) return
      approvalTools.delete(sessionId)
      const snapshot = owned(sessionId)
      if (snapshot.runId === request.runId)
        publish({
          ...snapshot,
          messages: setApprovalToolResult(snapshot, request, true),
        })
    },
    withdrawApproval(sessionId: string) {
      const snapshot = owned(sessionId)
      const reply = approvalReplies.get(sessionId)
      approvalReplies.delete(sessionId)
      reply?.reject(new RpcRequestRejected("原确认请求已撤回。"))
      publish({
        ...snapshot,
        approvals: [],
        messages: (snapshot.approvals ?? []).reduce(
          (messages, request) =>
            request.kind === "tool"
              ? setApprovalToolResult({ ...snapshot, messages }, request, false)
              : messages,
          snapshot.messages
        ),
      })
    },
    getDriver: () => driver,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    acceptNext() {
      const first = pending.entries().next().value
      if (!first) return
      const [requestId, request] = first
      pending.delete(requestId)
      request.cleanup()
      request.resolve(acceptInput(request.input, request.kind))
      notify()
    },
    rejectNext() {
      const first = pending.entries().next().value
      if (!first) return
      const [requestId, request] = first
      pending.delete(requestId)
      request.cleanup()
      const issue = {
        code: "catalog_input_rejected",
        summary:
          request.kind === "retry"
            ? "继续回复的请求未被接收，请稍后再次继续；下一稿未发送。"
            : "这次输入被明确拒绝，请修正后主动发送。",
        recovery:
          request.kind === "retry" ? ("retry" as const) : ("none" as const),
        severity: "error" as const,
      }
      receipts.set(requestId, {
        sessionId: request.input.sessionId,
        clientRequestId: requestId,
        state: "rejected",
        issue,
      })
      request.reject(new RpcRequestRejected(issue.summary, issue))
      notify()
    },
    allowOriginalReceipt() {
      for (const value of unknownInputs.values()) value.confirmable = true
      notify()
    },
    generateAnswer,
    finish(sessionId: string) {
      finishExecution(sessionId)
      if (runningScenario) deliverQueued(sessionId)
    },
    deliveryBoundary: deliverQueued,
    stopCompleted(sessionId: string) {
      const request = stops.get(sessionId)
      const snapshot = owned(sessionId)
      if (!request || snapshot.runId !== request.runId) return
      stops.delete(sessionId)
      publish({
        ...snapshot,
        phase: "interrupted",
        ...(runningScenario
          ? {
              queue: {
                ...snapshot.queue!,
                paused: true,
                revision: snapshot.queue!.revision + 1,
              },
            }
          : {}),
        runtime: undefined,
        error: "",
        messages: snapshot.messages.map((message) =>
          message.runId === request.runId && message.status === "streaming"
            ? {
                ...message,
                status: "interrupted",
                stopReason: "aborted",
                activeBlockId: undefined,
                blocks: message.blocks?.map((block) =>
                  block.type === "tool"
                    ? {
                        ...block,
                        tool: {
                          ...block.tool,
                          status:
                            block.tool.status === "running"
                              ? "stopped"
                              : block.tool.status,
                        },
                      }
                    : "phase" in block
                      ? { ...block, phase: "settled" }
                      : block
                ),
                tools: message.tools?.map((tool) =>
                  tool.status === "running"
                    ? { ...tool, status: "stopped" }
                    : tool
                ),
              }
            : message
        ),
        canContinue: true,
      })
      request.resolve(structuredClone(owned(sessionId)))
    },
    fail: failExecution,
    allowRecordReload(sessionId: string) {
      if (savedRecords.has(sessionId)) reloadRecords.add(sessionId)
    },
    restoreModels(sessionId: string) {
      missingModels.delete(sessionId)
      notify()
    },
    showUsage(sessionId: string, present: boolean) {
      const snapshot = owned(sessionId)
      publish({
        ...snapshot,
        context: present
          ? {
              usedTokens: 450,
              contextWindow: 64000,
              source: "pi-context-estimate",
              estimated: true,
              observedAt: stamp,
              restored: true,
            }
          : undefined,
        contextState: present
          ? undefined
          : {
              status: "unavailable",
              observedAt: stamp,
              reason: "当前没有已记录的上下文用量。",
            },
        statistics: {
          input: present ? 400 : 0,
          output: present ? 49 : 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: present ? 449 : 0,
          toolCalls: 0,
          restored: true,
        },
      })
    },
    showContextReading(sessionId: string, kind: ContextReadingScenario) {
      const snapshot = owned(sessionId)
      publish({
        ...snapshot,
        ...contextReading(kind),
        statistics: snapshot.statistics
          ? { ...snapshot.statistics, restored: kind === "history" }
          : undefined,
      })
    },
    showQueue(sessionId: string, present: boolean) {
      const snapshot = owned(sessionId)
      publish({
        ...snapshot,
        queue: {
          ...snapshot.queue!,
          revision: snapshot.queue!.revision + 1,
          items: present
            ? [
                {
                  id: `${sessionId}-queued`,
                  clientRequestId: `${sessionId}-queued-request`,
                  text: "稍后补充项目示例。",
                  materials: [],
                  status: "pending",
                  delivery: "followUp",
                  error: "",
                  createdAt: stamp,
                },
              ]
            : [],
        },
      })
    },
    armModeUnknown() {
      failNextMode = true
    },
    confirmModeReceipt() {
      for (const [requestId, input] of queueInputs) {
        const snapshot = owned(input.sessionId)
        queueReceipts.set(requestId, {
          sessionId: input.sessionId,
          operationRequestId: requestId,
          operation: "conversationQueueMode",
          baseRevision: input.revision,
          revision: input.revision + 1,
          mode: input.mode,
          state: "committed",
        })
        publish({
          ...snapshot,
          queue: {
            ...snapshot.queue!,
            mode: input.mode,
            revision: input.revision + 1,
          },
        })
      }
      queueInputs.clear()
      notify()
    },
    finishCompact(sessionId: string, result: "completed" | "failed") {
      const snapshot = owned(sessionId)
      const operationId = snapshot.control?.operation?.id
      const current = operationId && compactOperations.get(operationId)
      if (
        !current ||
        !["running", "cancelling", "unknown"].includes(current.status)
      )
        return
      const now = new Date().toISOString()
      const recordId = `${current.id}-summary`
      const operation: ConversationControlOperation = {
        ...current,
        status: result,
        updatedAt: now,
        error:
          result === "failed"
            ? "隔离示例压缩未完成，原历史与命令草稿保留。"
            : "",
        compactionEntryId: result === "completed" ? recordId : undefined,
      }
      compactOperations.set(current.id, operation)
      const firstKept = snapshot.messages[0]
      const record: ConversationCompaction = {
        id: recordId,
        time: now,
        summary:
          "### 项目说明摘要\n\n- **用途**：说明项目解决的问题。\n- **启动方式**：保留开发命令与配置要求。\n- **目录职责**：按模块说明正式源码位置。\n\n这是隔离服务发布的示例摘要，原会话历史仍保留。",
        firstKeptEntryId: firstKept?.entryId ?? firstKept?.id ?? "",
        firstKeptHistoryIndex: firstKept?.historyIndex ?? -1,
        tokensBefore: snapshot.context?.usedTokens ?? -1,
        source: "manual",
        historyIndex: nextHistoryIndex(snapshot),
      }
      publish({
        ...snapshot,
        control: { ...snapshot.control!, busy: false, operation },
        ...(result === "completed"
          ? {
              compactions: [...(snapshot.compactions ?? []), record],
              context: undefined,
              contextState: {
                status: "awaiting-response" as const,
                contextWindow: snapshot.context?.contextWindow ?? 64000,
                observedAt: now,
                reason: "压缩后的上下文读数待下一次模型回复更新。",
              },
            }
          : {}),
      })
    },
    loseCompactResponse(sessionId: string) {
      const snapshot = owned(sessionId)
      const current = snapshot.control?.operation
      if (current?.kind !== "compact" || current.status !== "running") return
      const operation: ConversationControlOperation = {
        ...current,
        status: "unknown",
        updatedAt: new Date().toISOString(),
      }
      compactOperations.set(current.id, operation)
      publish({
        ...snapshot,
        control: { ...snapshot.control!, busy: true, operation },
      })
    },
    dispose() {
      disposed = true
      for (const waiter of waiters) {
        waiter.cleanup()
        waiter.reject(new DOMException("已关闭", "AbortError"))
      }
      for (const request of pending.values()) {
        request.cleanup()
        request.reject(new DOMException("已关闭", "AbortError"))
      }
      for (const request of stops.values())
        request.reject(new DOMException("已关闭", "AbortError"))
      waiters.clear()
      pending.clear()
      stops.clear()
      for (const reply of approvalReplies.values())
        reply.reject(new DOMException("已关闭", "AbortError"))
      approvalReplies.clear()
      approvalTools.clear()
      listeners.clear()
      unknownInputs.clear()
      compactOperations.clear()
    },
  }
}
