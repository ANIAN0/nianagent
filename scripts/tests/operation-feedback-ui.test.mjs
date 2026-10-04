import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server,
  cache,
  OperationFeedback,
  ConversationOperationFeedback,
  LiveConversationView,
  QueueDock,
  TooltipProvider,
  useLiveConversation,
  store,
  feedbackFromError,
  RpcRequestRejected,
  RpcTransportError
let RecoveryAction

test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-operation-feedback-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ OperationFeedback } = await server.ssrLoadModule(
    "/src/components/feedback/operation-feedback.tsx",
  ))
  ;({ ConversationOperationFeedback } = await server.ssrLoadModule(
    "/src/features/conversation/conversation-operation-feedback.tsx",
  ))
  ;({ RecoveryAction } = await server.ssrLoadModule(
    "/src/components/feedback/recovery-action.tsx",
  ))
  ;({ LiveConversationView } = await server.ssrLoadModule(
    "/src/features/conversation/live-conversation-view.tsx",
  ))
  ;({ QueueDock } = await server.ssrLoadModule(
    "/src/features/conversation/composer/queue-dock.tsx",
  ))
  ;({ TooltipProvider } = await server.ssrLoadModule(
    "/src/components/ui/tooltip.tsx",
  ))
  ;({ useLiveConversation } = await server.ssrLoadModule(
    "/src/features/conversation/use-live-conversation.ts",
  ))
  store = await server.ssrLoadModule(
    "/src/features/conversation/conversation-draft-store.ts",
  )
  ;({ feedbackFromError } = await server.ssrLoadModule(
    "/src/lib/operation-issue.ts",
  ))
  ;({ RpcRequestRejected, RpcTransportError } = await server.ssrLoadModule(
    "/src/features/models/model-service.ts",
  ))
})

test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-operation-feedback-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// React performs the actual SSR render and owns hook refs. These tests do not
// execute effects, simulate a DOM click, prove reactive rerenders or validate
// generated Tailwind styles. Browser acceptance must cover those boundaries.
function storageFixture(t) {
  const values = new Map()
  const writes = []
  let fault = () => false
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes.push(key)
        values.set(key, value)
      },
      removeItem: (key) => {
        if (fault(key)) throw new Error("isolated receipt removal denied")
        values.delete(key)
      },
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  return {
    values,
    writes,
    fault: (next) => {
      fault = next
    },
  }
}

function fetchFixture(t, callback) {
  const previous = globalThis.fetch
  globalThis.fetch = callback
  t.after(() => {
    globalThis.fetch = previous
  })
}

function hook() {
  let chat
  function Probe() {
    chat = useLiveConversation(undefined)
    return null
  }
  renderToString(createElement(Probe))
  return chat
}

function render(Component, props) {
  return renderToString(
    createElement(TooltipProvider, null, createElement(Component, props)),
  )
}

function count(html, text) {
  return html.split(text).length - 1
}

function button(html, label) {
  const tag = [...html.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(`aria-label="${label}"`))
  assert.ok(tag, `Missing actual button: ${label}`)
  return tag
}

function disabled(html, label) {
  assert.match(button(html, label), /\bdisabled(?:=|\s|>)/)
}

const sessionId = "feedback-session"
const draft = {
  sessionId,
  workspaceId: "workspace",
  text: "读取项目说明并总结",
  model: "local/test-model",
  thinking: "关闭",
  materials: [],
  session: { toolIds: [], instructionScope: "all" },
}
const connections = [
  {
    id: "local",
    models: [{ id: "test-model", supportedThinkingLevels: ["off"] }],
  },
]
const data = {
  workspaces: [{ id: "workspace", name: "moon", path: "H:/workspace/moon" }],
  conversations: [],
  models: [draft.model],
  modelThinking: { [draft.model]: ["关闭"] },
  materials: [],
  materialsEnabled: false,
  tools: [],
}
const noop = () => {}

function snapshot(clientRequestId, extra = {}) {
  return {
    id: sessionId,
    workspaceId: draft.workspaceId,
    title: "反馈验收会话",
    cwd: "H:/workspace/moon",
    epoch: "feedback-host",
    version: 1,
    runId: "feedback-run",
    phase: "completed",
    clientRequestId,
    inputAccepted: true,
    connectionId: "local",
    modelId: draft.model,
    providerModelId: "test-model",
    thinking: "off",
    error: "",
    messages: [
      {
        id: "user-entry",
        role: "user",
        status: "settled",
        text: draft.text,
        historyIndex: 0,
      },
    ],
    ...extra,
  }
}

const viewProps = {
  id: sessionId,
  title: "反馈验收会话",
  data,
  draft,
  onChange: noop,
  onSend: noop,
  onStop: noop,
  onContinue: noop,
  onReload: noop,
}
const operationProps = {
  onReload: noop,
  onStop: noop,
  onContinue: noop,
  onSaveDraft: noop,
  onReconcile: noop,
}

test("the formal conversation shows one primary model failure even when the run and message both carry it", (t) => {
  storageFixture(t)
  const issue = {
    code: "model_authentication",
    summary: "模型认证失败，请检查连接凭据。",
    severity: "error",
    recovery: "settings",
    details: "提供方状态：HTTP 401。",
  }
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot("accepted-request", {
      phase: "failed",
      error: issue.summary,
      issue,
      issueEntryId: "assistant-entry",
      messages: [
        ...snapshot("accepted-request").messages,
        {
          id: "assistant-entry",
          entryId: "assistant-entry",
          historyIndex: 1,
          role: "assistant",
          status: "failed",
          text: "",
          issue,
        },
      ],
    }),
  })
  assert.equal(count(html, issue.summary), 1)
  assert.equal(count(html, 'role="alert"'), 1)
  assert.equal(count(html, "本次回复未完成"), 1)
  assert.equal(
    count(html, 'aria-label="Agent 回复"'),
    0,
    "an empty provider failure must not leave a blank assistant row",
  )
  assert.equal(
    count(html, "回复未完成。"),
    0,
    "the structured feedback owns the failure reason",
  )
})

test("a same-code failure in a later run does not hide the previous reply's own issue", (t) => {
  storageFixture(t)
  const issue = {
    code: "model_authentication",
    summary: "模型认证失败，请检查连接凭据。",
    severity: "error",
    recovery: "settings",
  }
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot("later-request", {
      phase: "failed",
      error: issue.summary,
      issue,
      // The later input was accepted, but this run produced no assistant entry.
      // Its run feedback has no authoritative issueEntryId; the older reply
      // retains its separate historical issue despite an identical code.
      messages: [
        ...snapshot("earlier-request").messages,
        {
          id: "earlier-assistant",
          entryId: "earlier-assistant",
          historyIndex: 1,
          role: "assistant",
          status: "failed",
          text: "",
          issue,
        },
        {
          id: "later-user",
          entryId: "later-user",
          historyIndex: 2,
          role: "user",
          status: "settled",
          text: "继续处理这个任务。",
        },
      ],
    }),
  })
  assert.equal(count(html, issue.summary), 2)
  assert.equal(count(html, 'role="alert"'), 2)
  assert.equal(count(html, "此条回复未完成"), 1)
  assert.equal(count(html, "本次回复未完成"), 1)
})

test("read, send, draft and receipt failures retain their separate owners and recovery controls", () => {
  const reasons = [
    "读取失败，保留已显示历史。",
    "所选模型不可用。",
    "草稿写入失败。",
    "本地回执清理失败。",
  ]
  const html = render(ConversationOperationFeedback, {
    ...operationProps,
    readIssue: { code: "read_failed", message: reasons[0], recovery: "reload" },
    actionIssue: {
      action: "send",
      code: "model_selection",
      message: reasons[1],
      recovery: "settings",
    },
    draftError: reasons[2],
    receiptIssue: {
      code: "receipt_cleanup",
      message: reasons[3],
      recovery: "retry",
    },
    onCleanReceipt: noop,
    onOpenSettings: noop,
  })
  for (const reason of reasons) assert.equal(count(html, reason), 1)
  for (const label of [
    "重新读取会话",
    "检查模型设置",
    "重试保存草稿",
    "重试清理回执",
  ])
    assert.equal(count(html, label), 1)
  assert.equal(count(html, 'data-slot="alert-title"'), 4)
})

test("a cancelled formal issue remains neutral and has no retry or destructive recovery", () => {
  const reason = new RpcRequestRejected("已取消本次操作。", {
    code: "cancelled",
    summary: "已取消本次操作。",
    severity: "info",
    recovery: "none",
  })
  const feedback = feedbackFromError(reason)
  assert.equal(feedback.severity, "info")
  for (const action of ["send", "stop", "retry", "reconcile"]) {
    const props = { ...operationProps, actionIssue: { ...feedback, action } }
    const html = render(ConversationOperationFeedback, props)
    assert.match(html, /本次操作已取消/)
    assert.equal(count(html, 'role="status"'), 1)
    assert.doesNotMatch(html, /role="alert"|text-destructive|<button\b/)
    const tree = ConversationOperationFeedback(props)
    const issue = tree.props.children.find(
      (child) => child?.type === OperationFeedback,
    )
    assert.equal(RecoveryAction(issue.props.actions.props), null)
  }
})

test("the retry-unknown button checks the original hook request ID and preserves later edits", async (t) => {
  storageFixture(t)
  store.saveConversationDraft(sessionId, draft)
  const requests = []
  const operations = []
  fetchFixture(t, async (url, options) => {
    operations.push(url)
    const input = JSON.parse(options.body)
    requests.push(input)
    if (requests.length === 1) {
      assert.equal(url, "/api/models/conversationRetry")
      throw new TypeError("isolated lost response")
    }
    if (requests.length === 2) {
      assert.equal(url, "/api/models/conversationReceiptRead")
      assert.deepEqual(input, { sessionId, clientRequestId: requests[0].clientRequestId })
      return Response.json({ result: { sessionId, clientRequestId: requests[0].clientRequestId, state: "accepted" } })
    }
    assert.equal(url, "/api/models/conversationRead")
    assert.deepEqual(input, { sessionId })
    return Response.json({ result: snapshot("a-later-accepted-request", { version: 5 }) })
  })
  const chat = hook()
  let failure
  await assert.rejects(chat.retry(sessionId, draft, connections), (error) => {
    failure = feedbackFromError(error)
    return error instanceof RpcTransportError
  })
  const original = store.restoreConversationDrafts().requests.get(sessionId)
  assert.equal(original.id, requests[0].clientRequestId)
  const later = { ...draft, text: "这条后续草稿不能被旧回执清空" }
  chat.change(sessionId, later)
  const props = {
    ...operationProps,
    actionIssue: { ...failure, action: "retry" },
    unconfirmed: !!chat.submissionDraft(sessionId),
    onReconcile: () => chat.reconcile(sessionId),
    onContinue: () => assert.fail("Unknown cannot create a new retry"),
  }
  const html = render(ConversationOperationFeedback, props)
  assert.equal(count(html, "继续请求待确认"), 1)
  assert.equal(count(html, "核对继续请求"), 1)
  assert.doesNotMatch(html, /继续上次回复|核对运行状态/)
  // Invoke the exact callback carried by the formal component's actual action.
  // DOM focus/click dispatch and rerender clearing are separate browser checks.
  const tree = ConversationOperationFeedback(props)
  const feedback = tree.props.children.find(
    (child) =>
      child?.type === OperationFeedback &&
      child.props.title === "继续请求待确认",
  )
  await RecoveryAction(feedback.props.actions.props).props.onClick()
  assert.equal(requests.length, 3)
  assert.deepEqual(requests[1], { sessionId, clientRequestId: original.id })
  assert.deepEqual(requests[2], { sessionId })
  assert.deepEqual(operations.slice(1), ["/api/models/conversationReceiptRead", "/api/models/conversationRead"])
  assert.equal(
    operations.filter((url) => url.endsWith("conversationRetry")).length,
    1,
  )
  assert.equal(chat.submissionDraft(sessionId), undefined)
  assert.equal(store.restoreConversationDrafts().requests.size, 0)
  assert.equal(
    store.restoreConversationDrafts().drafts[sessionId].text,
    later.text,
  )
})

test("saving a draft cannot bypass failed receipt cleanup or send another model request", async (t) => {
  const storage = storageFixture(t)
  storage.fault((key) => key === `moon.chat.request.v1.${sessionId}`)
  store.saveConversationDraft(sessionId, draft)
  const requests = []
  fetchFixture(t, async (url, options) => {
    assert.equal(url, "/api/models/conversationSend")
    const input = JSON.parse(options.body)
    requests.push(input)
    return Response.json({
      result: snapshot(input.clientRequestId, { version: requests.length }),
    })
  })
  const chat = hook()
  await chat.send(sessionId, draft, connections)
  assert.equal(requests.length, 1)
  const originalId = requests[0].clientRequestId
  assert.equal(
    store.restoreConversationDrafts().requests.get(sessionId).id,
    originalId,
  )
  const later = { ...draft, text: "独立的新任务草稿" }
  chat.change(sessionId, later)
  const writesBefore = storage.writes.length
  chat.saveDraft(sessionId)
  assert.ok(storage.writes.length > writesBefore)
  assert.equal(
    store.restoreConversationDrafts().drafts[sessionId].text,
    later.text,
  )
  await assert.rejects(
    chat.send(sessionId, later, connections),
    (error) =>
      error instanceof RpcRequestRejected &&
      error.issue?.code === "receipt_cleanup",
  )
  assert.equal(
    requests.length,
    1,
    "Receipt cleanup failure must not call the backend again",
  )
  assert.equal(
    store.restoreConversationDrafts().requests.get(sessionId).id,
    originalId,
  )
  storage.fault(() => false)
  chat.cleanReceipt(sessionId)
  assert.equal(store.restoreConversationDrafts().requests.size, 0)
  assert.equal(requests.length, 1, "Cleanup retries only local storage")
  await chat.send(sessionId, later, connections)
  assert.equal(requests.length, 2)
  assert.notEqual(requests[1].clientRequestId, originalId)
})

test("receipt cleanup disables send and continue in the formal conversation", (t) => {
  storageFixture(t)
  const issue = {
    code: "model_unavailable",
    summary: "模型服务暂时不可用，请稍后继续。",
    recovery: "retry",
    severity: "error",
  }
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot("accepted-request", { phase: "failed", issue }),
    receiptIssue: {
      code: "receipt_cleanup",
      message: "回执清理未完成。",
      recovery: "retry",
    },
    onCleanReceipt: noop,
  })
  disabled(html, "发送")
  const continueTag = html.match(/<button\b[^>]*>继续上次回复<\/button>/)?.[0]
  assert.ok(continueTag, "The actual continue button remains visible")
  assert.match(continueTag, /\bdisabled(?:=|\s|>)/)
  assert.equal(count(html, "本地回执尚未清理"), 1)
  assert.equal(count(html, "重试清理回执"), 1)
})

for (const kind of ["queue-deliver", "queue-remove"]) {
  test(`${kind} unknown disables every write action on its actual queue row`, () => {
    const html = render(QueueDock, {
      items: [{ id: "queued-item", draft, status: "pending" }],
      running: false,
      issues: {
        [`${kind}:queued-item`]: {
          code: "result_unknown",
          message: "原操作结果尚未确认。",
          recovery: "check",
        },
      },
      onCheck: noop,
      onEdit: () => assert.fail("Unknown row cannot edit"),
      onRemove: () => assert.fail("Unknown row cannot remove"),
      onSendNow: () => assert.fail("Unknown row cannot deliver"),
    })
    disabled(html, "编辑排队消息")
    disabled(html, "发送此消息")
    disabled(html, "删除排队消息")
    assert.equal(count(html, "原操作结果尚未确认。"), 1)
    assert.equal(
      count(html, kind === "queue-deliver" ? "核对交付结果" : "核对移除结果"),
      1,
    )
  })
}

for (const unconfirmed of [false, true])
  test(`an obsolete native host requires restart, pending receipt=${unconfirmed}`, () => {
    const html = render(ConversationOperationFeedback, {
      unconfirmed,
      actionIssue: {
        action: "retry",
        code: "host_version",
        message: "Moon 服务代码已更新，请重启 Moon 后重新读取。",
        severity: "error",
        recovery: "restart",
      },
      onReload: noop,
      onStop: noop,
      onContinue: () => assert.fail("Restart is not another model request"),
      onReconcile: () => assert.fail("Restart precedes checking the old host"),
    })
    assert.equal(count(html, "请重启 Moon 后重新读取"), 1)
    assert.equal(count(html, "继续上次回复"), 0)
    assert.equal(count(html, "核对发送"), 0)
    assert.equal(count(html, "核对继续请求"), 0)
  })

for (const outcome of ["recovered", "exhausted", "another-input"])
  test(`formal attempt feedback distinguishes ${outcome} using authoritative input and run identities`, (t) => {
    storageFixture(t)
    const issue = {
      code: "model_unavailable",
      summary: "模型服务暂时不可用，请稍后继续。",
      recovery: "retry",
      severity: "error",
    }
    const firstUser = {
      ...snapshot("request").messages[0],
      userTurnId: "user-entry",
      runId: "same-run",
    }
    const firstFailure = {
      id: "first-failure",
      entryId: "first-failure",
      role: "assistant",
      userTurnId: firstUser.userTurnId,
      runId: "same-run",
      historyIndex: 1,
      status: "failed",
      stopReason: "error",
      text: "",
      issue,
    }
    const finalReply = {
      id: "final-reply",
      entryId: "final-reply",
      role: "assistant",
      userTurnId:
        outcome === "another-input" ? "another-user" : firstUser.userTurnId,
      runId: outcome === "another-input" ? "another-run" : "same-run",
      historyIndex: 3,
      status: outcome === "exhausted" ? "failed" : "settled",
      stopReason: outcome === "exhausted" ? "error" : "stop",
      text: outcome === "exhausted" ? "" : "已完成本轮回复。",
      ...(outcome === "exhausted" ? { issue } : {}),
    }
    const html = render(LiveConversationView, {
      ...viewProps,
      snapshot: snapshot("request", {
        runId: finalReply.runId,
        phase: outcome === "exhausted" ? "failed" : "completed",
        ...(outcome === "exhausted"
          ? { issue, issueEntryId: finalReply.entryId }
          : {}),
        messages: [
          firstUser,
          firstFailure,
          ...(outcome === "another-input"
            ? [
                {
                  id: "another-user",
                  role: "user",
                  userTurnId: "another-user",
                  runId: "another-run",
                  historyIndex: 2,
                  status: "settled",
                  text: "另外检查下一项。",
                },
              ]
            : []),
          finalReply,
        ],
      }),
    })
    assert.equal(
      count(html, "先前尝试失败，后续已恢复"),
      outcome === "recovered" ? 1 : 0,
    )
    assert.equal(count(html, "此条回复未完成"), outcome === "recovered" ? 0 : 1)
    assert.equal(
      count(html, issue.summary),
      outcome === "exhausted" ? 2 : 1,
      "The original failure reason remains visible",
    )
    assert.equal(
      count(html, 'role="alert"'),
      outcome === "recovered" ? 0 : outcome === "exhausted" ? 2 : 1,
    )
    if (outcome !== "exhausted")
      assert.ok(
        html.includes(finalReply.text),
        "The actual successful reply remains visible",
      )
  })

test("the authoritative current stopped run shows one stop reason and preserves its continuation action", (t) => {
  storageFixture(t)
  const user = {
    ...snapshot("stopped-request").messages[0],
    userTurnId: "user-entry",
    runId: "stopped-run",
  }
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot("stopped-request", {
      phase: "interrupted",
      runId: "stopped-run",
      canContinue: true,
      messages: [
        user,
        {
          id: "stopped-reply",
          entryId: "stopped-reply",
          userTurnId: user.userTurnId,
          runId: "stopped-run",
          role: "assistant",
          historyIndex: 1,
          status: "interrupted",
          stopReason: "aborted",
          text: "已经完成的内容仍然可读。",
        },
      ],
    }),
  })
  assert.equal(count(html, "本次执行已停止，已完成内容保留。"), 1)
  assert.equal(count(html, "继续上次回复"), 1)
  assert.match(html, /已经完成的内容仍然可读/)
})

test("a historical stopped turn retains its own notice when another authoritative run is stopped", (t) => {
  storageFixture(t)
  const firstUser = {
    ...snapshot("old-request").messages[0],
    userTurnId: "user-entry",
    runId: "old-run",
  }
  const html = render(LiveConversationView, {
    ...viewProps,
    snapshot: snapshot("current-request", {
      phase: "interrupted",
      runId: "current-run",
      canContinue: true,
      messages: [
        firstUser,
        {
          id: "old-stop",
          entryId: "old-stop",
          userTurnId: firstUser.userTurnId,
          runId: "old-run",
          role: "assistant",
          historyIndex: 1,
          status: "interrupted",
          stopReason: "aborted",
          text: "历史停止前的内容。",
        },
        {
          id: "new-user",
          entryId: "new-user",
          userTurnId: "new-user",
          runId: "current-run",
          role: "user",
          historyIndex: 2,
          status: "settled",
          text: "开始另一个任务。",
        },
        {
          id: "new-stop",
          entryId: "new-stop",
          userTurnId: "new-user",
          runId: "current-run",
          role: "assistant",
          historyIndex: 3,
          status: "interrupted",
          stopReason: "aborted",
          text: "当前停止前的内容。",
        },
      ],
    }),
  })
  assert.equal(
    count(html, "本次执行已停止，已完成内容保留。"),
    2,
    "one historical notice plus one current canonical feedback",
  )
  assert.equal(count(html, "继续上次回复"), 1)
  assert.match(html, /历史停止前的内容/)
  assert.match(html, /当前停止前的内容/)
})

test("missing or mismatched run identity cannot suppress the stopped history's notice", (t) => {
  storageFixture(t)
  for (const runId of [undefined, "older-run"]) {
    const user = {
      ...snapshot("request").messages[0],
      userTurnId: "user-entry",
    }
    const html = render(LiveConversationView, {
      ...viewProps,
      snapshot: snapshot("request", {
        phase: "interrupted",
        runId: "current-run",
        canContinue: true,
        messages: [
          user,
          {
            id: "unowned-stop",
            role: "assistant",
            userTurnId: user.userTurnId,
            runId,
            historyIndex: 1,
            status: "interrupted",
            stopReason: "aborted",
            text: "旧记录中的内容。",
          },
        ],
      }),
    })
    assert.equal(count(html, "本次执行已停止，已完成内容保留。"), 2)
  }
})
