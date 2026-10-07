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
  ConversationSnapshot,
  SessionCatalog,
  SessionConfiguration,
} from "@/features/models/model-contract.generated"
import type { HomeDraft } from "@/features/home/home-types"

export type ReadingScenario =
  | "multi-turn"
  | "initial-read-recovery"
  | "cached-read-recovery"
  | "long-content"
  | "streaming-history"
  | "return-position"
  | "empty-history"
  | "materials-gallery"
  | "materials-unreadable"

const paragraphs = [
  "先从用户需要找到的内容出发，再决定消息如何组织。原输入保留用户的文字，回复按相同轮次归属，让读者能把问题与回答对上。",
  "阅读历史时，读者已经选择了自己的位置。新内容可以继续到达，但不应因此把正在阅读的段落移出视口。主动回到最新后，再继续跟随回复。",
  "位置包含当前可见内容和相对视口的偏移。离开会话再回来时，仍能接着阅读；整页刷新则重新打开会话，当前设计从最新内容开始。",
  "长回复需要清楚的标题、段落和列表。代码与表格各自在局部横向滚动，阅读区和输入入口不应被长行撑出窗口。",
]

const longReply = [
  "# 会话阅读方案\n\n这份记录整理阅读、定位与返回最新的使用过程。",
  ...Array.from(
    { length: 8 },
    (_, index) =>
      `## ${index + 1}. ${["内容归属", "读者控制", "返回位置", "长内容阅读"][index % 4]}\n\n${paragraphs[index % 4]}\n\n- 保留问题与回复的对应关系。\n- 明确当前位置与最新内容。\n- 恢复操作不清除下一稿。`
  ),
  "## 宽表\n\n| 检查项 | 正常阅读 | 查看历史 | 返回最新 | 离开后返回 | 窄窗口 | 读取失败 | 恢复后 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 用户原输入 | 先从用户需要找到的内容出发，再决定消息如何组织。原输入保留用户的文字，回复按相同轮次归属，让读者能把问题与回答对上；即使说明较长，也可以在单元格内自然换行，完整阅读每一句话。 | 问题与同轮回复仍对应 | 不新增伪造用户消息 | 原内容保持可辨认 | 允许正常换行 | 保留已有内容 | 恢复原会话 |\n| 回复阅读 | 按段落阅读 | 不被新回复抢走位置 | 跟随后续内容增长 | 恢复相同锚点与偏移 | 代码和宽表局部滚动 | 原稿仍可编辑 | 新内容与旧内容明确 |",
  "## 短表\n\n| 区域 | 检查项 | 结果 |\n| --- | --- | --- |\n| 原输入 | 保留文字 | 可阅读 |\n| 下一稿 | 独立保存 | 未发送 |\n| 定位 | 当前轮次 | 可辨认 |",
  "## 代码\n\n```ts\n" +
    [
      "type ReadingPosition = { anchorId: string; offset: number; following: boolean }",
      "const position: ReadingPosition = { anchorId: 'user-turn', offset: -24, following: false }",
      ...Array.from(
        { length: 22 },
        (_, index) =>
          `const checkpoint${index + 1} = { section: 'reading', question: '如何在长会话中保持当前位置并定位对应回复？', completed: ${index % 2 === 0} }`
      ),
      "console.log(position)",
    ].join("\n") +
    "\n```\n\n代码只是供阅读的文本，不在展示环境执行。",
  "## 结束\n\n用户找到目标内容后，可以继续阅读，或通过回到最新消息接着查看进展。",
].join("\n\n")

const sketchPng =
  "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"

function materialsHistory(
  sessionId: string,
  unreadable: boolean
): ConversationChatMessage[] {
  const userId = `${sessionId}-user-1`
  const runId = `${sessionId}-run-1`
  const sketch = {
    id: `${sessionId}-sketch`,
    name: "架构草图.svg",
    kind: "image" as const,
    source: "工作区/docs/架构草图.png",
    materialType: "image" as const,
    bytes: 2325,
  }
  const report = {
    id: `${sessionId}-report`,
    name: "季度接口字段核对非常长的文件名是为了验证截断保留完整入口.md",
    kind: "file" as const,
    source: "工作区/docs/report.md",
    materialType: "file" as const,
    content:
      "# 接口字段核对\n\n- 总量：千分位、无单位\n- 明细：右对齐、token\n",
    bytes: 2048,
  }
  const userText = unreadable
    ? "这两份材料来自旧工作区，源文件已经移走，请确认还能留下什么。"
    : "附上接口草图和核对文档，先看一下材料是否都能打开。"
  return [
    {
      id: userId,
      userTurnId: userId,
      runId,
      historyIndex: 0,
      role: "user",
      text: userText,
      time: "2026-10-06T08:00:00.000Z",
      status: "settled",
      attachments: [sketch, report],
    },
    {
      id: `${runId}-answer`,
      userTurnId: userId,
      runId,
      historyIndex: 1,
      role: "assistant",
      text: unreadable
        ? "草图无法解码、文档内容缺失；来源路径保留在附件上，可据此找回原始文件。"
        : "草图可直接预览，文档可阅读原文；来源路径都在附件上，关闭预览会回到这条消息。",
      blocks: [
        { id: `${runId}-text`, type: "text", text: "", phase: "settled" },
      ],
      time: "2026-10-06T08:01:00.000Z",
      model: "阅读示例模型",
      status: "settled",
      stopReason: "stop",
      forkable: false,
    },
  ]
}

function history(sessionId: string, long: boolean): ConversationChatMessage[] {
  const prompts = [
    "/skill:review 请保留我写下的调用文字，并整理项目阅读目标。",
    "阅读历史时，如何看出问题和回答属于同一轮？",
    "请说明用户上翻后，新内容到达时应该怎样表现。",
    "我离开会话再回来，怎样继续刚才的阅读？",
    "请给出长正文、代码和宽表的阅读检查清单。",
    "汇总本轮内容，并给出接下来需要确认的事项。",
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
      time: `2026-10-06T08:${String(index * 2).padStart(2, "0")}:00.000Z`,
      status: "settled",
    })
    if (index === 1)
      messages.push({
        id: `${runId}-step`,
        userTurnId: userId,
        runId,
        historyIndex: messages.length,
        role: "assistant",
        text: "先区分一次用户输入与回复中的多个步骤，再整理同轮内容。",
        time: "2026-10-06T08:02:10.000Z",
        model: "阅读示例模型",
        status: "settled",
        stopReason: "toolUse",
      })
    const response =
      long && index === 4
        ? longReply
        : `## ${index + 1}. 阅读记录\n\n${paragraphs[index % paragraphs.length]}\n\n${paragraphs[(index + 1) % paragraphs.length]}\n\n**本轮要点**\n\n1. 问题与回复保持对应。\n2. 阅读位置由读者控制。\n3. 当前下一稿独立保留。`
    messages.push({
      id: `${runId}-answer`,
      userTurnId: userId,
      runId,
      historyIndex: messages.length,
      role: "assistant",
      text: response,
      blocks: [
        { id: `${runId}-text`, type: "text", text: response, phase: "settled" },
      ],
      time: `2026-10-06T08:${String(index * 2 + 1).padStart(2, "0")}:00.000Z`,
      model: "阅读示例模型",
      status: "settled",
      stopReason: "stop",
      forkable: false,
    })
  })
  return messages
}

export function createReadingEnvironment(scenario: ReadingScenario) {
  const id = `catalog-reading-${crypto.randomUUID()}`
  const cwd = "/catalog/conversation-reading"
  const workspaceId = `${id}-workspace`
  let snapshot: ConversationSnapshot = {
    id,
    title: "项目阅读与定位讨论",
    workspaceId,
    cwd,
    version: 1,
    epoch: `${id}-epoch`,
    clientRequestId: scenario === "empty-history" ? "" : `${id}-last-input`,
    inputAccepted: scenario !== "empty-history",
    runId: scenario === "empty-history" ? "" : `${id}-run-6`,
    phase: scenario === "empty-history" ? "idle" : "completed",
    modelId: "reading/demo",
    connectionId: "reading",
    providerModelId: "demo",
    thinking: "off",
    error: "",
    statistics: {
      input: 2870,
      output: 512,
      cacheRead: 16908,
      cacheWrite: 880,
      totalTokens: 21170,
      toolCalls: 1,
      durationMs: 54300,
      modelDurationMs: 18900,
      outputTokens: 512,
      tokensPerSecond: 27.1,
      cost: 0.0362,
    },
    messages:
      scenario === "empty-history"
        ? []
        : scenario.startsWith("materials")
          ? materialsHistory(id, scenario === "materials-unreadable")
          : history(id, scenario === "long-content"),
    permission: { sessionId: id, mode: "workspace", revision: 0 },
    control: {
      busy: false,
      compactDisabledReason: "阅读场景不执行上下文压缩。",
      forkDisabledReason: "阅读示例没有可派生的 Pi 记录。",
    },
    contextState: {
      status: "unavailable",
      observedAt: "2026-10-06T08:12:00.000Z",
      reason: "阅读示例不提供真实上下文用量。",
    },
  }
  let readState: "available" | "held" | "failed" =
    scenario === "initial-read-recovery" ? "held" : "available"
  let driver: {
    readState: "available" | "held" | "failed"
    streaming: boolean
    chunks: number
  } = { readState, streaming: false, chunks: 0 }
  let streamSequence = 0
  const listeners = new Set<() => void>()
  const waiters = new Set<{
    version?: number
    resolve: (value: ConversationSnapshot) => void
    reject: (error: unknown) => void
    cleanup: () => void
  }>()
  const rejectExecution = async (): Promise<never> => {
    throw new RpcRequestRejected("阅读场景不执行此操作；当前草稿已保留。", {
      code: "catalog_read_only",
      summary: "阅读场景不执行此操作，当前草稿已保留。",
      recovery: "none",
      severity: "warning",
    })
  }
  const readError = () =>
    Object.assign(new Error("会话记录暂时无法读取。"), {
      issue: {
        code: "conversation_read_failed",
        summary: "会话记录暂时无法读取，已有内容和草稿保留。",
        recovery: "reload",
        severity: "warning",
      },
    })
  const notify = () => {
    driver = {
      readState,
      streaming: snapshot.phase === "running",
      chunks: driver.chunks,
    }
    listeners.forEach((listener) => listener())
  }
  const settle = () => {
    for (const waiter of [...waiters]) {
      if (readState === "held") continue
      if (readState === "available" && waiter.version === snapshot.version)
        continue
      waiters.delete(waiter)
      waiter.cleanup()
      if (readState === "failed") waiter.reject(readError())
      else waiter.resolve(structuredClone(snapshot))
    }
    notify()
  }
  const read = (
    sessionId: string,
    signal?: AbortSignal,
    previous?: ConversationSnapshot
  ): Promise<ConversationSnapshot> => {
    signal?.throwIfAborted()
    if (sessionId !== id) return rejectExecution()
    if (readState === "failed") return Promise.reject(readError())
    if (
      readState === "available" &&
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
      const waiter = {
        version: previous?.version,
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
      description: "查看指定文件的内容。",
      group: "Pi 内置",
      detail: "隔离阅读示例仅展示已保存的工具配置，不执行读取。",
      available: true,
      unavailableReason: "",
    },
  ]
  const instructions: SessionCatalog["instructions"] = [
    {
      path: `${cwd}/AGENTS.md`,
      source: "directory",
      content: "阅读与定位示例：保留用户原输入，让用户控制阅读位置。",
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
    preview: async (_sessionId, id, signal) => {
      signal?.throwIfAborted()
      if (scenario === "materials-gallery" && id.endsWith("-sketch"))
        return {
          id,
          name: "架构草图.svg",
          label: "固定图片",
          source: "工作区/docs/架构草图.png",
          content: "",
          data: sketchPng,
          mimeType: "image/png",
          truncated: false,
        }
      return rejectExecution()
    },
    restore: async (_sessionId, _path, values, signal) => {
      signal?.throwIfAborted()
      return values.map((value) => ({
        ...value,
        type: value.type ?? "file",
        status: "failed",
        source: value.source ?? "",
        error: "阅读场景不读取外部材料，请移除引用。",
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
    thinking: "off",
    materials: [],
    session: { toolIds: ["read"], instructionScope: "directory" },
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
    failRead() {
      readState = "failed"
      settle()
    },
    recoverRead() {
      readState = "available"
      // Recovery also settles a cached follow when the text has not changed.
      snapshot = { ...snapshot, version: snapshot.version + 1 }
      settle()
    },
    startReply() {
      if (snapshot.phase === "running") return
      streamSequence += 1
      const userId = `${id}-stream-user-${streamSequence}`
      const runId = `${id}-stream-run-${streamSequence}`
      snapshot = {
        ...snapshot,
        version: snapshot.version + 1,
        phase: "running",
        runId,
        messages: [
          ...snapshot.messages,
          {
            id: userId,
            userTurnId: userId,
            runId,
            historyIndex: snapshot.messages.length,
            role: "user",
            text: "继续说明如何保持历史阅读位置。",
            status: "settled",
            time: "2026-10-06T08:13:00.000Z",
          },
          {
            id: `${runId}-answer`,
            userTurnId: userId,
            runId,
            historyIndex: snapshot.messages.length + 1,
            role: "assistant",
            text: "正在整理阅读说明。",
            blocks: [
              {
                id: `${runId}-text`,
                type: "text",
                text: "正在整理阅读说明。",
                phase: "running",
              },
            ],
            status: "streaming",
            model: "阅读示例模型",
            time: "2026-10-06T08:13:01.000Z",
          },
        ],
      }
      driver = { ...driver, chunks: 0 }
      settle()
    },
    appendReply() {
      if (snapshot.phase !== "running") return
      const tail = snapshot.messages.at(-1)!
      const text = `${tail.text}\n\n### 补充 ${driver.chunks + 1}\n\n${paragraphs.join("\n\n")}`
      snapshot = {
        ...snapshot,
        version: snapshot.version + 1,
        messages: [
          ...snapshot.messages.slice(0, -1),
          {
            ...tail,
            text,
            blocks: [
              {
                id: `${snapshot.runId}-text`,
                type: "text",
                text,
                phase: "running",
              },
            ],
          },
        ],
      }
      driver = { ...driver, chunks: driver.chunks + 1 }
      settle()
    },
    finishReply() {
      if (snapshot.phase !== "running") return
      const tail = snapshot.messages.at(-1)!
      snapshot = {
        ...snapshot,
        version: snapshot.version + 1,
        phase: "completed",
        messages: [
          ...snapshot.messages.slice(0, -1),
          {
            ...tail,
            status: "settled",
            stopReason: "stop",
            blocks: [
              {
                id: `${snapshot.runId}-text`,
                type: "text",
                text: tail.text,
                phase: "settled",
              },
            ],
          },
        ],
      }
      settle()
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
