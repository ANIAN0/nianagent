import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement, isValidElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server,
  cache,
  LiveConversationView,
  ConversationOperationFeedback,
  CompactDialog,
  OperationFeedback,
  RecoveryAction,
  Button,
  TooltipProvider
let QueueOperationRecovery

test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-mutation-boundary-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ LiveConversationView } = await server.ssrLoadModule(
    "/src/features/conversation/live-conversation-view.tsx"
  ))
  ;({ ConversationOperationFeedback } = await server.ssrLoadModule(
    "/src/features/conversation/conversation-operation-feedback.tsx"
  ))
  ;({ CompactDialog } = await server.ssrLoadModule(
    "/src/features/conversation/controls/compact-dialog.tsx"
  ))
  ;({ OperationFeedback } = await server.ssrLoadModule(
    "/src/components/feedback/operation-feedback.tsx"
  ))
  ;({ RecoveryAction } = await server.ssrLoadModule(
    "/src/components/feedback/recovery-action.tsx"
  ))
  ;({ Button } = await server.ssrLoadModule("/src/components/ui/button.tsx"))
  ;({ TooltipProvider } = await server.ssrLoadModule(
    "/src/components/ui/tooltip.tsx"
  ))
  ;({ QueueOperationRecovery } = await server.ssrLoadModule(
    "/src/features/conversation/composer/queue-operation-recovery.tsx"
  ))
})

test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-mutation-boundary-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// These checks use formal components and actual React SSR. They protect the
// rendered admission boundary, and invoke the exact recovery callbacks carried
// by the formal action. They do not simulate effects, portal DOM interaction,
// keyboard/focus behavior, reactive rerenders, native IPC or real Pi execution.
// Those remain required browser/native acceptance paths.
const unexpected = () => assert.fail("rendering must not perform an operation")
const reason = "原请求尚未核对，先核对后才能开始新的写入。"
const stamp = "2026-10-04T09:20:00Z"
const sessionId = "mutation-boundary-session"
const draft = {
  sessionId,
  workspaceId: "workspace",
  text: "这是独立的下一条草稿，必须继续保留。",
  model: "local/model",
  thinking: "关闭",
  materials: [],
  session: { toolIds: [], instructionScope: "all" },
}
const data = {
  workspaces: [{ id: "workspace", name: "moon", path: "H:/workspace/moon" }],
  conversations: [],
  models: [draft.model],
  modelLabels: { [draft.model]: "验收模型" },
  modelThinking: { [draft.model]: ["关闭"] },
  materials: [],
  materialsEnabled: false,
  tools: [],
}
const viewProps = {
  id: sessionId,
  title: "写入与恢复边界",
  data,
  draft,
  controlService: {
    read: unexpected,
    compact: unexpected,
    cancel: unexpected,
    fork: unexpected,
  },
  onChange: unexpected,
  onSend: unexpected,
  onStop: unexpected,
  onContinue: unexpected,
  onReload: unexpected,
  onReconcile: unexpected,
  onQueueEdit: unexpected,
  onQueueRemove: unexpected,
  onQueueDeliver: unexpected,
  onQueueMode: unexpected,
}
const feedbackProps = {
  onReload: unexpected,
  onReconcile: unexpected,
  onStop: unexpected,
  onContinue: unexpected,
  onOpenSettings: unexpected,
  continueDisabledReason: reason,
}

function storage(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const values = new Map()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
}

function snapshot(extra = {}) {
  return {
    id: sessionId,
    title: viewProps.title,
    workspaceId: draft.workspaceId,
    cwd: "H:/workspace/moon",
    version: 1,
    epoch: "boundary-host",
    clientRequestId: "accepted-original",
    inputAccepted: true,
    runId: "boundary-run",
    phase: "completed",
    canContinue: true,
    modelId: draft.model,
    connectionId: "local",
    providerModelId: "model",
    thinking: "off",
    error: "",
    context: { usedTokens: 32000, contextWindow: 128000 },
    queue: {
      revision: 1,
      mode: "single",
      paused: true,
      items: [
        {
          id: "queued-next",
          clientRequestId: "queued-request",
          text: "已有的排队任务",
          materials: [],
          status: "pending",
          delivery: "followUp",
          error: "",
          createdAt: stamp,
        },
      ],
    },
    messages: [
      {
        id: "user-entry",
        entryId: "user-entry",
        userTurnId: "user-entry",
        historyIndex: 0,
        role: "user",
        status: "settled",
        time: stamp,
        text: "原任务",
      },
      {
        id: "assistant-entry",
        entryId: "assistant-entry",
        userTurnId: "user-entry",
        historyIndex: 1,
        runId: "boundary-run",
        role: "assistant",
        status: "settled",
        stopReason: "length",
        forkable: true,
        time: stamp,
        text: "已经生成、仍需继续的内容。",
      },
    ],
    ...extra,
  }
}

function operation(status) {
  return {
    id: `compact-${status}`,
    sessionId,
    kind: "compact",
    status,
    createdAt: stamp,
    updatedAt: stamp,
    focus: "保留任务目标",
    error: "",
  }
}

function render(Component, props) {
  return renderToString(
    createElement(TooltipProvider, null, createElement(Component, props))
  )
}

function buttons(html, label) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((match) => {
      const text = match[2].replace(/<[^>]*>/g, "").trim()
      return match[1].includes(`aria-label="${label}"`) || text === label
    })
    .map((match) => match[0])
}

function expectButton(html, label, disabled) {
  const matches = buttons(html, label)
  assert.equal(matches.length, 1, `Expected one actual ${label} button`)
  assert.equal(/\bdisabled(?:=|\s|>)/.test(matches[0]), disabled, label)
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  return [node, ...elements(node.props.children)]
}

function text(node) {
  if (Array.isArray(node)) return node.map(text).join("")
  if (isValidElement(node)) return text(node.props.children)
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : ""
}

function recoveryButton(props, title) {
  const tree = ConversationOperationFeedback(props)
  const feedback = elements(tree).find(
    (element) =>
      element.type === OperationFeedback &&
      element.props.actions?.type === RecoveryAction &&
      (!title || element.props.title === title)
  )
  assert.ok(feedback, "The formal operation must own its recovery action")
  const action = RecoveryAction(feedback.props.actions.props)
  assert.ok(action && action.type === Button)
  return action
}

test("queue original recovery remains in the complete composer after the item leaves the queue", (t) => {
  storage(t)
  const record = {
    sessionId,
    operationRequestId: "lost-remove",
    operation: "conversationQueueRemove",
    revision: 7,
    itemId: "departed-item",
  }
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot({
      phase: "running",
      queue: { revision: 8, mode: "single", paused: false, items: [] },
    }),
    queueRecoveryReason: reason,
    queueRecoveryRecords: [record],
    queueRecoveryIssuesByRequest: {
      "lost-remove": {
        code: "result_unknown",
        message: "原移除尚未确认。",
        severity: "warning",
        recovery: "check",
      },
    },
    queueOriginalRetryAllowed: { "lost-remove": true },
    onRetryQueueOriginal: unexpected,
  })
  expectButton(html, "停止执行", false)
  expectButton(html, "核对原操作", false)
  expectButton(html, "恢复原操作", false)
  expectButton(html, "消息交付设置，当前逐条交付", true)
  expectButton(html, "上下文已用 25%", false)
  assert.match(html, /原队列操作恢复/)
  assert.match(html, /这是独立的下一条草稿，必须继续保留。/)
})

test("queue recovery returns exactly the allowed original identity and never creates another operation", () => {
  const records = [
    {
      sessionId,
      operationRequestId: "first",
      operation: "conversationQueueMode",
      revision: 7,
      mode: "all",
    },
    {
      sessionId,
      operationRequestId: "second",
      operation: "conversationQueueMode",
      revision: 6,
      mode: "single",
    },
  ]
  const calls = []
  const tree = QueueOperationRecovery({
    records,
    retryAllowed: { second: true },
    onCheck: unexpected,
    onRestore: (record) => calls.push(record),
  })
  const feedbacks = elements(tree).filter(
    (element) => element.type === OperationFeedback
  )
  const actions = feedbacks
    .flatMap((feedback) => elements(feedback.props.actions))
    .filter(
      (element) => element.type === Button && text(element) === "恢复原操作"
    )
  assert.equal(actions.length, 1)
  actions[0].props.onClick()
  assert.deepEqual(calls, [records[1]])
})

for (const readState of ["loading", "error"]) {
  test(`original queue recovery remains reachable while history is ${readState}`, (t) => {
    storage(t)
    const html = render(LiveConversationView, {
      ...viewProps,
      ...(readState === "error"
        ? {
            readIssue: {
              code: "read_failed",
              message: "历史暂时无法读取。",
              recovery: "reload",
            },
          }
        : {}),
      queueRecoveryReason: reason,
      queueRecoveryRecords: [
        {
          sessionId,
          operationRequestId: "cold-mode",
          operation: "conversationQueueMode",
          revision: 7,
          mode: "all",
        },
      ],
    })
    expectButton(html, "核对原操作", false)
    expectButton(html, "发送", true)
    assert.match(html, /这是独立的下一条草稿，必须继续保留。/)
    assert.match(html, /原队列操作恢复/)
  })
}

test("an unconfirmed original locks all new writes and keeps the next draft and read recovery", (t) => {
  storage(t)
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot(),
    unconfirmed: true,
    pendingSubmission: {
      id: "unknown-original",
      kind: "send",
      draft: { ...draft, text: "尚未核对的原消息" },
    },
    actionIssue: {
      action: "send",
      code: "result_unknown",
      message: "尚未确认原消息的接收结果。",
      recovery: "check",
      severity: "warning",
    },
    readIssue: {
      code: "read_failed",
      message: "历史刷新暂时失败，已有内容仍可阅读。",
      recovery: "reload",
      severity: "warning",
    },
  })
  for (const label of [
    "发送",
    "继续回复",
    "在新会话中分支",
    "编辑排队消息",
    "发送此消息",
    "删除排队消息",
    "消息交付设置，当前逐条交付",
    "选择模型，当前为 验收模型 · 关闭",
    "打开会话配置",
  ])
    expectButton(html, label, true)
  expectButton(html, "核对发送", false)
  expectButton(html, "重新读取会话", false)
  expectButton(html, "上下文已用 25%", false)
  assert.match(html, /尚未核对的原消息/)
  assert.match(html, /这是独立的下一条草稿，必须继续保留。/)
  const input = html.match(
    /<div\b[^>]*data-composer-editor[^>]*aria-label="对话消息"[^>]*>/
  )?.[0]
  assert.ok(input, "The next draft stays editable in the actual input")
  assert.doesNotMatch(input, /\sdisabled(?:=|\s|>)/)
  assert.match(input, /contenteditable="true"/i)
})

test("an unknown original still leaves the current run's main Stop available", (t) => {
  storage(t)
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot({
      phase: "running",
      runtime: { phase: "responding", updatedAt: stamp },
    }),
    unconfirmed: true,
  })
  expectButton(html, "停止执行", false)
  assert.equal(buttons(html, "排队发送").length, 0)
  expectButton(html, "立即发送", true)
  expectButton(html, "编辑排队消息", true)
  expectButton(html, "删除排队消息", true)
  expectButton(html, "核对发送", false)
})

for (const [recovery, label] of [
  ["check", "核对交付设置"],
  ["reload", "重新读取交付设置"],
]) {
  test(`an unconfirmed original does not lock ${recovery} for existing delivery and queue results`, (t) => {
    storage(t)
    const html = render(LiveConversationView, {
      ...viewProps,
      snapshot: snapshot(),
      unconfirmed: true,
      queueIssues: {
        mode: {
          code: recovery === "check" ? "result_unknown" : "read_failed",
          message: "交付设置尚未确认。",
          recovery,
          severity: "warning",
        },
        "queue-remove:queued-next": {
          code: "result_unknown",
          message: "这条排队消息的移除结果尚未确认。",
          recovery: "check",
          severity: "warning",
        },
        "queue-deliver:queued-next": {
          code: "result_unknown",
          message: "这条排队消息的交付结果尚未确认。",
          recovery: "check",
          severity: "warning",
        },
      },
    })
    for (const write of ["发送", "编辑排队消息", "发送此消息", "删除排队消息"])
      expectButton(html, write, true)
    for (const read of [label, "核对移除结果", "核对交付结果", "核对发送"])
      expectButton(html, read, false)
  })
}

test("a known queue failure cannot retry a write before the original send is checked", (t) => {
  storage(t)
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot(),
    unconfirmed: true,
    queueIssues: {
      "queue-deliver:queued-next": {
        code: "queue_storage",
        message: "本次交付未完成，原排队消息仍保留。",
        recovery: "retry",
        severity: "error",
      },
    },
  })
  expectButton(html, "重试交付", true)
  expectButton(html, "核对发送", false)
})

test("a definite continue recovery is locked while the original owner remains unresolved", () => {
  const props = {
    ...feedbackProps,
    actionIssue: {
      action: "retry",
      code: "model_unavailable",
      message: "这次继续调用未完成。",
      recovery: "retry",
      severity: "error",
    },
  }
  expectButton(
    render(ConversationOperationFeedback, props),
    "继续上次回复",
    true
  )
  assert.equal(recoveryButton(props).props.disabled, true)
})

for (const [recovery, label] of [
  ["reload", "重新读取会话"],
  ["check", "核对运行状态"],
  ["settings", "检查模型设置"],
]) {
  test(`a continue issue's ${recovery} recovery remains reachable despite the write lock`, () => {
    const calls = []
    const props = {
      ...feedbackProps,
      actionIssue: {
        action: "retry",
        code: recovery === "settings" ? "model_selection" : "state_unavailable",
        message: "先处理所属问题，再继续任务。",
        recovery,
        severity: "error",
      },
      onReload: () => calls.push("read"),
      onOpenSettings: () => calls.push("settings"),
    }
    expectButton(render(ConversationOperationFeedback, props), label, false)
    const action = recoveryButton(props)
    assert.notEqual(action.props.disabled, true)
    action.props.onClick()
    assert.deepEqual(calls, [recovery === "settings" ? "settings" : "read"])
    expectButton(
      render(ConversationOperationFeedback, { ...props, readPending: true }),
      label,
      recovery !== "settings"
    )
  })
}

test("an unknown continue checks its original receipt instead of issuing another continue", () => {
  const calls = []
  const props = {
    ...feedbackProps,
    unconfirmed: true,
    readPending: true,
    actionIssue: {
      action: "retry",
      code: "result_unknown",
      message: "继续请求是否接受尚未确认。",
      recovery: "check",
      severity: "warning",
    },
    onReconcile: () => calls.push("original-receipt"),
  }
  const html = render(ConversationOperationFeedback, props)
  expectButton(html, "核对继续请求", false)
  assert.equal(buttons(html, "继续上次回复").length, 0)
  const action = recoveryButton(props)
  assert.notEqual(action.props.disabled, true)
  action.props.onClick()
  assert.deepEqual(calls, ["original-receipt"])
})

test("retrying Stop stays reachable and never dispatches the continue command", () => {
  const calls = []
  const props = {
    ...feedbackProps,
    readPending: true,
    actionIssue: {
      action: "stop",
      code: "stop_failed",
      message: "停止请求未能确认。",
      recovery: "retry",
      severity: "warning",
    },
    onStop: () => calls.push("stop"),
  }
  expectButton(
    render(ConversationOperationFeedback, props),
    "再次请求停止",
    false
  )
  const action = recoveryButton(props)
  assert.notEqual(action.props.disabled, true)
  action.props.onClick()
  assert.deepEqual(calls, ["stop"])
})

for (const [recovery, stopTitle, stopLabel, stopCall] of [
  ["retry", "停止请求未完成", "再次请求停止", "stop"],
  ["check", "停止结果待确认", "核对运行状态", "read-run"],
]) {
  test(`a Stop ${recovery} issue never hides the original unresolved receipt or owns its error`, () => {
    const calls = []
    const stopReason = "本次停止调用尚未完成，原运行可能仍在继续。"
    const props = {
      ...feedbackProps,
      unconfirmed: true,
      actionIssue: {
        action: "stop",
        code: recovery === "check" ? "result_unknown" : "stop_failed",
        message: stopReason,
        details: "仅属于停止请求的安全诊断。",
        recovery,
        severity: "warning",
      },
      onReconcile: () => calls.push("read-original-receipt"),
      onStop: () => calls.push("stop"),
      onReload: () => calls.push("read-run"),
    }
    const html = render(ConversationOperationFeedback, props)
    expectButton(html, "核对原请求", false)
    expectButton(html, stopLabel, false)
    assert.equal(html.split(stopReason).length - 1, 1)
    const feedbacks = elements(ConversationOperationFeedback(props)).filter(
      (element) => element.type === OperationFeedback
    )
    assert.equal(feedbacks.length, 2)
    const original = feedbacks.find(
      (element) => element.props.title === "原请求接收结果待确认"
    )
    const stop = feedbacks.find((element) => element.props.title === stopTitle)
    assert.ok(original && stop)
    assert.doesNotMatch(original.props.message, /本次停止调用/)
    assert.equal(original.props.details, undefined)
    assert.equal(stop.props.message, stopReason)
    assert.equal(stop.props.details, props.actionIssue.details)
    recoveryButton(props, original.props.title).props.onClick()
    assert.deepEqual(calls, ["read-original-receipt"])
    recoveryButton(props, stopTitle).props.onClick()
    assert.deepEqual(calls, ["read-original-receipt", stopCall])

    // A snapshot read owns its own pending flag. It may lock only the Stop
    // snapshot check, never the original receipt lookup or a Stop retry.
    const reading = render(ConversationOperationFeedback, {
      ...props,
      readPending: true,
    })
    expectButton(reading, "核对原请求", false)
    expectButton(reading, stopLabel, recovery === "check")
  })
}

test("snapshot read pending does not block the separate original receipt owner", () => {
  const props = {
    ...feedbackProps,
    unconfirmed: true,
    readPending: true,
    readIssue: {
      code: "read_failed",
      message: "快照仍在重新读取。",
      recovery: "retry",
      severity: "warning",
    },
  }
  const html = render(ConversationOperationFeedback, props)
  expectButton(html, "重新读取会话", true)
  expectButton(html, "核对发送", false)
})

test("an unrelated snapshot read cannot lock a model settings recovery", () => {
  const html = render(ConversationOperationFeedback, {
    ...feedbackProps,
    readPending: true,
    readIssue: {
      code: "model_selection",
      message: "先检查模型配置。",
      recovery: "settings",
      severity: "error",
    },
  })
  expectButton(html, "检查模型设置", false)
})

for (const status of ["running", "cancelling", "unknown"]) {
  test(`an existing ${status} compaction locks new writes while keeping its own check action`, (t) => {
    storage(t)
    const current = operation(status)
    const html = render(LiveConversationView, {
      ...viewProps,
      snapshot: snapshot({
        control: { busy: status !== "unknown", operation: current },
      }),
    })
    expectButton(html, "发送", true)
    expectButton(html, "在新会话中分支", true)
    expectButton(html, "消息交付设置，当前逐条交付", true)
    expectButton(html, "上下文已用 25%", false)
    assert.doesNotMatch(html, /正在创建分支/)

    // Radix's Dialog portal does not render an interactive DOM during SSR.
    // Read the real CompactDialog JSX action definition, without replacing
    // Dialog, its hook owner, its Button implementation or any callbacks.
    const calls = []
    const tree = CompactDialog({
      open: true,
      title: viewProps.title,
      model: "验收模型",
      messageCount: 2,
      focus: current.focus,
      operation: current,
      pending: false,
      disabledReason: reason,
      onOpenChange: unexpected,
      onFocusChange: unexpected,
      onStart: unexpected,
      onCancel: () => calls.push("cancel-original"),
      onCheck: () => calls.push("check-original"),
    })
    const actions = elements(tree).filter((element) => element.type === Button)
    const check = actions.find((element) => text(element) === "检查压缩状态")
    assert.ok(check, "The existing operation retains its formal check action")
    assert.notEqual(check.props.disabled, true)
    check.props.onClick()
    assert.deepEqual(calls, ["check-original"])
    assert.equal(
      actions.some((element) => /^(开始压缩|重新压缩)$/.test(text(element))),
      false
    )
    const cancel = actions.find((element) => text(element) === "取消压缩")
    if (status === "unknown") assert.equal(cancel, undefined)
    else {
      assert.ok(cancel)
      assert.equal(cancel.props.disabled, status === "cancelling")
      if (status === "running") {
        cancel.props.onClick()
        assert.deepEqual(calls, ["check-original", "cancel-original"])
      }
    }
  })
}
