import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, lstat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { createServer } from "vite"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

let server, cache, prepare, resolved, persist, saveRequest, restore, useLive
const original = { workspaceId: "work", text: "original", model: "conn/model", thinking: "关闭", materials: [], session: { toolIds: [], instructionScope: "none" } }
const receipt = () => ({ id: "req-a", kind: "send", signature: "fixed", draft: structuredClone(original), input: { sessionId: "chat-a", workspaceId: "work", text: original.text, materials: [], connectionId: "conn", modelId: "model", thinking: "off" } })
test.before(async () => {
  cache = await mkdtemp(join(tmpdir(), "moon-chat-receipt-"))
  server = await createServer({ configFile: false, cacheDir: cache, resolve: { alias: { "@": resolve("src") } }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, ssr: { external: ["react", "react-dom/server"] } })
  ;({ prepareConversationSubmission: prepare, resolvedConversationDraft: resolved, persistConversationResolution: persist } = await server.ssrLoadModule("/src/features/conversation/conversation-submission.ts"))
  ;({ saveConversationRequest: saveRequest, restoreConversationDrafts: restore } = await server.ssrLoadModule("/src/features/conversation/conversation-draft-store.ts"))
  ;({ useLiveConversation: useLive } = await server.ssrLoadModule("/src/features/conversation/use-live-conversation.ts"))
})
test.after(async () => {
  await server?.close()
  if (cache) { assert.equal(dirname(resolve(cache)), resolve(tmpdir())); assert.ok(basename(cache).startsWith("moon-chat-receipt-")); assert.equal((await lstat(cache)).isSymbolicLink(), false); await rm(cache, { recursive: true, force: true }) }
})
function storage(t, fail = () => false) {
  const values = new Map()
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { length: 0, key: (i) => [...values.keys()][i] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { if (fail(key)) throw new Error("quota"); values.set(key, value) }, removeItem: (key) => { if (fail(key)) throw new Error("quota"); values.delete(key) } } })
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else delete globalThis.localStorage })
  Object.defineProperty(localStorage, "length", { get: () => values.size })
  return values
}
function probe() { let chat; function Probe() { chat = useLive(undefined); return null } renderToString(createElement(Probe)); return chat }
test("before any RPC the immutable original and empty next draft survive reload", (t) => {
  const saved = storage(t)
  const value = prepare("chat-a", receipt())
  assert.equal(value.draft.text, "")
  assert.equal(JSON.parse(saved.get("moon.chat.request.v1.chat-a")).draft.text, "original")
  assert.equal(restore().requests.get("chat-a").followingDraft, true)
  value.draft.text = "next"
  assert.equal(value.submission.draft.text, "original")
})
test("accepted input never clears an identical newly typed next message", (t) => {
  storage(t)
  const { submission } = prepare("chat-a", receipt())
  const next = { ...original, text: "original" }
  assert.equal(resolved("chat-a", submission, "accepted", next).text, "original")
})
test("refusal restores once by request identity and preserves newer input", (t) => {
  storage(t)
  const { submission } = prepare("chat-a", receipt())
  const next = { ...original, text: "next" }
  const recovered = resolved("chat-a", submission, "rejected", next)
  assert.equal(recovered.text, "original\n\nnext")
  assert.deepEqual(resolved("chat-a", submission, "rejected", recovered), recovered)
  assert.equal(resolved("chat-a", { ...submission, id: "req-b" }, "rejected", recovered).text, "original\n\noriginal\n\nnext")
})
test("ACK cannot remove the only receipt if saving the exact next draft fails", (t) => {
  let block = false
  const saved = storage(t, (key) => block && key.startsWith("moon.chat.draft."))
  const { submission } = prepare("chat-a", receipt())
  block = true
  assert.throws(() => persist("chat-a", submission, "accepted", { ...original, text: "newest" }), /quota/)
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), true)
  block = false
  persist("chat-a", submission, "accepted", { ...original, text: "newest" })
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), false)
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "newest")
})
test("receipt serialization preserves the contract payload instead of UI material caches", (t) => {
  const saved = storage(t)
  const input = receipt()
  input.draft.materials = [{ id: "cache", name: "file", kind: "file", thumbnail: "secret-ui-cache" }]
  saveRequest("chat-a", input)
  assert.deepEqual(JSON.parse(saved.get("moon.chat.request.v1.chat-a")).input.materials, [])
  assert.equal(JSON.parse(saved.get("moon.chat.request.v1.chat-a")).draft.materials[0].thumbnail, undefined)
})
test("checking a never-observed request only reads and cannot submit it", async (t) => {
  storage(t)
  saveRequest("chat-a", { ...receipt(), stage: "sending", followingDraft: true })
  const calls = []
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(String(url)); return Response.json({ result: { sessionId: "chat-a", clientRequestId: "req-a", state: "unknown" } }) })
  const chat = probe()
  await assert.rejects(chat.reconcile("chat-a"), /尚未找到/)
  assert.equal(calls.length, 1)
  assert.match(calls[0], /conversationReceiptRead$/)
  assert.equal(chat.submissionRequestId("chat-a"), "req-a")
})

test("a separated receipt with a missing next-draft record never resurrects an accepted original", (t) => {
  storage(t)
  const { submission } = prepare("chat-a", receipt())
  assert.equal(resolved("chat-a", submission, "accepted").text, "")
  assert.equal(resolved("chat-a", submission, "rejected").text, "original")
})

const connections = [{ id: "conn", models: [{ id: "model", supportedThinkingLevels: ["off"] }] }]
test("queue recovery must save its destination before returning and its identity prevents repeated merging", (t) => {
  let block = true
  const saved = storage(t, (key) => block && key.startsWith("moon.chat.draft."))
  const chat = probe()
  const draft = { ...original, text: "queue\n\nnext", homeRecoveryKey: "queue-key" }
  assert.throws(() => chat.adoptRecoveredDraft("chat-a", draft), /quota/)
  assert.equal(saved.has("moon.chat.draft.v1.chat-a"), false)
  block = false
  chat.adoptRecoveredDraft("chat-a", draft)
  chat.change("chat-a", { ...draft, text: "queue\n\nnewer" })
  chat.adoptRecoveredDraft("chat-a", { ...draft, text: "queue\n\nqueue\n\nnewer" })
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "queue\n\nnewer")
})
function deferred() { let resolve; const promise = new Promise((value) => { resolve = value }); return { promise, resolve } }
test("the actual controller separates input before RPC and restores refusal around newer text", { timeout: 8000 }, async (t) => {
  const saved = storage(t)
  const entered = deferred(), reply = deferred()
  let input
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(String(url), /conversationSend$/)
    input = JSON.parse(options.body); entered.resolve(); return reply.promise
  })
  const chat = probe()
  const send = chat.send("chat-a", original, connections)
  const rejected = assert.rejects(send, /拒绝/)
  await entered.promise
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "")
  chat.change("chat-a", { ...original, text: "newer" })
  reply.resolve(Response.json({ error: "明确拒绝" }))
  await rejected
  assert.equal(input.text, "original")
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "original\n\nnewer")
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), false)
})
test("the actual accepted controller keeps its receipt until the in-memory next draft is saved", { timeout: 8000 }, async (t) => {
  let block = false
  const saved = storage(t, (key) => block && key.startsWith("moon.chat.draft."))
  const entered = deferred(), reply = deferred()
  let input, calls = 0
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++; input = JSON.parse(options.body); entered.resolve(); return reply.promise
  })
  const chat = probe()
  const send = chat.send("chat-a", original, connections)
  await entered.promise
  block = true
  chat.change("chat-a", { ...original, text: "newest unsaved" })
  reply.resolve(Response.json({ result: { id: "chat-a", epoch: "e", version: 1, clientRequestId: input.clientRequestId, inputAccepted: true, phase: "completed" } }))
  await send
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), true)
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "")
  block = false
  chat.cleanReceipt("chat-a")
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "newest unsaved")
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), false)
  assert.equal(calls, 1)
})

test("formal rejection restores the original around newer text without resending", async (t) => {
  const saved = storage(t)
  saveRequest("chat-a", { ...receipt(), stage: "sending", followingDraft: true })
  const calls = []
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(String(url))
    if (String(url).endsWith("conversationReceiptRead"))
      return Response.json({ result: { sessionId: "chat-a", clientRequestId: "req-a", state: "rejected" } })
    assert.match(String(url), /conversationRead$/)
    return Response.json({ result: { id: "chat-a", epoch: "e", version: 2, phase: "completed", inputAccepted: true, clientRequestId: "previous" } })
  })
  const chat = probe()
  chat.change("chat-a", { ...original, text: "newer" })
  await chat.reconcile("chat-a")
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "original\n\nnewer")
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), false)
  assert.equal(calls.length, 2)
  assert.equal(calls.some((url) => /conversationSend$/.test(url)), false)
})

test("a failed summary without Pi input cannot clear an unresolved original receipt", async (t) => {
  const saved = storage(t)
  saveRequest("chat-a", { ...receipt(), stage: "sending", followingDraft: true })
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("conversationReceiptRead"))
      return Response.json({ result: { sessionId: "chat-a", clientRequestId: "req-a", state: "unknown" } })
    return Response.json({ result: { id: "chat-a", epoch: "cold", version: 5, runId: "old-run", phase: "failed", inputAccepted: false, clientRequestId: "req-a" } })
  })
  const chat = probe()
  // A normal operation may return a matching failed summary; it is not a receipt.
  await chat.queueMode("chat-a", "single")
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), true)
  await assert.rejects(chat.reconcile("chat-a"), /尚未找到/)
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), true)
})

test("an older matching ACK settles its receipt without overwriting the newer displayed run", { timeout: 8000 }, async (t) => {
  const saved = storage(t)
  const entered = deferred(), reply = deferred()
  let sent, stopped
  const urls = []
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = String(url)
    urls.push(target)
    if (target.endsWith("conversationSend")) {
      sent = JSON.parse(options.body); entered.resolve(); return reply.promise
    }
    if (target.endsWith("conversationReceiptRead"))
      return Response.json({ result: { sessionId: "chat-a", clientRequestId: "later", state: "accepted" } })
    if (target.endsWith("conversationRead"))
      return Response.json({ result: { id: "chat-a", epoch: "e", version: 5, runId: "newer-run", phase: "running", inputAccepted: true, clientRequestId: "later" } })
    assert.match(target, /conversationStop$/)
    stopped = JSON.parse(options.body)
    return Response.json({ result: { id: "chat-a", epoch: "e", version: 6, runId: "newer-run", phase: "interrupted", inputAccepted: true, clientRequestId: "later" } })
  })
  const chat = probe()
  const sending = chat.send("chat-a", original, connections)
  await entered.promise
  chat.change("chat-a", { ...original, text: "next after original" })
  await chat.inspectReceipt("chat-a", "later")
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), true)
  reply.resolve(Response.json({ result: { id: "chat-a", epoch: "e", version: 1, runId: "older-run", phase: "completed", inputAccepted: true, clientRequestId: sent.clientRequestId } }))
  await sending
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), false)
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "next after original")
  await chat.stop("chat-a")
  assert.equal(stopped.runId, "newer-run")
  assert.equal(urls.filter((url) => /conversationSend$/.test(url)).length, 1)
})

test("a failed send snapshot requires a matching formal rejection before restoring input", async (t) => {
  const saved = storage(t)
  const calls = []
  let clientRequestId
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = String(url); calls.push(target)
    if (target.endsWith("conversationSend")) {
      clientRequestId = JSON.parse(options.body).clientRequestId
      return Response.json({ result: { id: "chat-a", epoch: "e", version: 1, clientRequestId, inputAccepted: false, phase: "failed" } })
    }
    assert.match(target, /conversationReceiptRead$/)
    assert.equal(JSON.parse(options.body).clientRequestId, clientRequestId)
    return Response.json({ result: { sessionId: "chat-a", clientRequestId, state: "rejected" } })
  })
  await probe().send("chat-a", original, connections)
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "original")
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), false)
  assert.equal(calls.length, 2)
  assert.equal(calls.filter((url) => /conversationSend$/.test(url)).length, 1)
})

test("failure of the readonly confirmation cannot reject the original send", async (t) => {
  const saved = storage(t)
  let clientRequestId
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).endsWith("conversationSend")) {
      clientRequestId = JSON.parse(options.body).clientRequestId
      return Response.json({ result: { id: "chat-a", epoch: "e", version: 1, clientRequestId, inputAccepted: false, phase: "failed" } })
    }
    assert.match(String(url), /conversationReceiptRead$/)
    return Response.json({ error: "回执无法读取。", issue: { code: "storage_access", summary: "回执无法读取。", recovery: "reload", severity: "error" } })
  })
  await assert.rejects(probe().send("chat-a", original, connections), /回执无法读取/)
  assert.equal(saved.has("moon.chat.request.v1.chat-a"), true)
  assert.equal(JSON.parse(saved.get("moon.chat.request.v1.chat-a")).id, clientRequestId)
  assert.equal(JSON.parse(saved.get("moon.chat.draft.v1.chat-a")).text, "")
})
