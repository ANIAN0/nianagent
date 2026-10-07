import type { ConversationService } from "@/features/conversation/conversation-service"
import type { ConversationControlService } from "@/features/conversation/controls/conversation-control-service"
import type { createCommandService } from "@/features/conversation/controls/command-service"
import type { PermissionService } from "@/features/conversation/permissions/permission-service"
import type { SessionService } from "@/features/session/session-service"
import type { MaterialService } from "@/features/materials/material-service"
import type { ExtensionService } from "@/features/extensions/extension-service"
import {
  RpcRequestRejected,
  RpcTransportError,
} from "@/features/models/model-service"
import type {
  ConversationApproval,
  ConversationChatMessage,
  ConversationCompaction,
  ConversationControlOperation,
  ConversationQueueOperationReceipt,
  ConversationRequestReceipt,
  ConversationSnapshot,
  MaterialReference,
  RpcRequests,
  SessionCatalog,
  SessionConfiguration,
} from "@/features/models/model-contract.generated"
import type { HomeDraft } from "@/features/home/home-types"
import { createExtensionFixtureService } from "./extensions"

export type ConversationPageScenario =
  "page-ready" | "page-recovery" | "page-running" | "page-narrow"

type SendInput = RpcRequests["conversationSend"]
type RetryInput = RpcRequests["conversationRetry"]
type PendingSend = {
  input: SendInput | RetryInput
  kind: "send" | "retry"
  resolve: (snapshot: ConversationSnapshot) => void
  reject: (error: unknown) => void
  cleanup: () => void
}
type PageDriver = {
  readState: "available" | "held" | "failed"
  running: boolean
  pending: boolean
  pendingKind?: "send" | "retry"
  unknown: boolean
  confirmable: boolean
  queueUnknown: boolean
  compactActive: boolean
  forkStatus: "idle" | "unknown" | "completed" | "failed"
  derivedReady: boolean
  approvalPendingSession?: string
  approvalToolSession?: string
  approvalAnswer?: string
}

const STAMP = "2026-10-08T08:00:00.000Z"
const SOURCE_TITLE = "整页会话组合讨论"
const DERIVED_TITLE = "整页会话组合讨论 · 分支"
const OTHER_TITLE = "另一个讨论"

const paragraphs = [
  "先区分用户输入、Agent 回复、工具结果和材料，再决定当前进展归属哪一轮。原输入保留原文，回复按相同轮次归并，读者能把问题与回答对上。",
  "整页组合沿正式 LiveConversationView：头部表达当前状态，消息流展示进展与终态，输入区保留下一稿；审批、队列和恢复入口靠近各自操作。",
  "服务快照与输入草稿分开保存。失败不是正文，错误原因放在所属操作附近；已有内容和未发送草稿始终保留。",
  "长回复需要清楚的标题、段落和列表。代码与宽表各自局部横向滚动，正文和输入入口不应被长行撑出窗口。",
]

const longReply = [
  "# 整页会话组合方案\n\n这份记录整理整页组合、运行中队列与窄窗继续的使用过程。",
  ...Array.from(
    { length: 8 },
    (_, index) =>
      `## ${index + 1}. ${["整页组合", "运行队列", "异常恢复", "窄窗继续"][index % 4]}\n\n${paragraphs[index % 4]}\n\n- 保留问题与回复的对应关系。\n- 明确当前位置与最新内容。\n- 恢复操作不清除下一稿。`
  ),
  "## 宽表\n\n| 检查项 | 整页组合 | 运行中发送 | 队列恢复 | 窄窗阅读 | 失败保留 | 返回后 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 用户原输入 | 先从用户需要找到的内容出发，再决定消息如何组织；即使说明较长，也可以在单元格内自然换行，完整阅读每一句话。 | 空稿唯一主动作是停止 | 明确拒绝保留两稿 | 允许正常换行 | 保留已有内容 | 原内容保持可辨认 |\n| Agent 回复 | 按段落阅读 | 新稿进入排队 | 未知回执核对原操作 | 代码和宽表局部滚动 | 原稿仍可编辑 | 返回保留阅读位置 |\n| 输入区 | 空闲时继续输入 | Enter 排队 / Ctrl+Enter 补充 | 恢复不清草稿 | 发送仍可达 | 草稿保留 | 草稿独立保存 |",
  "## 短表\n\n| 区域 | 检查项 | 结果 |\n| --- | --- | --- |\n| 头部 | 状态文本 | 可辨认 |\n| 消息流 | 当前轮次 | 可阅读 |\n| 输入区 | 下一稿 | 未发送 |",
  "## 代码\n\n```ts\n" +
    [
      "type PageState = { id: string; phase: 'completed'; draft: string }",
      "const state: PageState = { id: 'catalog-page', phase: 'completed', draft: '下一条输入' }",
      ...Array.from(
        { length: 22 },
        (_, index) =>
          `const checkpoint${index + 1} = { section: 'page', question: '如何在一整页会话中继续当前任务？', completed: ${index % 2 === 0} }`
      ),
      "console.log(state)",
    ].join("\n") +
    "\n```\n\n代码只是供阅读的文本，不在展示环境执行。",
  "## 结束\n\n用户读懂当前结果和进展后，可以在当前会话继续工作。",
].join("\n\n")

/** 五轮多轮历史；narrow 时第五轮使用长正文、宽表与代码。 */
function history(sessionId: string, long: boolean): ConversationChatMessage[] {
  const prompts = [
    "请先说明这一整页会话从哪里开始，我后面要继续工作。",
    "如何区分用户输入、Agent 回复、工具结果和材料？",
    "运行中我发送下一条消息会发生什么？",
    "读取或发送遇到问题，我的草稿会丢吗？",
    "请在窄窗口整理长正文、代码和宽表的阅读检查清单。",
  ]
  const messages: ConversationChatMessage[] = []
  prompts.forEach((text, index) => {
    const userId = `${sessionId}-user-${index + 1}`
    const runId = `${sessionId}-run-${index + 1}`
    messages.push({
      id: userId,
      userTurnId: userId,
      runId,
      historyIndex: messages.length,
      role: "user",
      text,
      time: `2026-10-08T08:${String(index * 2).padStart(2, "0")}:00.000Z`,
      status: "settled",
    })
    const response =
      long && index === 4
        ? longReply
        : `## ${index + 1}. 整页组合记录\n\n${paragraphs[index % paragraphs.length]}\n\n${paragraphs[(index + 1) % paragraphs.length]}\n\n**本轮要点**\n\n1. 原输入与同轮回复保持对应。\n2. 服务快照与草稿分开。\n3. 当前下一稿独立保留。`
    messages.push({
      id: `${runId}-answer`,
      entryId: `${runId}-answer`,
      userTurnId: userId,
      runId,
      historyIndex: messages.length,
      role: "assistant",
      text: response,
      blocks: [
        { id: `${runId}-text`, type: "text", text: response, phase: "settled" },
      ],
      time: `2026-10-08T08:${String(index * 2 + 1).padStart(2, "0")}:00.000Z`,
      model: "整页示例模型",
      status: "settled",
      stopReason: "stop",
      forkable: true,
    })
  })
  return messages
}

function runningMessages(sessionId: string): ConversationChatMessage[] {
  return [
    {
      id: `${sessionId}-user-0`,
      entryId: `${sessionId}-user-0`,
      role: "user",
      text: "运行中继续提出下一项需求。",
      time: STAMP,
      status: "settled",
      historyIndex: 0,
    },
    {
      id: `${sessionId}-answer-0`,
      entryId: `${sessionId}-answer-0`,
      role: "assistant",
      text: "正在整理运行中的整页反馈。",
      time: STAMP,
      status: "streaming",
      historyIndex: 1,
      userTurnId: `${sessionId}-user-0`,
      runId: `${sessionId}-previous-run`,
      activeBlockId: `${sessionId}-answer-0-text`,
      blocks: [
        {
          id: `${sessionId}-answer-0-text`,
          type: "text",
          text: "正在整理运行中的整页反馈。",
          phase: "running",
        },
      ],
    },
  ]
}

function otherMessages(sessionId: string): ConversationChatMessage[] {
  return [
    {
      id: `${sessionId}-user-0`,
      entryId: `${sessionId}-user-0`,
      role: "user",
      text: "整理文档目录。",
      time: STAMP,
      status: "settled",
      historyIndex: 0,
    },
    {
      id: `${sessionId}-answer-0`,
      entryId: `${sessionId}-answer-0`,
      role: "assistant",
      text: "可以先从目录结构继续，切换会话不会丢失原会话的草稿与阅读位置。",
      time: STAMP,
      status: "settled",
      historyIndex: 1,
      userTurnId: `${sessionId}-user-0`,
      runId: `${sessionId}-run-0`,
      stopReason: "stop",
      forkable: false,
      blocks: [
        {
          id: `${sessionId}-answer-0-text`,
          type: "text",
          text: "可以先从目录结构继续，切换会话不会丢失原会话的草稿与阅读位置。",
          phase: "settled",
        },
      ],
    },
  ]
}

const lostResponse = () =>
  new RpcTransportError({
    code: "result_unknown",
    summary: "未收到原操作的回应，原内容和下一稿已保留，请核对原请求。",
    recovery: "check",
    severity: "warning",
  })

/** 隔离的整页会话环境：提供源/可切会话与派生会话，写操作明确拒绝，终态由演示控制发布。 */
export function createConversationPageEnvironment(
  scenario: ConversationPageScenario
) {
  const runningScenario = scenario === "page-running"
  const recoveryScenario = scenario === "page-recovery"
  const readyScenario = scenario === "page-ready"
  const sourceId = `catalog-page-source-${crypto.randomUUID()}`
  const derivedId = `catalog-page-derived-${crypto.randomUUID()}`
  const otherId = `${sourceId}-other`
  const cwd = "/catalog/conversation-page"
  const workspaceId = `${sourceId}-workspace`
  let disposed = false
  let readState: PageDriver["readState"] = recoveryScenario
    ? "held"
    : "available"
  let materialSequence = 16
  let approvalSequence = 0
  let nextSendMode: "admit" | "reject" | "unknown" = "admit"
  let failNextQueueRemove = false
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
  const compactOperations = new Map<string, ConversationControlOperation>()
  const forkOperations = new Map<string, ConversationControlOperation>()
  const snapshots = new Map<string, ConversationSnapshot>()

  const nextHistoryIndex = (snapshot: ConversationSnapshot) =>
    Math.max(
      -1,
      ...snapshot.messages.map(
        (message, index) => message.historyIndex ?? index
      ),
      ...(snapshot.compactions ?? []).map((record) => record.historyIndex)
    ) + 1

  const baseSnapshot = (
    sessionId: string,
    title: string,
    messages: ConversationChatMessage[],
    extra: Partial<ConversationSnapshot>
  ): ConversationSnapshot => ({
    id: sessionId,
    title,
    workspaceId,
    cwd,
    version: 1,
    epoch: `${sessionId}-epoch`,
    clientRequestId: `${sessionId}-previous`,
    inputAccepted: true,
    runId: `${sessionId}-previous-run`,
    phase: "completed",
    modelId: "page/demo",
    connectionId: "page",
    providerModelId: "demo",
    thinking: "off",
    error: "",
    messages,
    permission: { sessionId, mode: "workspace", revision: 0 },
    control: {
      busy: false,
      compactDisabledReason: "此场景不演示上下文压缩。",
      forkDisabledReason: "此场景不演示从回复创建分支。",
    },
    contextState: {
      status: "unavailable",
      observedAt: STAMP,
      reason: "此场景不提供真实上下文用量。",
    },
    ...extra,
  })

  const compaction = (sessionId: string): ConversationCompaction => ({
    id: `${sessionId}-compaction-1`,
    time: "2026-10-08T08:07:00.000Z",
    summary:
      "### 整页组合摘要\n\n- **进入**：从首页首条输入或会话列表进入会话。\n- **阅读**：区分原输入、回复、工具结果和材料，定位当前轮次。\n- **继续**：空闲时发送下一稿；审批、压缩与分支各有入口。\n\n这是隔离服务发布的示例摘要，原会话历史仍保留。",
    firstKeptEntryId: `${sessionId}-user-4`,
    firstKeptHistoryIndex: 6,
    tokensBefore: 38400,
    source: "manual",
    historyIndex: 5.5,
  })

  if (runningScenario) {
    snapshots.set(sourceId, {
      ...baseSnapshot(
        sourceId,
        "运行中继续提出需求",
        runningMessages(sourceId),
        {}
      ),
      phase: "running",
      runId: `${sourceId}-previous-run`,
      clientRequestId: `${sourceId}-previous`,
      inputAccepted: true,
      statistics: {
        input: 2870,
        output: 512,
        cacheRead: 16908,
        cacheWrite: 880,
        totalTokens: 21170,
        toolCalls: 1,
        turns: 1,
        steps: 2,
        durationMs: 54300,
        modelDurationMs: 18900,
        outputTokens: 512,
        tokensPerSecond: 27.1,
        cost: 0.0362,
      },
      queue: {
        revision: 0,
        mode: "single",
        paused: false,
        items: [],
        acceptedRequestIds: [],
      },
      control: {
        busy: false,
        compactDisabledReason: "运行中不演示上下文压缩。",
        forkDisabledReason: "运行中不创建分支。",
      },
      runtime: { phase: "responding", updatedAt: new Date().toISOString() },
    })
  } else {
    const sourceTitle =
      scenario === "page-recovery"
        ? "会话恢复与草稿保留讨论"
        : scenario === "page-narrow"
          ? "长内容阅读与窄窗继续"
          : SOURCE_TITLE
    const sourceMessages =
      scenario === "page-narrow"
        ? history(sourceId, true)
        : history(sourceId, false)
    snapshots.set(sourceId, {
      ...baseSnapshot(sourceId, sourceTitle, sourceMessages, {}),
      ...(readyScenario
        ? {
            statistics: {
              input: 7420,
              output: 1820,
              cacheRead: 64120,
              cacheWrite: 3200,
              totalTokens: 75560,
              toolCalls: 3,
              turns: 5,
              steps: 7,
              durationMs: 81200,
              modelDurationMs: 26400,
              outputTokens: 1820,
              tokensPerSecond: 68.9,
              cost: 0.129,
            },
            compactions: [compaction(sourceId)],
            context: {
              usedTokens: 28800,
              contextWindow: 64000,
              source: "pi-context-estimate",
              estimated: true,
              observedAt: STAMP,
            },
            control: {
              busy: false,
              compactDisabledReason: "",
              forkDisabledReason: "",
            },
          }
        : {}),
      ...(recoveryScenario
        ? {
            queue: {
              revision: 0,
              mode: "single",
              paused: true,
              items: [
                {
                  id: `${sourceId}-queued`,
                  clientRequestId: `${sourceId}-queued-request`,
                  text: "稍后补充会话恢复说明。",
                  materials: [],
                  status: "pending" as const,
                  delivery: "followUp" as const,
                  error: "",
                  createdAt: STAMP,
                },
              ],
              acceptedRequestIds: [] as string[],
            },
          }
        : {}),
    })
  }
  snapshots.set(otherId, {
    ...baseSnapshot(otherId, OTHER_TITLE, otherMessages(otherId), {}),
    statistics: {
      input: 420,
      output: 96,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 516,
      toolCalls: 0,
      turns: 1,
      steps: 1,
      durationMs: 4200,
      modelDurationMs: 1600,
      outputTokens: 96,
      tokensPerSecond: 60,
      cost: 0.0009,
    },
  })

  let driver: PageDriver = {
    readState,
    running: runningScenario,
    pending: false,
    unknown: false,
    confirmable: false,
    queueUnknown: false,
    compactActive: false,
    forkStatus: "idle",
    derivedReady: false,
    approvalAnswer: undefined,
  }
  const buildDriver = (): PageDriver => ({
    readState,
    running: [...snapshots.values()].some((value) => value.phase === "running"),
    pending: pending.size > 0,
    pendingKind: pending.values().next().value?.kind,
    unknown: unknownInputs.size > 0,
    confirmable: [...unknownInputs.values()].some((value) => value.confirmable),
    queueUnknown: [...queueReceipts.values()].some(
      (value) => value.state === "unknown"
    ),
    compactActive: [...compactOperations.values()].some((value) =>
      ["running", "cancelling", "unknown"].includes(value.status)
    ),
    forkStatus: [...forkOperations.values()].some(
      (value) => value.status === "unknown"
    )
      ? "unknown"
      : [...forkOperations.values()].some((value) => value.status === "failed")
        ? "failed"
        : forkOperations.size && snapshots.has(derivedId)
          ? "completed"
          : "idle",
    derivedReady: snapshots.has(derivedId) && forkOperations.size > 0,
    approvalPendingSession: approvalReplies.keys().next().value,
    approvalToolSession: approvalTools.keys().next().value,
    approvalAnswer,
  })
  const notify = () => {
    driver = buildDriver()
    listeners.forEach((listener) => listener())
  }
  const owned = (sessionId: string) => {
    if (disposed || !snapshots.has(sessionId))
      throw new Error("此隔离会话已关闭或不存在。")
    return snapshots.get(sessionId)!
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
  const rejectExecution = async (): Promise<never> => {
    throw new RpcRequestRejected("隔离整页示例不执行此操作；当前内容已保留。", {
      code: "catalog_page_read_only",
      summary: "隔离整页示例不执行此操作，当前内容已保留。",
      recovery: "none",
      severity: "warning",
    })
  }
  const sessionMissing = () =>
    new RpcRequestRejected("隔离整页示例中不存在此会话。", {
      code: "catalog_page_missing",
      summary: "隔离整页示例中不存在此会话。",
      recovery: "none",
      severity: "warning",
    })
  const readError = () =>
    Object.assign(new Error("会话记录暂时无法读取。"), {
      issue: {
        code: "conversation_read_failed",
        summary: "会话记录暂时无法读取，已有内容和草稿保留。",
        recovery: "reload",
        severity: "warning",
      },
    })
  const waiters = new Set<{
    sessionId: string
    version: number
    resolve: (value: ConversationSnapshot) => void
    reject: (error: unknown) => void
    cleanup: () => void
  }>()
  const read = (
    sessionId: string,
    signal?: AbortSignal,
    previous?: ConversationSnapshot
  ): Promise<ConversationSnapshot> => {
    signal?.throwIfAborted()
    if (!snapshots.has(sessionId)) return Promise.reject(sessionMissing())
    if (recoveryScenario && sessionId === sourceId && readState === "failed")
      return Promise.reject(readError())
    const snapshot = owned(sessionId)
    if (
      readState !== "held" &&
      (!previous ||
        previous.epoch !== snapshot.epoch ||
        previous.version !== snapshot.version)
    )
      return Promise.resolve(structuredClone(snapshot))
    return new Promise((resolve, reject) => {
      const abort = () => {
        waiters.delete(waiter)
        waiter.cleanup()
        reject(signal?.reason ?? new DOMException("已取消", "AbortError"))
      }
      let heartbeat: ReturnType<typeof setTimeout> | undefined
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
      // A quiet follow still settles; the held/failed recovery wait is manual.
      if (readState === "available") {
        heartbeat = setTimeout(() => {
          waiters.delete(waiter)
          waiter.cleanup()
          resolve(structuredClone(owned(sessionId)))
        }, 1200)
      }
    })
  }
  const service: ConversationService = {
    read: (sessionId, signal) => read(sessionId, signal),
    follow: (sessionId, previous, signal) => read(sessionId, signal, previous),
    send: (input, signal) => {
      signal?.throwIfAborted()
      if (receipts.has(input.clientRequestId))
        return Promise.reject(lostResponse())
      receipts.set(input.clientRequestId, {
        sessionId: input.sessionId,
        clientRequestId: input.clientRequestId,
        state: "unknown",
      })
      const mode =
        recoveryScenario &&
        !unknownInputs.size &&
        (input.sessionId === sourceId || input.sessionId === otherId)
          ? nextSendMode
          : "admit"
      if (mode === "reject") {
        nextSendMode = "admit"
        const issue = {
          code: "catalog_input_rejected",
          summary: "这次输入被明确拒绝，请修正后主动发送；两稿均已保留。",
          recovery: "none" as const,
          severity: "error" as const,
        }
        receipts.set(input.clientRequestId, {
          sessionId: input.sessionId,
          clientRequestId: input.clientRequestId,
          state: "rejected",
          issue,
        })
        notify()
        return Promise.reject(new RpcRequestRejected(issue.summary, issue))
      }
      if (mode === "unknown") {
        nextSendMode = "admit"
        unknownInputs.set(input.clientRequestId, {
          input: structuredClone(input),
          confirmable: false,
        })
        notify()
        return Promise.reject(lostResponse())
      }
      return waitForAdmission(input, "send", signal)
    },
    retry: (input) => {
      const snapshot = owned(input.sessionId)
      if (!["failed", "interrupted"].includes(snapshot.phase)) {
        const issue = {
          code: "catalog_retry_invalid",
          summary: "当前状态不允许继续，请在输入框提出后续需求。",
          recovery: "none" as const,
          severity: "warning" as const,
        }
        return Promise.reject(new RpcRequestRejected(issue.summary, issue))
      }
      receipts.set(input.clientRequestId, {
        sessionId: input.sessionId,
        clientRequestId: input.clientRequestId,
        state: "unknown",
      })
      return waitForAdmission(input, "retry")
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
                  .messages
              : messages,
          snapshot.messages
        ),
      })
      return new Promise((resolve, reject) => {
        stops.set(sessionId, { runId, resolve, reject })
        notify()
      })
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
      publish({
        ...snapshot,
        queue: { ...queue, mode: input.mode, revision: queue.revision + 1 },
      })
      return structuredClone(owned(input.sessionId))
    },
    queueEdit: async (input) => {
      if (!runningScenario && !recoveryScenario) return rejectExecution()
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
      if (!runningScenario && !recoveryScenario) return rejectExecution()
      const snapshot = owned(input.sessionId)
      if (
        input.operationRequestId &&
        queueReceipts.get(input.operationRequestId)?.state === "committed"
      )
        return structuredClone(snapshot)
      if (failNextQueueRemove && input.operationRequestId) {
        failNextQueueRemove = false
        queueReceipts.set(input.operationRequestId, {
          sessionId: input.sessionId,
          operationRequestId: input.operationRequestId,
          operation: "conversationQueueRemove",
          baseRevision: input.revision,
          itemId: input.itemId,
          state: "unknown",
        })
        notify()
        throw lostResponse()
      }
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
              status: "removed" as const,
              editBaseRevision: item.editBaseRevision,
              editRequestId: item.editRequestId,
            },
          ],
        },
      })
      if (input.operationRequestId)
        queueReceipts.set(input.operationRequestId, {
          sessionId: input.sessionId,
          operationRequestId: input.operationRequestId,
          operation: "conversationQueueRemove",
          baseRevision: input.revision,
          revision: queue.revision + 1,
          itemId: input.itemId,
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
      deliverQueued(input.sessionId, input.itemId)
      if (input.operationRequestId)
        queueReceipts.set(input.operationRequestId, {
          sessionId: input.sessionId,
          operationRequestId: input.operationRequestId,
          operation: "conversationQueueDeliver",
          baseRevision: input.revision,
          revision: snapshot.queue!.revision + 1,
          itemId: input.itemId,
          state: "committed",
        })
      return structuredClone(owned(input.sessionId))
    },
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
      modelId: `page/${input.modelId}`,
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
            text: "整页会话已按当前需求整理完成，可以继续输入下一项。",
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
    const text = "继续补充整页会话说明。下一稿仍留在输入框中。"
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

  const setApprovalToolResult = (
    snapshot: ConversationSnapshot,
    request: ConversationApproval,
    allowed: boolean
  ) => ({
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.runId !== request.runId
        ? message
        : {
            ...message,
            blocks: message.blocks?.map((block) =>
              block.type === "tool" && block.tool.id === request.toolCallId
                ? {
                    ...block,
                    tool: {
                      ...block.tool,
                      status: allowed
                        ? ("success" as const)
                        : ("failed" as const),
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
    ),
  })
  const requestApproval = (
    sessionId: string,
    kind: ConversationApproval["kind"] = "tool",
    file = false
  ) => {
    const snapshot = owned(sessionId)
    if (
      !readyScenario ||
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
            : "选择文档格式",
      message:
        kind === "tool"
          ? file
            ? "允许此工具本次访问：/catalog/shared/notes.md"
            : "此操作可访问本机文件与网络。请确认具体内容，允许仅对这一次生效。"
          : kind === "confirm"
            ? "扩展请求生成文档目录说明。"
            : "请选择本次输出的格式。",
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
                      result: "",
                      resultAvailability: "missing",
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
          ? setApprovalToolResult(snapshot, reply.request, false).messages
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
      if (!readyScenario) return rejectExecution()
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
      return new Promise<null>((resolve, reject) => {
        approvalReplies.set(sessionId, {
          request,
          answer,
          resolve: () => resolve(null),
          reject,
        })
        notify()
      })
    },
  }
  const tools: SessionCatalog["tools"] = [
    {
      id: "read",
      name: "读取文件",
      description: "查看指定文件的内容。",
      group: "Pi 内置",
      detail: "隔离整页示例只展示已保存的工具配置，不执行读取。",
      available: true,
      unavailableReason: "",
    },
  ]
  const instructions: SessionCatalog["instructions"] = [
    {
      path: `${cwd}/AGENTS.md`,
      source: "directory",
      content: "整页会话示例：读懂当前结果与进展，并在目标会话中继续工作。",
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
  const extensions: ExtensionService = createExtensionFixtureService()
  const command: ReturnType<typeof createCommandService> = {
    run: rejectExecution,
    read: rejectExecution,
  }
  const controls: ConversationControlService = {
    compact: async (sessionId, operationId, focus) => {
      if (!readyScenario) return rejectExecution()
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
        status: "running",
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
      if (!readyScenario && !recoveryScenario) return rejectExecution()
      signal?.throwIfAborted()
      owned(sessionId)
      const operation = compactOperations.get(operationId)
      if (operation && operation.sessionId !== sessionId)
        return rejectExecution()
      return operation ? structuredClone(operation) : null
    },
    cancel: async (sessionId, operationId) => {
      if (!readyScenario) return rejectExecution()
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
    fork: async (sessionId, operationId, entryId) => {
      if (!readyScenario) return rejectExecution()
      if (sessionId !== sourceId) return rejectExecution()
      const previous = forkOperations.get(operationId)
      if (previous) return structuredClone(previous)
      const anchor = [...snapshots.get(sourceId)!.messages].find(
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
      const now = new Date().toISOString()
      const anchorIndex = [...snapshots.get(sourceId)!.messages].findIndex(
        (message) => message.entryId === entryId
      )
      snapshots.set(derivedId, {
        ...baseSnapshot(
          derivedId,
          DERIVED_TITLE,
          structuredClone(
            [...snapshots.get(sourceId)!.messages].slice(0, anchorIndex + 1)
          ),
          {}
        ),
        clientRequestId: "",
        inputAccepted: false,
        runId: "",
        phase: "idle",
        control: {
          busy: false,
          compactDisabledReason: "派生示例不演示上下文压缩。",
          forkDisabledReason: "派生示例只演示从源回复创建分支。",
        },
        lineage: {
          sourceSessionId: sourceId,
          sourceTitle: SOURCE_TITLE,
          sourceEntryId: entryId,
        },
      })
      const operation: ConversationControlOperation = {
        id: operationId,
        kind: "fork",
        sessionId,
        status: "completed",
        createdAt: now,
        updatedAt: now,
        error: "",
        anchorId: entryId,
        targetSessionId: derivedId,
      }
      forkOperations.set(operationId, operation)
      notify()
      return structuredClone(operation)
    },
  }
  const draftFor = (sessionId: string): HomeDraft => ({
    sessionId,
    workspaceId,
    text: "",
    model: "page/demo",
    thinking: "off",
    materials: [],
    session: { toolIds: ["read"], instructionScope: "directory" },
  })
  return {
    scenario,
    sourceId,
    derivedId,
    otherId,
    sourceTitle: SOURCE_TITLE,
    derivedTitle: DERIVED_TITLE,
    cwd,
    workspaceId,
    service,
    session,
    permission,
    materials,
    extensions,
    command,
    controls,
    tools,
    draftFor,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getDriver: () => driver,
    failRead() {
      if (!recoveryScenario || readState !== "held") return
      readState = "failed"
      for (const waiter of [...waiters]) {
        waiters.delete(waiter)
        waiter.cleanup()
        waiter.reject(readError())
      }
      notify()
    },
    recoverRead() {
      if (!recoveryScenario) return
      readState = "available"
      for (const waiter of [...waiters]) {
        waiters.delete(waiter)
        waiter.cleanup()
        waiter.resolve(structuredClone(owned(sourceId)))
      }
      notify()
    },
    armRejectSend() {
      nextSendMode = "reject"
      notify()
    },
    armUnknownSend() {
      nextSendMode = "unknown"
      notify()
    },
    allowOriginalReceipt() {
      for (const value of unknownInputs.values()) value.confirmable = true
      notify()
    },
    armQueueRemoveUnknown() {
      failNextQueueRemove = true
      notify()
    },
    confirmQueueReceipt() {
      for (const [requestId, receipt] of queueReceipts) {
        if (receipt.state !== "unknown") continue
        const snapshot = owned(receipt.sessionId)
        const queue = snapshot.queue!
        queueReceipts.set(requestId, {
          ...receipt,
          state: "committed",
          revision: queue.revision,
        })
        if (receipt.operation === "conversationQueueRemove" && receipt.itemId)
          publish({
            ...snapshot,
            queue: {
              ...queue,
              revision: queue.revision + 1,
              items: queue.items.filter((item) => item.id !== receipt.itemId),
              retiredItems: [
                ...(queue.retiredItems ?? []),
                {
                  id: receipt.itemId,
                  clientRequestId: receipt.itemId,
                  status: "removed" as const,
                },
              ],
            },
          })
      }
      notify()
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
          messages: setApprovalToolResult(snapshot, request, true).messages,
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
                  .messages
              : messages,
          snapshot.messages
        ),
      })
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
          "### 整页会话摘要\n\n- **用途**：说明整页会话解决的问题。\n- **组合**：头部、消息流、输入区与恢复入口。\n- **继续**：审批、压缩与分支各有入口。\n\n这是隔离服务发布的示例摘要，原会话历史仍保留。",
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
    showContextReading(sessionId: string, present: boolean) {
      const snapshot = owned(sessionId)
      publish({
        ...snapshot,
        context: present
          ? {
              usedTokens: 28800,
              contextWindow: 64000,
              source: "pi-context-estimate",
              estimated: true,
              observedAt: STAMP,
            }
          : undefined,
        contextState: present
          ? undefined
          : {
              status: "unavailable",
              observedAt: STAMP,
              reason: "当前没有已记录的上下文用量。",
            },
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
      forkOperations.clear()
    },
  }
}
