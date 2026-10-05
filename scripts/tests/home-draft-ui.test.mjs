import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createElement } from "react"
import { renderToString as renderMarkup } from "react-dom/server"
import { createServer } from "vite"
import react from "@vitejs/plugin-react"

let server,
  cache,
  store,
  HomeComposer,
  TooltipProvider,
  consumeHomeSession,
  useHomeSubmissionNavigation,
  reconcileHomeRequest,
  useLiveConversation,
  RpcRequestRejected
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-home-draft-ui-"))
  server = await createServer({
    configFile: false,
    cacheDir: cache,
    plugins: [react()],
    resolve: { alias: { "@": resolve("src") } },
    server: { middlewareMode: true, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["react", "react-dom/server"] },
  })
  store = await server.ssrLoadModule(
    "/src/features/conversation/conversation-draft-store.ts"
  )
  ;({ HomeComposer } = await server.ssrLoadModule(
    "/src/features/home/home-composer.tsx"
  ))
  ;({ TooltipProvider } = await server.ssrLoadModule(
    "/src/components/ui/tooltip.tsx"
  ))
  ;({ consumeHomeSession } = await server.ssrLoadModule(
    "/src/features/session/session-service.ts"
  ))
  ;({ useHomeSubmissionNavigation } = await server.ssrLoadModule(
    "/src/features/home/use-home-submission-navigation.ts"
  ))
  ;({ reconcileHomeRequest } = await server.ssrLoadModule(
    "/src/features/home/home-submission-recovery.ts"
  ))
  ;({ useLiveConversation } = await server.ssrLoadModule(
    "/src/features/conversation/use-live-conversation.ts"
  ))
  ;({ RpcRequestRejected } = await server.ssrLoadModule(
    "/src/features/models/model-service.ts"
  ))
})
function renderToString(element) {
  return renderMarkup(createElement(TooltipProvider, null, element))
}
test.after(async () => {
  await server?.close()
  await rm(cache, { recursive: true, force: true })
})
function fixture(t) {
  const values = new Map()
  let fault = () => false
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => {
        if (fault("read", key)) throw new Error("read blocked")
        return values.get(key) ?? null
      },
      setItem: (key, value) => {
        if (fault("write", key)) throw new Error("write blocked")
        values.set(key, value)
      },
      removeItem: (key) => {
        if (fault("remove", key)) throw new Error("remove blocked")
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
    fault: (value) => {
      fault = value
    },
  }
}
const draft = {
  workspaceId: "workspace",
  sessionId: "home-session",
  text: "读取参考文件并解释结果",
  materials: [
    {
      id: "fixed-image",
      name: "截图.png",
      kind: "附件",
      type: "image",
      status: "ready",
      source: "粘贴图片",
    },
  ],
  model: "model",
  thinking: "高",
  session: { toolIds: ["read"], instructionScope: "all" },
}
function savedSubmission(original = draft) {
  const submission = store.createHomeSubmission(draft, original)
  store.saveHomeDraft(draft)
  store.saveHomeSubmission(submission)
  return submission
}
test("the official stored identity recognizes raw and resolved thinking without a model catalog", (t) => {
  fixture(t)
  const original = { ...draft, thinking: "中等" }
  const submission = savedSubmission(original)
  const restarted = store.restoreHomeSubmissions()[draft.sessionId]
  assert.deepEqual(restarted, submission)
  assert.equal(store.matchesHomeSubmission(original, restarted), true)
  assert.equal(store.matchesHomeSubmission(draft, restarted), true)
  assert.equal(
    store.matchesHomeSubmission({ ...draft, thinking: "低" }, restarted),
    false
  )
  assert.equal(
    store.matchesHomeSubmission(
      { ...draft, session: { ...draft.session, toolIds: [] } },
      restarted
    ),
    false
  )
})
test("acceptance retains edits and new materials made while the original receipt was delayed", (t) => {
  fixture(t)
  const submission = savedSubmission()
  const changed = {
    ...draft,
    text: "新任务",
    materials: [...draft.materials, { ...draft.materials[0], id: "new-image" }],
  }
  store.saveHomeDraft(changed)
  assert.equal(store.finishHomeSubmission(submission), false)
  const restored = store.restoreHomeDraft(draft.workspaceId)
  assert.equal(restored.text, changed.text)
  assert.deepEqual(restored.materials, changed.materials)
  assert.equal(restored.sessionId, undefined)
  assert.deepEqual(store.restoreHomeSubmissions(), {})
})
test("remove denial updates the accepted draft to empty instead of restoring it as a new send", (t) => {
  const f = fixture(t)
  const submission = savedSubmission()
  f.fault(
    (operation, key) =>
      operation === "remove" && key.startsWith("moon.home.draft.")
  )
  assert.equal(store.finishHomeSubmission(submission), true)
  assert.equal(store.restoreHomeDraft(draft.workspaceId).text, "")
  assert.deepEqual(store.restoreHomeDraft(draft.workspaceId).materials, [])
  assert.deepEqual(store.restoreHomeSubmissions(), {})
})
test("failed accepted cleanup retains the durable identity and can be retried after restart", (t) => {
  const f = fixture(t)
  const submission = savedSubmission()
  let consumed = false
  f.fault(
    (operation, key) =>
      ["write", "remove"].includes(operation) &&
      key.startsWith("moon.home.draft.")
  )
  assert.throws(
    () =>
      store.finishHomeSubmission(submission, () => {
        consumed = true
      }),
    /blocked/
  )
  assert.equal(consumed, false)
  assert.deepEqual(store.restoreHomeSubmissions()[draft.sessionId], submission)
  assert.equal(store.restoreHomeDraft(draft.workspaceId).text, draft.text)
  f.fault(() => false)
  assert.equal(
    store.finishHomeSubmission(store.restoreHomeSubmissions()[draft.sessionId]),
    true
  )
  assert.deepEqual(store.restoreHomeSubmissions(), {})
  assert.deepEqual(store.restoreHomeDraft(draft.workspaceId), {})
})
test("a cleanup read error cannot be mistaken for a missing draft or discard the receipt", (t) => {
  const f = fixture(t)
  const submission = savedSubmission()
  f.fault(
    (operation, key) =>
      operation === "read" && key.startsWith("moon.home.draft.")
  )
  assert.throws(() => store.finishHomeSubmission(submission), /read blocked/)
  assert.deepEqual(store.restoreHomeSubmissions()[draft.sessionId], submission)
})
test("session identity rotation failure keeps the original receipt available for retry", (t) => {
  const f = fixture(t)
  const submission = savedSubmission()
  localStorage.setItem(
    "moon.home-session.v1",
    JSON.stringify({ "/workspace": draft.sessionId })
  )
  f.fault(
    (operation, key) => operation === "write" && key === "moon.home-session.v1"
  )
  assert.throws(
    () =>
      store.finishHomeSubmission(submission, () =>
        consumeHomeSession("/workspace", true)
      ),
    /write blocked/
  )
  assert.equal(
    JSON.parse(localStorage.getItem("moon.home-session.v1"))["/workspace"],
    draft.sessionId
  )
  assert.deepEqual(store.restoreHomeSubmissions()[draft.sessionId], submission)
})
test("legacy raw thinking is preserved when the original raw signature was never recorded", (t) => {
  fixture(t)
  const submission = savedSubmission()
  store.saveHomeDraft({ ...draft, thinking: "中等" })
  assert.equal(store.finishHomeSubmission(submission), false)
  assert.equal(store.restoreHomeDraft(draft.workspaceId).text, draft.text)
  assert.equal(store.restoreHomeDraft(draft.workspaceId).thinking, "中等")
})
test("a legacy draft without identity is retained even when its text and settings exactly match an accepted input", (t) => {
  fixture(t)
  const submission = savedSubmission()
  const legacy = { ...draft, sessionId: undefined }
  store.saveHomeDraft(legacy)
  assert.equal(store.matchesHomeSubmission(legacy, submission), false)
  assert.equal(store.finishHomeSubmission(submission), false)
  assert.equal(store.restoreHomeDraft(draft.workspaceId).text, draft.text)
})
test("the official homepage restores the persisted session ID and blocks new sends pending reconciliation", (t) => {
  fixture(t)
  const html = renderToString(
    createElement(HomeComposer, {
      data: {
        workspaces: [
          { id: draft.workspaceId, name: "工作区", path: "/workspace" },
        ],
        models: [draft.model],
        materials: [],
        tools: [],
      },
      initialDraft: { ...draft, materials: [] },
      unconfirmedSessionIds: [draft.sessionId],
      onCheckSubmission: async () => {},
      onSubmit: () => {
        throw new Error("render must never submit")
      },
    })
  )
  assert.match(html, /原消息的接收结果暂未确认/)
  assert.match(html, /检查发送状态/)
  assert.match(
    html,
    /disabled=""[^>]*aria-label="发送"|aria-label="发送"[^>]*disabled=""/
  )
})
test("the official homepage gives a nonempty legacy draft a fresh identity instead of reusing an old receipt's cwd identity", (t) => {
  fixture(t)
  store.saveHomeDraft({ ...draft, materials: [], sessionId: undefined })
  localStorage.setItem(
    "moon.home-session.v1",
    JSON.stringify({ "/workspace": draft.sessionId })
  )
  const html = renderToString(
    createElement(HomeComposer, {
      data: {
        workspaces: [
          { id: draft.workspaceId, name: "工作区", path: "/workspace" },
        ],
        models: [draft.model],
        materials: [],
        tools: [],
      },
      draftStore: store.persistentHomeDraftStore,
      unconfirmedSessionIds: [draft.sessionId],
      onSubmit: () => "",
    })
  )
  assert.match(html, /读取参考文件并解释结果/)
  assert.equal(html.includes("检查发送状态"), false)
})
test("the official navigation hook prevents a delayed home receipt from navigating after another page was opened", async () => {
  let navigation
  function Probe() {
    navigation = useHomeSubmissionNavigation()
    return null
  }
  renderToString(createElement(Probe))
  const ownsHome = navigation.capture()
  let release
  const receipt = new Promise((resolve) => {
    release = resolve
  })
  let navigated = false
  const waiting = receipt.then(() => {
    if (ownsHome()) navigated = true
  })
  navigation.leave()
  const ownsNewHome = navigation.capture()
  release()
  await waiting
  assert.equal(navigated, false)
  assert.equal(ownsNewHome(), true)
  navigation.leave()
  assert.equal(ownsNewHome(), false)
})
test("accepted cache recovery remounts a reopened homepage while retaining later changes and unrelated sessions", (t) => {
  fixture(t)
  const submission = savedSubmission()
  const accepted = store.acceptHomeDraftCache({ key: 2, draft }, submission)
  assert.equal(accepted.key, 3)
  assert.equal(accepted.draft.text, "")
  assert.deepEqual(accepted.draft.materials, [])
  const changed = { ...draft, text: "保留的新修改" }
  const retained = store.acceptHomeDraftCache(
    { key: 2, draft: changed },
    submission
  )
  assert.equal(retained.key, 3)
  assert.equal(retained.draft.text, changed.text)
  const unrelated = {
    key: 2,
    draft: { ...draft, sessionId: "another-session" },
  }
  assert.equal(store.acceptHomeDraftCache(unrelated, submission), unrelated)
  const alreadyBlank = store.acceptHomeDraftCache(
    { key: 2, draft: { ...draft, text: "", materials: [] } },
    submission
  )
  assert.equal(alreadyBlank.key, 3)
  const html = renderToString(
    createElement(HomeComposer, {
      data: {
        workspaces: [
          { id: draft.workspaceId, name: "工作区", path: "/workspace" },
        ],
        models: [draft.model],
        materials: [],
        tools: [],
      },
      initialDraft: accepted.draft,
      draftStore: store.persistentHomeDraftStore,
      onSubmit: () => "",
    })
  )
  assert.equal(html.includes(draft.text), false)
})
test("a late accepted cleanup cannot consume a newer homepage session identity", (t) => {
  fixture(t)
  localStorage.setItem(
    "moon.home-session.v1",
    JSON.stringify({ "/workspace": "newer-session" })
  )
  consumeHomeSession("/workspace", true, "older-session")
  assert.equal(
    JSON.parse(localStorage.getItem("moon.home-session.v1"))["/workspace"],
    "newer-session"
  )
})
test("a newly generated identity is attached to the persisted draft before a same-text old receipt can be cleaned", (t) => {
  const f = fixture(t)
  const submission = savedSubmission()
  f.fault(
    (operation, key) =>
      operation === "remove" && key.startsWith("moon.home.submission.")
  )
  assert.throws(() => store.finishHomeSubmission(submission), /blocked/)
  const next = store.bindHomeDraftIdentity(
    { ...draft, sessionId: undefined },
    () => "next-home"
  )
  assert.equal(next.sessionId, "next-home")
  assert.equal(
    store.bindHomeDraftIdentity(next, () => {
      throw new Error("must reuse identity")
    }),
    next
  )
  store.saveHomeDraft(next)
  f.fault(() => false)
  const restarted = store.restoreHomeSubmissions()[draft.sessionId]
  assert.equal(store.finishHomeSubmission(restarted), false)
  assert.deepEqual(store.restoreHomeDraft(draft.workspaceId), next)
  const cache = { key: 10, draft: next }
  assert.equal(store.acceptHomeDraftCache(cache, restarted), cache)
})

test("a definitively unaccepted terminal receipt removes the home marker while retaining the exact draft", async (t) => {
  fixture(t)
  const submission = savedSubmission()
  const snapshot = {
    id: draft.sessionId,
    inputAccepted: false,
    phase: "failed",
    error: "工具未准备",
  }
  const chat = {
    submissionDraft: () => undefined,
    reconcile: async () => snapshot,
  }
  const result = await reconcileHomeRequest(
    () => chat.reconcile(draft.sessionId),
    () => store.removeHomeSubmission(draft.sessionId),
    () => assert.fail("cleanup should succeed")
  )
  assert.equal(result, snapshot)
  assert.deepEqual(store.restoreHomeSubmissions(), {})
  assert.deepEqual(store.restoreHomeDraft(draft.workspaceId), draft)
})
test("the official hook checks the original send by readonly receipt lookup and retains it when lookup fails", async (t) => {
  fixture(t)
  const submission = savedSubmission()
  store.saveConversationRequest(draft.sessionId, {
    kind: "send",
    stage: "sending",
    id: "original-client-request",
    signature: "stored-original",
    draft,
    input: {
      sessionId: draft.sessionId,
      workspaceId: draft.workspaceId,
      text: draft.text,
      materials: [],
      connectionId: "connection",
      modelId: "model",
      thinking: "high",
    },
  })
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(url, "/api/models/conversationReceiptRead")
    assert.deepEqual(JSON.parse(options.body), {
      sessionId: draft.sessionId,
      clientRequestId: "original-client-request",
    })
    return Response.json({ error: "发送回执读取失败" })
  }
  let chat
  function Probe() {
    chat = useLiveConversation(undefined)
    return null
  }
  renderToString(createElement(Probe))
  await assert.rejects(
    reconcileHomeRequest(
      () => chat.reconcile(draft.sessionId),
      () => assert.fail("read rejection must not forget a send"),
      () => assert.fail("must not attempt cleanup"),
      true
    ),
    RpcRequestRejected
  )
  assert.equal(calls, 1)
  assert.equal(
    chat.submissionRequestId(draft.sessionId),
    "original-client-request"
  )
  assert.equal(
    store.restoreConversationDrafts().requests.get(draft.sessionId).id,
    "original-client-request"
  )
  assert.deepEqual(store.restoreHomeSubmissions()[draft.sessionId], submission)
})

test("the official hook's rejected history read preserves the original home identity instead of permitting a duplicate send", async (t) => {
  fixture(t)
  const submission = savedSubmission()
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/models/conversationRead")
    return Response.json({ error: "会话历史读取失败" })
  }
  let chat
  function Probe() {
    chat = useLiveConversation(undefined)
    return null
  }
  renderToString(createElement(Probe))
  const replaying = !!chat.submissionDraft(draft.sessionId)
  assert.equal(replaying, false)
  await assert.rejects(
    reconcileHomeRequest(
      () => chat.reconcile(draft.sessionId),
      () => assert.fail("history read failure is not a rejected send"),
      () => assert.fail("must not attempt cleanup"),
      replaying
    ),
    RpcRequestRejected
  )
  assert.deepEqual(store.restoreHomeSubmissions()[draft.sessionId], submission)
  assert.deepEqual(store.restoreHomeDraft(draft.workspaceId), draft)
})
test("unknown and active receipts cannot unlock another send, while cleanup denial exposes a retryable rejected marker", async (t) => {
  const f = fixture(t)
  savedSubmission()
  for (const phase of ["running", "stopping", "idle"]) {
    await reconcileHomeRequest(
      async () => ({ inputAccepted: false, phase }),
      () => assert.fail("must retain unknown identity"),
      () => assert.fail("must not clean")
    )
  }
  await assert.rejects(
    reconcileHomeRequest(
      async () => {
        throw new Error("transport lost")
      },
      () => assert.fail("unknown transport is not rejection"),
      () => assert.fail("must not clean")
    ),
    /transport lost/
  )
  f.fault(
    (operation, key) =>
      operation === "remove" && key.startsWith("moon.home.submission.")
  )
  let cleanupFailed = false
  await reconcileHomeRequest(
    async () => ({ inputAccepted: false, phase: "interrupted" }),
    () => store.removeHomeSubmission(draft.sessionId),
    () => {
      cleanupFailed = true
    }
  )
  assert.equal(cleanupFailed, true)
  assert.ok(store.restoreHomeSubmissions()[draft.sessionId])
  assert.deepEqual(store.restoreHomeDraft(draft.workspaceId), draft)
  f.fault(() => false)
  store.removeHomeSubmission(draft.sessionId)
  assert.deepEqual(store.restoreHomeSubmissions(), {})
})
