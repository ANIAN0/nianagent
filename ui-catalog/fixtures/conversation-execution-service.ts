import type { ConversationService } from "@/features/conversation/conversation-service"
import type { ConversationControlService } from "@/features/conversation/controls/conversation-control-service"
import type { createCommandService } from "@/features/conversation/controls/command-service"
import type { PermissionService } from "@/features/conversation/permissions/permission-service"
import type { SessionService } from "@/features/session/session-service"
import type { MaterialService } from "@/features/materials/material-service"
import type { ExtensionService } from "@/features/extensions/extension-service"
import { RpcRequestRejected } from "@/features/models/model-service"
import type {
  ConversationChatMessage,
  ConversationChatTool,
  ConversationSnapshot,
  SessionCatalog,
  SessionConfiguration,
} from "@/features/models/model-contract.generated"
import type { HomeDraft } from "@/features/home/home-types"

export type ExecutionScenario =
  | "execution-journey"
  | "tool-failure"
  | "retry-recovery"
  | "history-missing-results"
  | "text-only"
  | "thinking-only"
  | "long-results"

const longOutput = Array.from(
  { length: 180 },
  (_, index) =>
    `${String(index + 1).padStart(3, "0")} 检查执行记录：保留实际输出、原始参数和发生位置；读取历史时不把缺少结果当作工具未执行，也不自动重新运行。`
).join("\n")
const longDiff = [
  "--- a/src/conversation.ts",
  "+++ b/src/conversation.ts",
  ...Array.from({ length: 32 }, (_, index) =>
    index % 3 === 0
      ? `-const checkpoint${index} = '旧的阅读说明'`
      : `+const checkpoint${index} = '保留用户选择的阅读位置与实际结果'`
  ),
].join("\n")

/** A local service owner publishes data; formal hooks own errors, drafts and projection. */
export function createExecutionEnvironment(scenario: ExecutionScenario) {
  const id = `catalog-execution-${crypto.randomUUID()}`
  const cwd = "/catalog/conversation-execution"
  const workspaceId = `${id}-workspace`
  const runId = `${id}-run`
  const userId = `${id}-user`
  const stepId = `${id}-step`
  const answerId = `${id}-answer`
  const thoughtId = `${stepId}-thought`
  const now = () => new Date().toISOString()
  const baseMessage = {
    userTurnId: userId,
    runId,
    time: "2026-10-06T10:00:00.000Z",
  }
  const assistant = (): ConversationChatMessage => ({
    ...baseMessage,
    id: stepId,
    historyIndex: 1,
    role: "assistant",
    text: "",
    model: "执行示例模型",
    status: "streaming",
    blocks: [],
  })
  let snapshot: ConversationSnapshot = {
    id,
    title: "查看执行过程与真实工具结果",
    workspaceId,
    cwd,
    version: 1,
    epoch: `${id}-epoch`,
    clientRequestId: `${id}-input`,
    inputAccepted: true,
    runId,
    phase: "running",
    modelId: "execution/demo",
    connectionId: "execution",
    providerModelId: "demo",
    thinking: "low",
    error: "",
    runtime: { phase: "responding", updatedAt: now() },
    statistics: {
      input: 3120,
      output: 486,
      cacheRead: 18432,
      cacheWrite: 960,
      totalTokens: 22998,
      toolCalls: 2,
      durationMs: 61200,
      modelDurationMs: 21400,
      outputTokens: 486,
      tokensPerSecond: 22.7,
      cost: 0.0417,
    },
    messages: [
      {
        ...baseMessage,
        id: userId,
        historyIndex: 0,
        role: "user",
        text:
          scenario === "history-missing-results"
            ? "请查看这份历史中工具状态和结果的区别。"
            : "请检查会话的阅读行为，说明依据和实际检查结果。",
        status: "settled",
      },
      assistant(),
    ],
    permission: { sessionId: id, mode: "workspace", revision: 0 },
    control: {
      busy: false,
      compactDisabledReason: "执行展示不进行上下文压缩。",
      forkDisabledReason: "隔离示例没有可派生的 Pi 记录。",
    },
    contextState: {
      status: "unavailable",
      observedAt: now(),
      reason: "执行展示不提供真实上下文用量。",
    },
  }
  let step = 0
  let disposed = false
  let retrying = false
  const listeners = new Set<() => void>()
  const waiters = new Set<{
    version?: number
    resolve: (value: ConversationSnapshot) => void
    reject: (error: unknown) => void
    cleanup: () => void
  }>()
  const rejectExecution = async (): Promise<never> => {
    throw new RpcRequestRejected("隔离执行展示不运行此操作；当前草稿已保留。", {
      code: "catalog_execution_read_only",
      summary: "隔离执行展示不运行此操作，当前草稿已保留。",
      recovery: "none",
      severity: "warning",
    })
  }
  const nextLabel = () => {
    if (snapshot.phase !== "running") return "回复已结束"
    if (scenario === "history-missing-results") return "读取缺结果历史"
    if (scenario === "text-only")
      return ["开始最终回复", "继续生成回复", "结束回复"][step] ?? "回复已结束"
    if (scenario === "thinking-only")
      return ["开始思考", "继续生成思考", "结束回复"][step] ?? "回复已结束"
    return (
      [
        "第一步开始思考",
        "第一步生成回复",
        "开始读取文件",
        "返回读取部分输出",
        "返回读取结果",
        "第二步开始思考",
        "第二步生成回复",
        "开始运行命令",
        "返回命令部分输出",
        "返回命令结果",
        ...(scenario === "long-results"
          ? [
              "第三步开始思考",
              "第三步生成回复",
              "开始修改文件",
              "返回文件修改结果",
              "第四步开始思考",
              "第四步生成回复",
              "开始扩展检查",
              "返回扩展检查结果",
            ]
          : []),
        ...(scenario === "retry-recovery" ? ["开始模型重试"] : []),
        scenario === "retry-recovery"
          ? "恢复回复并开始最终思考"
          : "开始最终思考",
        "开始最终回复",
        "继续生成回复",
        "结束回复",
      ][step] ?? "回复已结束"
    )
  }
  const driverValue = () => {
    const tail = snapshot.messages.at(-1)
    const canFinish =
      scenario === "thinking-only"
        ? step >= 1
        : !!tail &&
          tail.status === "streaming" &&
          (scenario === "text-only" || tail.id === answerId) &&
          !tail.blocks?.some((block) => block.type === "tool") &&
          !!tail.blocks?.some(
            (block) => block.type === "text" && block.phase === "running"
          )
    return {
      step,
      nextLabel: nextLabel(),
      canAdvance: !disposed && snapshot.phase === "running",
      canFinish:
        !disposed && snapshot.phase === "running" && !retrying && canFinish,
      retrying,
    }
  }
  let driver = driverValue()
  const publish = (next: ConversationSnapshot) => {
    if (disposed) return
    snapshot = { ...next, version: snapshot.version + 1 }
    driver = driverValue()
    for (const waiter of [...waiters]) {
      if (waiter.version === snapshot.version) continue
      waiters.delete(waiter)
      waiter.cleanup()
      waiter.resolve(structuredClone(snapshot))
    }
    listeners.forEach((listener) => listener())
  }
  const read = (
    sessionId: string,
    signal?: AbortSignal,
    previous?: ConversationSnapshot
  ): Promise<ConversationSnapshot> => {
    signal?.throwIfAborted()
    if (disposed)
      return Promise.reject(new DOMException("展示已关闭", "AbortError"))
    if (sessionId !== id) return rejectExecution()
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
        version: previous.version,
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
  const tools: SessionCatalog["tools"] = [
    {
      id: "read",
      name: "读取文件",
      description: "读取指定文件的内容。",
      group: "Pi 内置",
      detail: "此示例展示已有数据，不实际读取工作区。",
      available: true,
      unavailableReason: "",
    },
    {
      id: "bash",
      name: "运行命令",
      description: "在会话工作目录执行命令。",
      group: "Pi 内置",
      detail: "输出由演示控制手动发布，不执行命令。",
      available: true,
      unavailableReason: "",
    },
  ]
  const instructions: SessionCatalog["instructions"] = [
    {
      path: `${cwd}/AGENTS.md`,
      source: "directory",
      content:
        "区分真实工具结果、部分输出和结果缺失；不以工具成功代替任务验收。",
    },
  ]
  const session: SessionService = {
    catalog: async (path, signal) => {
      signal?.throwIfAborted()
      return {
        cwd: path,
        tools,
        instructions,
        defaults: { toolIds: ["read", "bash"], instructionScope: "directory" },
      }
    },
    read: async (sessionId, signal) => {
      signal?.throwIfAborted()
      return {
        sessionId,
        cwd,
        revision: 1,
        toolIds: ["read", "bash"],
        effectiveToolIds: ["read", "bash"],
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
        error: "执行展示不读取外部材料，请移除引用。",
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
  const controls: ConversationControlService = {
    compact: rejectExecution,
    read: rejectExecution,
    cancel: rejectExecution,
    fork: rejectExecution,
  }
  const draft: HomeDraft = {
    sessionId: id,
    workspaceId,
    text: "",
    model: snapshot.modelId,
    thinking: "low",
    materials: [],
    session: { toolIds: ["read", "bash"], instructionScope: "directory" },
  }
  const secondId = id + "-step-2"
  const thirdId = id + "-step-3"
  const fourthId = id + "-step-4"
  const toolOwner = (name: "read" | "bash" | "edit" | "custom_check") =>
    name === "read"
      ? stepId
      : name === "bash"
        ? secondId
        : name === "edit"
          ? thirdId
          : fourthId
  const updateMessage = (
    messageId: string,
    update: (message: ConversationChatMessage) => ConversationChatMessage,
    runtime: ConversationSnapshot["runtime"]
  ) => {
    publish({
      ...snapshot,
      runtime,
      messages: snapshot.messages.map((message) =>
        message.id === messageId ? update(message) : message
      ),
    })
  }
  const startThinking = (
    messageId: string,
    historyIndex: number,
    text: string
  ) => {
    const thought = {
      id: messageId + "-thought",
      type: "thinking" as const,
      text,
      phase: "running" as const,
    }
    const existing = snapshot.messages.find(
      (message) => message.id === messageId
    )
    const message: ConversationChatMessage = {
      ...baseMessage,
      id: messageId,
      historyIndex,
      role: "assistant",
      text: "",
      model: "执行示例模型",
      status: "streaming",
      activeBlockId: thought.id,
      blocks: [thought],
    }
    publish({
      ...snapshot,
      runtime: { phase: "responding", updatedAt: now() },
      messages: existing
        ? snapshot.messages.map((value) =>
            value.id === messageId ? message : value
          )
        : [...snapshot.messages, message],
    })
  }
  const generateText = (messageId: string, text: string) => {
    updateMessage(
      messageId,
      (message) => ({
        ...message,
        text,
        activeBlockId: messageId + "-text",
        blocks: [
          ...(message.blocks ?? []).map((block) =>
            block.type === "thinking"
              ? { ...block, phase: "settled" as const }
              : block
          ),
          { id: messageId + "-text", type: "text", text, phase: "running" },
        ],
      }),
      { phase: "responding", updatedAt: now() }
    )
  }
  const toolValue = (
    name: "read" | "bash" | "edit" | "custom_check",
    availability: "missing" | "partial" | "available"
  ): ConversationChatTool => {
    const owner = toolOwner(name)
    const finished = availability === "available"
    const partial = availability === "partial"
    const long = scenario === "long-results"
    const failed = finished && name === "bash" && scenario === "tool-failure"
    const path = long
      ? "src/very-long-directory/conversation/reading/position-and-disclosure-policy.ts"
      : "src/conversation.ts"
    const command = long
      ? "node scripts/check-conversation.mjs --scope reading --report detailed"
      : "node scripts/check-conversation.mjs"
    const tool: ConversationChatTool = {
      id: owner + "-" + name + "-call",
      occurrenceId: owner + "-" + name,
      name,
      source: name === "custom_check" ? "示例扩展" : "Pi 内置",
      status: finished ? (failed ? "failed" : "success") : "running",
      input: JSON.stringify(
        name === "read"
          ? { path, offset: 1, limit: 80 }
          : name === "bash"
            ? { command, timeout: 30 }
            : name === "edit"
              ? {
                  path: "src/conversation.ts",
                  oldText: "旧的阅读说明",
                  newText: "保留用户选择的阅读位置与实际结果",
                }
              : { sections: ["reading", "execution"], report: "text" },
        null,
        2
      ),
      result: "",
      resultAvailability: availability,
    }
    if (name === "read") {
      tool.target = {
        kind: "file",
        path: cwd + "/" + path,
        displayPath: path,
        line: 1,
        lineCount: 80,
      }
      tool.result = finished
        ? long
          ? longOutput
          : "阅读位置按会话保存；用户回到最新后恢复跟随。"
        : partial
          ? "正在读取会话阅读实现…\n已找到位置保存与回到最新入口。"
          : ""
      if (finished && long) {
        tool.resultTruncated = true
        tool.resultLength = 48000
      }
    } else if (name === "bash") {
      tool.target = {
        kind: "command",
        command,
        cwd: long
          ? cwd +
            "/packages/very-long-workspace-name/with-long-execution-directory"
          : cwd,
      }
      tool.result = finished
        ? failed
          ? "检查失败：阅读锚点在结束时被重置。\n请检查位置保存逻辑。"
          : long
            ? longOutput
            : "阅读检查完成\n3 项检查通过；实际页面仍需验收。"
        : partial
          ? "开始检查阅读锚点…\n1 / 3 项完成。"
          : ""
      if (finished) {
        tool.exitCode = failed ? 7 : 0
        tool.durationMs = 1280
      }
    } else if (name === "edit") {
      tool.target = {
        kind: "file",
        path: cwd + "/src/conversation.ts",
        displayPath: "src/conversation.ts",
      }
      if (finished) {
        tool.result = "已更新阅读说明。"
        tool.details = { diff: longDiff, firstChangedLine: 1 }
      }
    } else if (finished) {
      tool.result = "已核对阅读与执行说明，以下保留检查结果。"
      tool.presentation = {
        kind: "catalog-unknown",
        version: 99,
        payload: "{}",
      }
    }
    return tool
  }
  const beginTool = (name: "read" | "bash" | "edit" | "custom_check") => {
    const messageId = toolOwner(name)
    const value = toolValue(name, "missing")
    updateMessage(
      messageId,
      (message) => ({
        ...message,
        status: "settled",
        stopReason: "toolUse",
        activeBlockId: undefined,
        blocks: [
          ...(message.blocks ?? []).map((block) =>
            block.type === "thinking" || block.type === "text"
              ? { ...block, phase: "settled" as const }
              : block
          ),
          { id: value.occurrenceId!, type: "tool", tool: value },
        ],
      }),
      {
        phase: "tool",
        updatedAt: now(),
        toolName: name,
      }
    )
  }
  const updateTool = (
    name: "read" | "bash" | "edit" | "custom_check",
    availability: "missing" | "partial" | "available"
  ) => {
    const owner = toolOwner(name)
    const value = toolValue(name, availability)
    updateMessage(
      owner,
      (message) => {
        const blocks = message.blocks ?? []
        return {
          ...message,
          blocks: blocks.map((block) =>
            block.type === "tool" && block.tool.id === value.id
              ? { ...block, tool: value }
              : block
          ),
        }
      },
      {
        phase: availability === "available" ? "responding" : "tool",
        updatedAt: now(),
        ...(availability === "available" ? {} : { toolName: name }),
      }
    )
  }
  const startFinalThinking = () => {
    retrying = false
    startThinking(
      answerId,
      scenario === "long-results" ? 9 : 5,
      scenario === "tool-failure"
        ? "命令检查返回了失败，需要把原因与已读取的信息放在一起说明。"
        : "结合读取和检查结果，整理还需要确认的事项。"
    )
  }
  const startAnswer = () => {
    generateText(
      answerId,
      scenario === "tool-failure"
        ? "## 检查结论\n\n命令检查返回失败，阅读锚点问题尚未解决。请先核对失败位置，再重新检查。"
        : "## 检查结论\n\n阅读位置按会话保存，回到最新后恢复跟随。命令检查已返回；实际页面表现仍需结合操作确认。"
    )
  }
  const continueAnswer = () => {
    const message = snapshot.messages.find((value) => value.id === answerId)!
    const text =
      message.text +
      "\n\n还需确认结束时的阅读位置，以及窄窗口下长结果是否方便查看。"
    updateMessage(
      answerId,
      (value) => ({
        ...value,
        text,
        blocks: value.blocks?.map((block) =>
          block.type === "text"
            ? { ...block, text, phase: "running" as const }
            : block
        ),
      }),
      { phase: "responding", updatedAt: now() }
    )
  }
  const finishReply = () => {
    if (!driver.canFinish) return
    const tail = snapshot.messages.at(-1)!
    step = scenario === "text-only" || scenario === "thinking-only" ? 3 : 99
    publish({
      ...snapshot,
      phase: "completed",
      runtime: undefined,
      messages: [
        ...snapshot.messages.slice(0, -1),
        {
          ...tail,
          status: "settled",
          stopReason: "stop",
          activeBlockId: undefined,
          blocks: tail.blocks?.map((block) =>
            block.type === "text" || block.type === "thinking"
              ? { ...block, phase: "settled" as const }
              : block
          ),
        },
      ],
    })
  }
  const failReply = () => {
    if (snapshot.phase !== "running") return
    const issue = {
      code: "model_request_failed",
      summary:
        "模型连接在生成最后一段回复时中断，已完成的步骤和工具结果仍保留。",
      details: "隔离执行数据：本次未运行真实模型。\n" + longOutput,
      severity: "error" as const,
      recovery: "retry" as const,
    }
    const tail = snapshot.messages.at(-1)!
    const entryId = `${runId}-terminal-${snapshot.messages.length}`
    const failure: ConversationChatMessage =
      tail.status === "failed"
        ? { ...tail, issue }
        : {
            ...baseMessage,
            id: entryId,
            entryId,
            historyIndex: snapshot.messages.length,
            role: "assistant",
            text: "",
            status: "failed",
            stopReason: "error",
            issue,
          }
    retrying = false
    publish({
      ...snapshot,
      phase: "failed",
      runtime: undefined,
      error: issue.summary,
      issue,
      issueEntryId: failure.entryId,
      canContinue: true,
      messages: [
        ...(failure.id === tail.id
          ? snapshot.messages.slice(0, -1)
          : snapshot.messages),
        failure,
      ],
    })
  }
  const loadMissingHistory = () => {
    const records: ConversationChatTool[] = [
      {
        id: `${id}-unknown`,
        name: "read",
        source: "Pi 内置",
        status: "unknown",
        input: '{"path":"notes.md"}',
        result: "",
        resultAvailability: "missing",
      },
      {
        id: `${id}-returned`,
        name: "bash",
        source: "Pi 内置",
        status: "returned",
        input: '{"command":"node check.mjs"}',
        result: "",
        resultAvailability: "missing",
        exitCode: 0,
        durationMs: 640,
        target: { kind: "command", command: "node check.mjs", cwd },
      },
      {
        id: `${id}-failed`,
        name: "bash",
        source: "Pi 内置",
        status: "failed",
        input: '{"command":"node check.mjs"}',
        result: "",
        resultAvailability: "missing",
        exitCode: 7,
        durationMs: 920,
        target: { kind: "command", command: "node check.mjs", cwd },
      },
      {
        id: `${id}-empty`,
        name: "custom_empty",
        source: "示例扩展",
        status: "success",
        input: "{}",
        result: "",
        resultAvailability: "available",
      },
      {
        id: `${id}-stopped`,
        name: "bash",
        source: "Pi 内置",
        status: "stopped",
        input: '{"command":"node interrupted.mjs"}',
        result: "",
        resultAvailability: "missing",
      },
      {
        id: `${id}-not-run`,
        name: "fixture_not_dispatched",
        source: "明确未分发的隔离示例",
        status: "not-run",
        input: "{}",
        result: "",
        resultAvailability: "missing",
      },
      {
        id: `${id}-legacy`,
        name: "legacy_empty",
        source: "未提供结果可用字段的旧调用方",
        status: "success",
        input: "{}",
        result: "",
      },
    ]
    const value: ConversationChatMessage = {
      ...assistant(),
      status: "settled",
      stopReason: "toolUse",
      blocks: records.map((tool, index) => ({
        id: `${stepId}-history-${index}`,
        type: "tool",
        tool: { ...tool, occurrenceId: `${stepId}-history-${index}` },
      })),
    }
    step = 7
    publish({
      ...snapshot,
      phase: "completed",
      runtime: undefined,
      messages: [
        snapshot.messages[0],
        value,
        {
          ...baseMessage,
          id: answerId,
          historyIndex: 2,
          role: "assistant",
          status: "settled",
          stopReason: "stop",
          text: "缺少工具结果不能证明工具未执行，也不能自动重跑。这里的未执行条目是明确标记的隔离示例；空的真实结果与缺失记录分别表达。",
          model: "执行示例模型",
        },
      ],
    })
  }
  const advance = () => {
    if (!driver.canAdvance) return
    if (scenario === "history-missing-results") return loadMissingHistory()
    if (scenario === "text-only" || scenario === "thinking-only") {
      if (step >= 2) return finishReply()
      step += 1
      const textOnly = scenario === "text-only"
      const text = textOnly
        ? step === 1
          ? "## 阅读说明\n\n阅读位置按会话保存，主动回到最新后继续跟随后续内容。"
          : "## 阅读说明\n\n阅读位置按会话保存，主动回到最新后继续跟随后续内容。\n\n长正文和工具结果仍应分别保持可读。"
        : step === 1
          ? "先确认用户需要的结论，再判断已有信息是否足够。"
          : "先确认用户需要的结论，再判断已有信息是否足够。\n继续检查问题与回答是否对应。"
      const value: ConversationChatMessage = {
        ...snapshot.messages[1],
        text: textOnly ? text : "",
        activeBlockId: textOnly ? stepId + "-text" : thoughtId,
        blocks: textOnly
          ? [{ id: stepId + "-text", type: "text", text, phase: "running" }]
          : [{ id: thoughtId, type: "thinking", text, phase: "running" }],
      }
      return publish({ ...snapshot, messages: [snapshot.messages[0], value] })
    }
    const event = step++
    switch (event) {
      case 0:
        return startThinking(
          stepId,
          1,
          "先读取会话阅读实现，找出位置保存与回到最新的入口。"
        )
      case 1:
        return generateText(
          stepId,
          "我先读取阅读位置的实现，确认离开会话和回到最新时的处理。"
        )
      case 2:
        return beginTool("read")
      case 3:
        return updateTool("read", "partial")
      case 4:
        return updateTool("read", "available")
      case 5:
        return startThinking(
          secondId,
          3,
          "读取结果说明位置按会话保存，接下来检查运行结果与阅读说明。"
        )
      case 6:
        return generateText(
          secondId,
          scenario === "long-results"
            ? "读取结果已拿到。接下来运行检查，更新阅读说明，再核对说明与执行结果。"
            : "读取结果已拿到。接下来运行检查，确认阅读锚点在回复结束时的表现。"
        )
      case 7:
        return beginTool("bash")
      case 8:
        return updateTool("bash", "partial")
      case 9:
        return updateTool("bash", "available")
    }
    if (scenario === "long-results") {
      if (event === 10)
        return startThinking(
          thirdId,
          5,
          "检查结果已返回，接下来把阅读说明补充完整。"
        )
      if (event === 11)
        return generateText(
          thirdId,
          "我会更新阅读说明，写清位置保留和回到最新的行为。"
        )
      if (event === 12) return beginTool("edit")
      if (event === 13) return updateTool("edit", "available")
      if (event === 14)
        return startThinking(
          fourthId,
          7,
          "说明已经更新，再核对它与读取及检查结果是否一致。"
        )
      if (event === 15)
        return generateText(
          fourthId,
          "接下来核对阅读与执行说明，整理仍需要实际操作确认的部分。"
        )
      if (event === 16) return beginTool("custom_check")
      if (event === 17) return updateTool("custom_check", "available")
    }
    const finalEvent = event - (scenario === "long-results" ? 18 : 10)
    if (scenario === "retry-recovery" && finalEvent === 0) {
      retrying = true
      const entryId = `${runId}-retry-attempt-1`
      return publish({
        ...snapshot,
        messages: [
          ...snapshot.messages,
          {
            ...baseMessage,
            id: entryId,
            entryId,
            historyIndex: snapshot.messages.length,
            role: "assistant",
            text: "",
            status: "failed",
            stopReason: "error",
            issue: {
              code: "model_request_failed",
              summary: "模型连接暂时中断，本次尝试没有完成。",
              severity: "error",
              recovery: "retry",
            },
          },
        ],
        runtime: {
          phase: "retrying",
          updatedAt: now(),
          retryAt: new Date(Date.now() + 8000).toISOString(),
          attempt: 1,
          maxAttempts: 3,
          retrySource: "response",
          reason: "隔离示例：模型请求暂时不可用，等待下一次尝试。",
        },
      })
    }
    const action = finalEvent - (scenario === "retry-recovery" ? 1 : 0)
    if (action === 0) return startFinalThinking()
    if (action === 1) return startAnswer()
    if (action === 2) return continueAnswer()
    if (action === 3) return finishReply()
  }
  return {
    id,
    cwd,
    workspaceId,
    draft,
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
    advance,
    finishReply,
    failReply,
    refresh() {
      publish(snapshot)
    },
    dispose() {
      disposed = true
      for (const waiter of waiters) {
        waiter.cleanup()
        waiter.reject(new DOMException("展示已关闭", "AbortError"))
      }
      waiters.clear()
      listeners.clear()
    },
  }
}
