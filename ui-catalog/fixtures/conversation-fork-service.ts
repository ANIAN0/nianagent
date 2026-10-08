import type { ConversationService } from "@/features/conversation/conversation-service"
import type { ConversationControlService } from "@/features/conversation/controls/conversation-control-service"
import type { createCommandService } from "@/features/conversation/controls/command-service"
import type { PermissionService } from "@/features/conversation/permissions/permission-service"
import type { SessionService } from "@/features/session/session-service"
import type { MaterialService } from "@/features/materials/material-service"
import type { ExtensionService } from "@/features/extensions/extension-service"
import { RpcRequestRejected } from "@/lib/rpc/client"
import type {
  ConversationChatMessage,
  ConversationControlOperation,
  ConversationSnapshot,
  SessionCatalog,
  SessionConfiguration,
} from "@/contracts/rpc.generated"
import type { ComposerDraft } from "@/lib/composer/types"

export type ForkScenario =
  | "fork-created"
  | "fork-unknown"
  | "fork-failed"
  | "fork-legacy-disabled"
  | "fork-busy-disabled"

const SOURCE_TITLE = "项目会话派生讨论"
const DERIVED_TITLE = "项目会话派生讨论 · 分支"
const STAMP = "2026-10-06T08:00:00.000Z"

const USER_1_TEXT =
  "先说明这个组件库会话从哪里开始，后面我要另开一条线继续讨论。"
const ANSWER_1_TEXT =
  "会话从已保存的 Agent 回复派生：先确认这一段正式装配在哪里，再决定从哪条回复另开会话。"
const USER_2_TEXT = "那就在最新这条回复上创建分支，保留根到这里的全部历史。"
const ANSWER_2_TEXT =
  "可以。分支复制根到这条回复的真实前缀，新会话拥有独立标识与配置；原会话、未发送草稿和队列都不受影响。"

function sourceMessages(
  sourceId: string,
  legacy: boolean
): ConversationChatMessage[] {
  const firstUser = `${sourceId}-user-1`
  const firstAnswer = `${sourceId}-answer-1`
  const secondUser = `${sourceId}-user-2`
  const secondAnswer = `${sourceId}-answer-2`
  const forkable = !legacy
  return [
    {
      id: firstUser,
      userTurnId: firstUser,
      runId: `${sourceId}-run-1`,
      historyIndex: 0,
      role: "user",
      text: USER_1_TEXT,
      time: "2026-10-06T08:00:00.000Z",
      status: "settled",
    },
    {
      id: firstAnswer,
      entryId: firstAnswer,
      userTurnId: firstUser,
      runId: `${sourceId}-run-1`,
      historyIndex: 1,
      role: "assistant",
      text: ANSWER_1_TEXT,
      blocks: [
        {
          id: `${firstAnswer}-text`,
          type: "text",
          text: ANSWER_1_TEXT,
          phase: "settled",
        },
      ],
      time: "2026-10-06T08:01:00.000Z",
      model: "分支示例模型",
      status: "settled",
      stopReason: "stop",
      forkable,
    },
    {
      id: secondUser,
      userTurnId: secondUser,
      runId: `${sourceId}-run-2`,
      historyIndex: 2,
      role: "user",
      text: USER_2_TEXT,
      time: "2026-10-06T08:02:00.000Z",
      status: "settled",
    },
    {
      id: secondAnswer,
      entryId: secondAnswer,
      userTurnId: secondUser,
      runId: `${sourceId}-run-2`,
      historyIndex: 3,
      role: "assistant",
      text: ANSWER_2_TEXT,
      blocks: [
        {
          id: `${secondAnswer}-text`,
          type: "text",
          text: ANSWER_2_TEXT,
          phase: "settled",
        },
      ],
      time: "2026-10-06T08:03:00.000Z",
      model: "分支示例模型",
      status: "settled",
      stopReason: "stop",
      forkable,
    },
  ]
}

type ForkDriver = {
  forkStatus: "idle" | "unknown" | "completed" | "failed"
  forkAttempts: number
  canConfirm: boolean
  canRetry: boolean
  derivedReady: boolean
}

/**
 * 隔离的会话派生环境：源会话拥有两轮已完成回复，派生会话预先确定并复制到所选回复的前缀。
 * 只提供数据与服务，正式 LiveConversationView / useConversationControls 负责全部交互。
 */
export function createForkEnvironment(scenario: ForkScenario) {
  const sourceId = `catalog-fork-source-${crypto.randomUUID()}`
  const derivedId = `catalog-fork-derived-${crypto.randomUUID()}`
  const cwd = "/catalog/conversation-fork"
  const workspaceId = `${sourceId}-workspace`
  const legacy = scenario === "fork-legacy-disabled"
  const messages = sourceMessages(sourceId, legacy)
  // 派生会话标识预先确定，但前缀与来源边界取决于实际点击的那条已完成回复。
  const buildDerived = (anchorEntryId: string): ConversationSnapshot => {
    const anchorIndex = messages.findIndex(
      (message) => message.entryId === anchorEntryId
    )
    return {
      id: derivedId,
      title: DERIVED_TITLE,
      workspaceId,
      cwd,
      version: 1,
      epoch: `${derivedId}-epoch`,
      clientRequestId: "",
      inputAccepted: false,
      runId: "",
      phase: "idle",
      modelId: "fork/demo",
      connectionId: "fork",
      providerModelId: "demo",
      thinking: "off",
      error: "",
      messages: structuredClone(messages.slice(0, anchorIndex + 1)),
      permission: { sessionId: derivedId, mode: "workspace", revision: 0 },
      control: {
        busy: false,
        compactDisabledReason: "派生示例不演示上下文压缩。",
        forkDisabledReason: "派生示例只演示从源回复创建分支。",
      },
      lineage: {
        sourceSessionId: sourceId,
        sourceTitle: SOURCE_TITLE,
        sourceEntryId: anchorEntryId,
      },
      contextState: {
        status: "unavailable",
        observedAt: STAMP,
        reason: "派生示例不提供真实上下文用量。",
      },
    }
  }
  const source: ConversationSnapshot = {
    id: sourceId,
    title: SOURCE_TITLE,
    workspaceId,
    cwd,
    version: 1,
    epoch: `${sourceId}-epoch`,
    clientRequestId: `${sourceId}-last-input`,
    inputAccepted: true,
    runId: `${sourceId}-run-2`,
    phase: "completed",
    modelId: "fork/demo",
    connectionId: "fork",
    providerModelId: "demo",
    thinking: "off",
    error: "",
    messages,
    permission: { sessionId: sourceId, mode: "workspace", revision: 0 },
    statistics: {
      input: 1820,
      output: 420,
      cacheRead: 8300,
      cacheWrite: 320,
      totalTokens: 10860,
      toolCalls: 1,
      turns: 2,
      steps: 2,
      durationMs: 26100,
      modelDurationMs: 9200,
      outputTokens: 420,
      tokensPerSecond: 45.6,
      cost: 0.0187,
    },
    control: {
      busy: scenario === "fork-busy-disabled",
      compactDisabledReason: "派生示例不演示上下文压缩。",
      forkDisabledReason: "",
    },
    contextState: {
      status: "unavailable",
      observedAt: STAMP,
      reason: "派生示例不提供真实上下文用量。",
    },
    ...(legacy
      ? {
          historyNotice:
            "旧格式只读历史：请先显式发送一次消息，由 Pi 完成持久迁移后再创建分支。",
        }
      : {}),
  }
  const snapshots = new Map<string, ConversationSnapshot>([[sourceId, source]])
  const listeners = new Set<() => void>()
  const waiters = new Set<{
    sessionId: string
    version: number
    resolve: (value: ConversationSnapshot) => void
    reject: (error: unknown) => void
    cleanup: () => void
  }>()
  const forkOperations = new Map<string, ConversationControlOperation>()
  const state = {
    forkStatus: "idle" as ForkDriver["forkStatus"],
    retryAllowed: scenario !== "fork-failed",
    attempts: 0,
  }
  const buildDriver = (): ForkDriver => ({
    forkStatus: state.forkStatus,
    forkAttempts: state.attempts,
    canConfirm: scenario === "fork-unknown" && state.forkStatus === "unknown",
    canRetry:
      scenario === "fork-failed" &&
      state.forkStatus === "failed" &&
      !state.retryAllowed,
    derivedReady: snapshots.has(derivedId) && state.forkStatus === "completed",
  })
  let driver = buildDriver()
  const notify = () => {
    driver = buildDriver()
    listeners.forEach((listener) => listener())
  }
  const rejectExecution = async (): Promise<never> => {
    throw new RpcRequestRejected("隔离分支示例不执行此操作；当前内容已保留。", {
      code: "catalog_fork_read_only",
      summary: "隔离分支示例不执行此操作，当前内容已保留。",
      recovery: "none",
      severity: "warning",
    })
  }
  const sessionMissing = () =>
    new RpcRequestRejected("隔离分支示例中不存在此会话。", {
      code: "catalog_fork_missing",
      summary: "隔离分支示例中不存在此会话。",
      recovery: "none",
      severity: "warning",
    })
  const read = (
    sessionId: string,
    signal?: AbortSignal,
    previous?: ConversationSnapshot
  ): Promise<ConversationSnapshot> => {
    signal?.throwIfAborted()
    const snapshot = snapshots.get(sessionId)
    if (!snapshot) return Promise.reject(sessionMissing())
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
        cleanup: () => signal?.removeEventListener("abort", abort),
      }
      waiters.add(waiter)
      signal?.addEventListener("abort", abort, { once: true })
    })
  }
  const service: ConversationService = {
    read: (sessionId, signal) => read(sessionId, signal),
    follow: (sessionId, previous, signal) => read(sessionId, signal, previous),
    receipt: rejectExecution,
    queueReceipt: rejectExecution,
    send: rejectExecution,
    retry: rejectExecution,
    stop: rejectExecution,
    queueEdit: rejectExecution,
    queueRemove: rejectExecution,
    queueMode: rejectExecution,
    queueDeliver: rejectExecution,
  }
  const controls: ConversationControlService = {
    compact: rejectExecution,
    cancel: rejectExecution,
    read: async (sessionId, operationId, signal) => {
      signal?.throwIfAborted()
      if (!snapshots.has(sessionId)) return rejectExecution()
      const operation = forkOperations.get(operationId)
      if (operation && operation.sessionId !== sessionId)
        return rejectExecution()
      return operation ? structuredClone(operation) : null
    },
    fork: async (sessionId, operationId, entryId) => {
      if (sessionId !== sourceId) return rejectExecution()
      const previous = forkOperations.get(operationId)
      if (previous) return structuredClone(previous)
      const anchor = messages.find(
        (message) => message.role === "assistant" && message.entryId === entryId
      )
      if (!anchor || anchor.forkable !== true)
        throw new RpcRequestRejected("所选回复不是可派生的已保存边界。", {
          code: "fork_anchor_invalid",
          summary:
            "所选回复不是可派生的已保存边界，请选择已完成的 Agent 回复。",
          recovery: "none",
          severity: "error",
        })
      if (
        scenario === "fork-legacy-disabled" ||
        scenario === "fork-busy-disabled"
      ) {
        throw new RpcRequestRejected("当前来源状态不允许创建分支。", {
          code: "fork_disabled",
          summary: "当前来源状态不允许创建分支；原会话保持不变。",
          recovery: "none",
          severity: "warning",
        })
      }
      if (scenario === "fork-failed" && !state.retryAllowed) {
        state.attempts += 1
        state.forkStatus = "failed"
        notify()
        throw new RpcRequestRejected("来源历史写入失败，未创建新会话。", {
          code: "fork_failed",
          summary: "来源历史写入失败，未创建新会话；原会话保持不变。",
          recovery: "retry",
          severity: "error",
        })
      }
      const now = new Date().toISOString()
      const created = scenario !== "fork-unknown"
      const operation: ConversationControlOperation = {
        id: operationId,
        kind: "fork",
        sessionId,
        status: created ? "completed" : "unknown",
        createdAt: now,
        updatedAt: now,
        error: "",
        anchorId: entryId,
        ...(created ? { targetSessionId: derivedId } : {}),
      }
      forkOperations.set(operationId, operation)
      snapshots.set(derivedId, buildDerived(entryId))
      state.attempts += 1
      state.forkStatus = created ? "completed" : "unknown"
      notify()
      return structuredClone(operation)
    },
  }
  const tools: SessionCatalog["tools"] = [
    {
      id: "read",
      name: "读取文件",
      description: "查看指定文件的内容。",
      group: "Pi 内置",
      detail: "隔离分支示例只展示已保存的工具配置，不执行读取。",
      available: true,
      unavailableReason: "",
    },
  ]
  const instructions: SessionCatalog["instructions"] = [
    {
      path: `${cwd}/AGENTS.md`,
      source: "directory",
      content: "会话派生示例：从已完成的 Agent 回复创建独立会话并保留来源。",
    },
  ]
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
      return {
        sessionId,
        cwd,
        revision: 1,
        toolIds: ["read"],
        effectiveToolIds: ["read"],
        unavailableToolIds: [],
        instructionScope: "directory",
        instructions,
      } satisfies SessionConfiguration
    },
    apply: rejectExecution,
  }
  const permission: PermissionService = {
    read: async (sessionId, signal) => {
      signal?.throwIfAborted()
      return { sessionId, mode: "workspace", revision: 0 }
    },
    set: rejectExecution,
    reply: rejectExecution,
  }
  const materials: MaterialService = {
    catalog: async (_sessionId, path, _query, signal) => {
      signal?.throwIfAborted()
      return { cwd: path, files: [], skills: [], diagnostics: [], commands: [] }
    },
    choose: rejectExecution,
    prepare: rejectExecution,
    upload: rejectExecution,
    preview: rejectExecution,
    restore: async (_sessionId, _path, values, signal) => {
      signal?.throwIfAborted()
      return values.map((value) => ({
        ...value,
        type: value.type ?? "file",
        status: "failed",
        source: value.source ?? "",
        error: "分支示例不读取外部材料，请移除引用。",
        retryable: false,
      }))
    },
  }
  const extensions: ExtensionService = {
    evidence: "demo",
    list: async (signal) => {
      signal?.throwIfAborted()
      return []
    },
    configure: rejectExecution,
    readWriteReceipt: rejectExecution,
  }
  const command: ReturnType<typeof createCommandService> = {
    run: rejectExecution,
    read: rejectExecution,
  }
  const draftFor = (sessionId: string): ComposerDraft => ({
    sessionId,
    workspaceId,
    text: "",
    model: "fork/demo",
    thinking: "off",
    materials: [],
    session: { toolIds: ["read"], instructionScope: "directory" },
  })
  return {
    scenario,
    sourceId,
    derivedId,
    sourceTitle: SOURCE_TITLE,
    derivedTitle: DERIVED_TITLE,
    cwd,
    workspaceId,
    draftFor,
    tools,
    service,
    session,
    permission,
    materials,
    extensions,
    command,
    controls,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getDriver: () => driver,
    confirmForkCreated() {
      const now = new Date().toISOString()
      let anchorEntryId: string | undefined
      for (const [id, operation] of forkOperations) {
        if (operation.kind !== "fork" || operation.status !== "unknown")
          continue
        anchorEntryId = operation.anchorId
        forkOperations.set(id, {
          ...operation,
          status: "completed",
          updatedAt: now,
          targetSessionId: derivedId,
        })
      }
      if (anchorEntryId && !snapshots.has(derivedId))
        snapshots.set(derivedId, buildDerived(anchorEntryId))
      state.forkStatus = "completed"
      notify()
    },
    allowForkRetry() {
      state.retryAllowed = true
      notify()
    },
    dispose() {
      for (const waiter of waiters) {
        waiter.cleanup()
        waiter.reject(new DOMException("展示已关闭", "AbortError"))
      }
      waiters.clear()
      listeners.clear()
    },
  }
}
