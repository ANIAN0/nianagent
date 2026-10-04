import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server, cache, useLive, prepare, saveDraft, Echo, LiveView, TooltipProvider
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-continuation-echo-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  ;({ useLiveConversation: useLive } = await server.ssrLoadModule(
    "/src/features/conversation/use-live-conversation.ts"
  ))
  ;({ prepareConversationSubmission: prepare } = await server.ssrLoadModule(
    "/src/features/conversation/conversation-submission.ts"
  ))
  ;({ saveConversationDraft: saveDraft } = await server.ssrLoadModule(
    "/src/features/conversation/conversation-draft-store.ts"
  ))
  ;({ ConversationSubmissionEcho: Echo } = await server.ssrLoadModule(
    "/src/features/conversation/conversation-submission-echo.tsx"
  ))
  ;({ LiveConversationView: LiveView } = await server.ssrLoadModule(
    "/src/features/conversation/live-conversation-view.tsx"
  ))
  ;({ TooltipProvider } = await server.ssrLoadModule(
    "/src/components/ui/tooltip.tsx"
  ))
})
test.after(async () => {
  await server?.close()
  if (!cache) return
  assert.equal(dirname(resolve(cache)), resolve(tmpdir()))
  assert.ok(basename(cache).startsWith("moon-continuation-echo-ui-"))
  assert.equal((await lstat(cache)).isSymbolicLink(), false)
  await rm(cache, { recursive: true, force: true })
})

// Actual hook/service/controller and formal React SSR protect operation ownership.
// These tests do not replace browser focus/portal or real Pi/native acceptance.
const sessionId = "continuation-echo-session"
const nextDraft = {
  sessionId,
  workspaceId: "work",
  text: "停止期间保留的下一稿，不要自动发送。",
  model: "conn/model",
  thinking: "关闭",
  materials: [
    {
      id: "next-material",
      name: "下一稿保留材料.md",
      kind: "附件",
      type: "file",
    },
  ],
  session: { toolIds: [], instructionScope: "none" },
}
const connections = [
  { id: "conn", models: [{ id: "model", supportedThinkingLevels: ["off"] }] },
]
const data = {
  workspaces: [{ id: "work", name: "work", path: "H:/workspace/moon" }],
  conversations: [],
  models: [nextDraft.model],
  modelThinking: { [nextDraft.model]: ["关闭"] },
  materials: [],
  materialsEnabled: false,
  tools: [],
}
const unexpected = () => assert.fail("rendering cannot issue operations")
const baseSnapshot = {
  id: sessionId,
  title: "继续操作归属",
  workspaceId: "work",
  cwd: "H:/workspace/moon",
  epoch: "continuation-host",
  version: 1,
  phase: "interrupted",
  runId: "previous-run",
  clientRequestId: "previous-request",
  inputAccepted: true,
  canContinue: true,
  modelId: nextDraft.model,
  connectionId: "conn",
  providerModelId: "model",
  thinking: "off",
  error: "",
  messages: [],
  context: undefined,
  queue: {
    revision: 1,
    mode: "single",
    paused: true,
    items: [],
    acceptedRequestIds: [],
  },
}

function storage(t) {
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      key: (i) => [...values.keys()][i] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous)
    else delete globalThis.localStorage
  })
  return values
}
function probe() {
  let chat
  function Probe() {
    chat = useLive(undefined)
    return null
  }
  renderToString(createElement(Probe))
  return chat
}
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function echoHtml(chat, pending) {
  const submission = chat.submissionEcho(sessionId)
  return submission
    ? renderToString(
        createElement(Echo, { submission, pending, unconfirmed: true })
      )
    : ""
}
function viewHtml(chat, pending, draft = nextDraft) {
  return renderToString(
    createElement(
      TooltipProvider,
      {},
      createElement(LiveView, {
        id: sessionId,
        title: baseSnapshot.title,
        snapshot: baseSnapshot,
        data,
        draft,
        pending,
        unconfirmed: true,
        pendingSubmission: chat.submissionEcho(sessionId),
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
      })
    )
  )
}
function expectRetryOwnership(chat, pending) {
  const presentation = chat.submissionEcho(sessionId)
  assert.equal(presentation.kind, "retry")
  assert.equal("draft" in presentation, false)
  const html = echoHtml(chat, pending)
  assert.match(html, /继续/)
  assert.match(html, /未随此次继续请求发送/)
  assert.doesNotMatch(
    html,
    /停止期间保留的下一稿|下一稿保留材料\.md|正在确认发送|用户消息/
  )
}

test("prepared continuation restored by the actual hook owns its operation without submitting the next draft", (t) => {
  const saved = storage(t)
  saveDraft(sessionId, nextDraft)
  const prepared = prepare(sessionId, {
    id: "prepared-continuation",
    kind: "retry",
    signature: "retry",
    draft: nextDraft,
    input: {
      sessionId,
      connectionId: "conn",
      modelId: "model",
      thinking: "off",
    },
  })
  assert.deepEqual(prepared.draft, nextDraft)
  const chat = probe()
  expectRetryOwnership(chat, true)
  assert.equal(chat.submissionEcho(sessionId).stage, "prepared")
  assert.deepEqual(
    JSON.parse(saved.get(`moon.chat.draft.v1.${sessionId}`)),
    nextDraft
  )
  const html = viewHtml(chat, true)
  assert.match(html, /停止期间保留的下一稿，不要自动发送。/)
  assert.match(html, /正在请求继续回复/)
  assert.match(html, /继续请求待确认/)
  assert.doesNotMatch(html, /正在确认发送|aria-label="用户消息"/)
})

test(
  "waiting actual continuation RPC contains no next text or materials and renders the correct owner",
  { timeout: 8000 },
  async (t) => {
    const saved = storage(t),
      entered = deferred(),
      reply = deferred(),
      calls = []
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls.push({ url: String(url), input: JSON.parse(options.body) })
      entered.resolve()
      return reply.promise
    })
    const chat = probe()
    chat.change(sessionId, nextDraft)
    const request = chat.retry(sessionId, nextDraft, connections)
    await entered.promise
    assert.match(calls[0].url, /conversationRetry$/)
    assert.deepEqual(Object.keys(calls[0].input).sort(), [
      "clientRequestId",
      "connectionId",
      "modelId",
      "sessionId",
      "thinking",
    ])
    expectRetryOwnership(chat, true)
    assert.match(viewHtml(chat, true), /停止期间保留的下一稿，不要自动发送。/)
    reply.resolve(
      Response.json({
        result: {
          ...baseSnapshot,
          phase: "running",
          clientRequestId: calls[0].input.clientRequestId,
          inputAccepted: true,
        },
      })
    )
    await request
    assert.equal(chat.submissionEcho(sessionId), undefined)
    assert.deepEqual(
      JSON.parse(saved.get(`moon.chat.draft.v1.${sessionId}`)),
      nextDraft
    )
    assert.equal(calls.length, 1)
  }
)

test("lost continuation response and cold recovery never echo or resubmit the next draft", async (t) => {
  const saved = storage(t),
    calls = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), input: JSON.parse(options.body) })
    throw new Error("transport lost")
  })
  const chat = probe()
  chat.change(sessionId, nextDraft)
  await assert.rejects(chat.retry(sessionId, nextDraft, connections))
  expectRetryOwnership(chat, false)
  assert.match(viewHtml(chat, false), /继续请求结果待核对/)
  assert.match(viewHtml(chat, false), /继续请求待确认/)
  const recovered = probe()
  expectRetryOwnership(recovered, false)
  await assert.rejects(
    recovered.retry(sessionId, nextDraft, connections),
    /尚未确认/
  )
  assert.equal(calls.length, 1)
  assert.equal(
    JSON.parse(saved.get(`moon.chat.request.v1.${sessionId}`)).kind,
    "retry"
  )
  assert.deepEqual(
    JSON.parse(saved.get(`moon.chat.draft.v1.${sessionId}`)),
    nextDraft
  )
})

for (const outcome of ["accepted", "rejected"]) {
  test(
    `actual ${outcome} continuation removes its waiting echo and preserves newly edited text and materials`,
    { timeout: 8000 },
    async (t) => {
      const saved = storage(t),
        entered = deferred(),
        reply = deferred(),
        calls = []
      t.mock.method(globalThis, "fetch", async (url, options) => {
        calls.push({ url: String(url), input: JSON.parse(options.body) })
        entered.resolve()
        return reply.promise
      })
      const chat = probe()
      chat.change(sessionId, nextDraft)
      const request = chat.retry(sessionId, nextDraft, connections)
      const rejected =
        outcome === "rejected"
          ? assert.rejects(request, /继续请求被拒绝/)
          : undefined
      await entered.promise
      expectRetryOwnership(chat, true)
      const newer = {
        ...nextDraft,
        text: "继续等待期间编辑的新下一稿",
        materials: [
          ...nextDraft.materials,
          {
            id: "new-file",
            name: "新下一稿材料.md",
            kind: "附件",
            type: "file",
          },
        ],
      }
      chat.change(sessionId, newer)
      reply.resolve(
        outcome === "accepted"
          ? Response.json({
              result: {
                ...baseSnapshot,
                phase: "running",
                clientRequestId: calls[0].input.clientRequestId,
                inputAccepted: true,
              },
            })
          : Response.json({
              error: "继续请求被拒绝。",
              issue: {
                code: "model_selection",
                summary: "继续请求被拒绝。",
                recovery: "settings",
                severity: "error",
              },
            })
      )
      await (rejected ?? request)
      assert.equal(chat.submissionEcho(sessionId), undefined)
      assert.equal(echoHtml(chat, false), "")
      assert.deepEqual(
        JSON.parse(saved.get(`moon.chat.draft.v1.${sessionId}`)),
        newer
      )
      assert.equal(saved.has(`moon.chat.request.v1.${sessionId}`), false)
      assert.equal(calls.length, 1)
      assert.equal("text" in calls[0].input, false)
      assert.equal("materials" in calls[0].input, false)
    }
  )
}

test("send ownership still renders the original submitted content and its sending state", (t) => {
  storage(t)
  prepare(sessionId, {
    id: "send-control",
    kind: "send",
    signature: "send",
    draft: nextDraft,
    input: {
      sessionId,
      workspaceId: "work",
      text: nextDraft.text,
      materials: [],
      connectionId: "conn",
      modelId: "model",
      thinking: "off",
    },
  })
  const chat = probe()
  const html = echoHtml(chat, true)
  assert.equal(chat.submissionEcho(sessionId).kind, "send")
  assert.match(html, /停止期间保留的下一稿，不要自动发送。/)
  assert.match(html, /正在确认发送/)
  assert.doesNotMatch(html, /未随此次继续请求发送/)
})
