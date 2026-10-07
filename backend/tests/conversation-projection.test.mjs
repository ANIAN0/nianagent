import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { ConversationService } from "../conversations.mjs"
import { ConversationStore } from "../conversation-store.mjs"
import { ModelService } from "../models.mjs"
import { projectedResult, toolTarget, fileArtifact } from "../conversation-projection.mjs"
import { assertSchema, schemas } from "../schema.mjs"

const time = 1700000000000
function fixture() {
  const cwd = process.cwd()
  const manager = SessionManager.inMemory(cwd)
  const chats = new ConversationService(cwd, {}, {}, {}, {})
  const state = {
    manager, record: { cwd, runId: "run-first", modelId: "local/model" },
    inputAccepted: true, entry: { busy: false }, phase: "completed",
    toolProgress: new Map(), stoppedToolIds: new Set(), stoppedToolCalls: new Set(),
  }
  manager.appendCustomEntry("moon-request", { runId: "run-first" })
  manager.appendMessage({ role: "user", content: "检查并修改", timestamp: time })
  return { chats, manager, state, cwd }
}
const assistant = (content, stopReason = "stop", timestamp = time + 1) => ({
  role: "assistant", content, timestamp, model: "model", api: "openai-completions",
  provider: "local", stopReason,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
})

test("formal Pi ordered content, exact diff and full history positions survive projection", () => {
  const { chats, manager, state } = fixture()
  const call = { type: "toolCall", id: "provider-reused-id", name: "edit", arguments: {
    path: "file.md", edits: [{ oldText: "old", newText: "new" }],
  } }
  manager.appendCustomEntry("moon-materials", { text: "检查并修改", materials: [] })
  manager.appendMessage(assistant([
    { type: "text", text: "之前" }, { type: "thinking", thinking: "核查" },
    call, { type: "text", text: "之后" }, { type: "thinking", thinking: "下一段" },
  ], "toolUse"))
  manager.appendMessage({ role: "toolResult", toolCallId: call.id, toolName: "edit",
    content: [{ type: "text", text: "Successfully replaced." }],
    details: { diff: "-old\n+new", patch: "--- file.md\n+++ file.md\n-old\n+new", firstChangedLine: 3 },
    isError: false, timestamp: time + 2,
  })
  manager.appendMessage(assistant([{ type: "text", text: "完成" }], "stop", time + 3))
  const messages = chats.transcript(state)
  assert.deepEqual(messages[1].blocks.map((block) => block.type), ["text", "thinking", "tool", "text", "thinking"])
  assert.equal(messages[1].stopReason, "toolUse")
  assert.equal(messages[1].tools[0].artifact.operation, "edit")
  assert.equal(messages[1].tools[0].resultAvailability, "available")
  assert.deepEqual(messages[1].tools[0].details, {
    diff: "-old\n+new", patch: "--- file.md\n+++ file.md\n-old\n+new", firstChangedLine: 3,
  })
  assert.equal(messages[1].userTurnId, messages[0].id)
  assert.equal(messages[2].userTurnId, messages[0].id)
  assert.equal(messages[1].runId, "run-first")
  const branch = manager.getBranch()
  assert.equal(messages[1].historyIndex, branch.findIndex((entry) => entry.message?.role === "assistant"))
  for (const message of messages) assertSchema(schemas.ConversationChatMessage, message)
})

test("pending and visible continuation use authoritative branch positions and active reasoning ends", () => {
  const { chats, manager, state } = fixture()
  const first = assistant([{ type: "text", text: "第一轮" }])
  manager.appendMessage(first)
  manager.appendCustomEntry("moon-context-usage", { feedback: {} })
  manager.appendCustomEntry("moon-request", { runId: "run-next" })
  manager.appendCustomMessageEntry("moon-continuation", "继续", true)
  const pending = assistant([{ type: "thinking", thinking: "完成思考" }, { type: "text", text: "正在输出" }], "stop", time + 5)
  chats.event(state, { type: "message_start", message: pending })
  chats.event(state, { type: "message_update", message: pending, assistantMessageEvent: { type: "text_delta", contentIndex: 1 } })
  let messages = chats.transcript(state)
  const live = messages.at(-1)
  assert.equal(live.historyIndex, manager.getBranch().length)
  assert.ok(live.historyIndex > messages.at(-2).historyIndex)
  assert.equal(messages.at(-2).historyIndex, manager.getBranch().findIndex((entry) => entry.customType === "moon-continuation"))
  assert.deepEqual(live.blocks.map((block) => block.phase), ["settled", "running"])
  assert.equal(live.activeBlockId, live.blocks[1].id)
  assert.equal(live.userTurnId, messages.at(-2).id)
  chats.event(state, { type: "message_update", message: pending, assistantMessageEvent: { type: "text_end", contentIndex: 1 } })
  messages = chats.transcript(state)
  assert.equal(messages.at(-1).activeBlockId, undefined)
  assert.equal(messages.at(-1).blocks[1].phase, "settled")
})

test("length is explicit and legal continuation never accepts unpersisted inputs", () => {
  const { chats, manager, state } = fixture()
  manager.appendMessage(assistant([{ type: "text", text: "未完" }], "length"))
  assert.equal(chats.transcript(state).at(-1).stopReason, "length")
  assert.equal(chats.canContinue(state), true)
  state.inputAccepted = false
  assert.equal(chats.canContinue(state), false)
  state.inputAccepted = true
  state.entry.busy = true
  assert.equal(chats.canContinue(state), false)
})

test("result truncation and write effects retain factual boundaries", () => {
  const result = projectedResult({ content: [{ type: "text", text: "x".repeat(32001) }] })
  assert.equal(result.resultLength, 32001)
  assert.equal(result.resultTruncated, true)
  assert.match(result.result, /输出已截断/)
  assert.equal(projectedResult({ content: [{ type: "text", text: "Pi snippet" }], details: { truncation: { truncated: true } } }).resultTruncated, true)
  const part = { name: "write", arguments: { path: "new.md", content: "new" } }
  const target = toolTarget(part, process.cwd())
  assert.equal(fileArtifact(part, target, "success", {}).operation, "write")
  assert.equal(fileArtifact(part, target, "failed", {}), undefined)
  assert.equal(fileArtifact(part, target, "not-run", {}), undefined)
})

// Real Pi JSONL and the public read path, without activating an agent or calling
// a provider. History observations must not migrate, repair or rewrite the file.
async function persistentFixture(t) {
  const temporaryDirectory = fileURLToPath(new URL("../../.dev/", import.meta.url))
  await mkdir(temporaryDirectory, { recursive: true })
  const root = await mkdtemp(join(temporaryDirectory, "tool-projection-"))
  const cwd = join(root, "project")
  const directory = join(root, "data")
  await mkdir(cwd)
  const models = new ModelService(directory)
  await models.initialize()
  const store = new ConversationStore(directory)
  await store.initialize()
  const workspaces = { get: async () => ({ id: "workspace-test", path: cwd }) }
  const services = []
  const createService = () => {
    const chats = new ConversationService(directory, models, models.sessions, store, workspaces)
    services.push(chats)
    return chats
  }
  const chats = createService()
  await mkdir(chats.directory, { recursive: true })
  const manager = SessionManager.create(cwd, chats.directory)
  manager.appendCustomEntry("moon-request", { runId: "run-first", clientRequestId: "persisted-input" })
  manager.appendMessage({ role: "user", content: "读取工具执行事实", timestamp: time })
  const addCall = (name, id, args = {}, stopReason = "toolUse") => {
    const part = { type: "toolCall", id, name, arguments: args }
    const entryId = manager.appendMessage(assistant([part], stopReason))
    return { part, entryId, index: 0 }
  }
  const addResult = (call, content = [], isError = false, extra = {}) =>
    manager.appendMessage({ role: "toolResult", toolCallId: call.part.id,
      toolName: call.part.name, content, isError, timestamp: time + 2, ...extra })
  const addShellEnd = (call, facts) => manager.appendCustomEntry("moon-shell-result", {
    toolCallId: call.part.id, toolName: call.part.name,
    callEntryId: call.entryId, callIndex: call.index, ...facts,
  })
  const register = async () => {
    await store.create({ id: "projection-session", workspaceId: "workspace-test", cwd,
      title: "工具事实读取", sessionFile: manager.getSessionFile(), modelId: "local/model" })
    await store.update("projection-session", { runId: "run-first", lastRequestId: "persisted-input", status: "failed" })
  }
  t.after(async () => {
    for (const service of services) await service.close()
    await models.close()
    const within = relative(resolve(temporaryDirectory), resolve(root))
    assert.ok(within && !isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`), "Only this fixture's .dev directory may be removed")
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const read = async (service = chats) => {
    const snapshot = await service.read("projection-session")
    assertSchema(schemas.ConversationSnapshot, snapshot)
    return snapshot
  }
  return { chats, manager, addCall, addResult, addShellEnd, register, read, createService }
}

test("public conversation reads keep durable exit facts separate from missing results", async (t) => {
  const f = await persistentFixture(t)
  const first = f.addCall("bash", "reused-provider-id", { command: "first" })
  f.addShellEnd(first, { exitCode: 0, durationMs: 12 })
  const second = f.addCall("bash", "reused-provider-id", { command: "second" })
  f.addShellEnd(second, { exitCode: 7, durationMs: 34 })
  const durationOnly = f.addCall("powershell", "duration-only", { command: "third" })
  f.addShellEnd(durationOnly, { durationMs: 0 })
  f.addCall("write", "no-evidence", { path: "unconfirmed.txt", content: "not an effect" })
  const invalid = f.addCall("bash", "invalid-metadata", { command: "fourth" })
  f.addShellEnd(invalid, { exitCode: "0", durationMs: -1 })
  // Externally constructed/older assistant stopReason is not dispatch evidence.
  f.addCall("read", "aborted-history", { path: "file.md" }, "aborted")
  const empty = f.addCall("read", "empty-result", { path: "empty.md" })
  f.addResult(empty)
  const failed = f.addCall("read", "failed-result", { path: "missing.md" })
  f.addResult(failed, [{ type: "text", text: "actual failure" }], true)
  const stopped = f.addCall("read", "stopped-no-result", { path: "file.md" })
  const stoppedResult = f.addCall("read", "stopped-result", { path: "file.md" })
  f.addResult(stoppedResult, [{ type: "text", text: "actual abort result" }], true)
  const successfulStop = f.addCall("bash", "completed-before-stop", { command: "fifth" })
  f.addShellEnd(successfulStop, { exitCode: 0 })
  f.addResult(successfulStop, [{ type: "text", text: "actual completed output" }])
  const resultBeforeMarker = f.addCall("bash", "actual-error-before-stop", { command: "sixth" })
  f.addShellEnd(resultBeforeMarker, { exitCode: 0 })
  f.addResult(resultBeforeMarker, [{ type: "text", text: "actual tool error" }], true)
  f.manager.appendCustomEntry("moon-run-result", { runId: "run-first", phase: "interrupted",
    stoppedToolCalls: [first, second, stopped, stoppedResult, successfulStop, resultBeforeMarker]
      .map(({ entryId, index }) => ({ entryId, index })) })
  await f.register()
  const before = await readFile(f.manager.getSessionFile())
  const snapshot = await f.read()
  const tools = snapshot.messages.flatMap((message) => message.tools || [])
  const byId = (id) => tools.find((tool) => tool.id === id)
  assert.deepEqual(tools.slice(0, 3).map(({ status, resultAvailability, exitCode, durationMs }) =>
    ({ status, resultAvailability, exitCode, durationMs })), [
    { status: "returned", resultAvailability: "missing", exitCode: 0, durationMs: 12 },
    { status: "failed", resultAvailability: "missing", exitCode: 7, durationMs: 34 },
    { status: "returned", resultAvailability: "missing", exitCode: undefined, durationMs: 0 },
  ])
  assert.notEqual(tools[0].occurrenceId, tools[1].occurrenceId)
  for (const id of ["no-evidence", "invalid-metadata", "aborted-history"]) {
    assert.equal(byId(id).status, "unknown")
    assert.equal(byId(id).resultAvailability, "missing")
    assert.equal(byId(id).result, "")
    assert.equal(byId(id).artifact, undefined)
  }
  assert.equal(byId("invalid-metadata").exitCode, undefined)
  assert.equal(byId("invalid-metadata").durationMs, undefined)
  assert.equal(byId("empty-result").status, "success")
  assert.equal(byId("empty-result").resultAvailability, "available")
  assert.equal(byId("empty-result").result, "")
  assert.equal(byId("failed-result").status, "failed")
  assert.equal(byId("failed-result").resultAvailability, "available")
  assert.equal(byId("failed-result").result, "actual failure")
  assert.equal(byId("stopped-no-result").status, "stopped")
  assert.equal(byId("stopped-no-result").resultAvailability, "missing")
  assert.equal(byId("stopped-result").status, "stopped")
  assert.equal(byId("stopped-result").resultAvailability, "available")
  assert.equal(byId("completed-before-stop").status, "success")
  assert.equal(byId("actual-error-before-stop").status, "failed")
  assert.ok(tools.filter((tool) => tool.resultAvailability === "missing").every((tool) => tool.result === ""))
  const restored = await f.read(f.createService())
  assert.deepEqual(restored.messages, snapshot.messages)
  assert.deepEqual(await readFile(f.manager.getSessionFile()), before)
})

test("formal reads distinguish running partial output, final empty results and durable end evidence", async (t) => {
  const f = await persistentFixture(t)
  f.addCall("bash", "live-call", { command: "live" })
  await f.register()
  await f.read()
  const state = f.chats.active.get("projection-session")
  state.phase = "running"
  const event = (type, extra = {}) => f.chats.event(state, {
    type, toolCallId: "live-call", toolName: "bash", ...extra,
  })
  const tool = async () => (await f.read()).messages.flatMap((message) => message.tools || [])[0]
  event("tool_execution_start")
  assert.equal((await tool()).status, "running")
  assert.equal((await tool()).resultAvailability, "missing")
  event("tool_execution_update", { partialResult: { content: [{ type: "text", text: "partial actual output" }] } })
  assert.equal((await tool()).resultAvailability, "partial")
  assert.equal((await tool()).result, "partial actual output")
  event("tool_execution_end", { isError: false, result: { content: [], structuredContent: { exit_code: 0 } } })
  assert.equal((await tool()).status, "success")
  assert.equal((await tool()).resultAvailability, "available")
  assert.equal((await tool()).result, "")
  // A late end marker beats a stale running/stop view, but does not invent output.
  const progress = [...state.toolProgress.values()][0]
  progress.status = "running"
  progress.resultAvailability = "partial"
  progress.result = "only the partial output remains"
  state.stopRequested = true
  state.phase = "interrupted"
  state.stoppedToolCalls.add(progress.key)
  assert.equal((await tool()).status, "returned")
  assert.equal((await tool()).resultAvailability, "partial")
  assert.equal((await tool()).result, "only the partial output remains")
})

test("durable nested MCP verdicts and result content are independent in the public read projection", async (t) => {
  const f = await persistentFixture(t)
  const parent = f.addCall("run_code", "nested-parent", { code: "recorded nested calls" })
  const nested = (id, status) => ({ id, name: "mcp__files__read_text", arguments: { path: "note.md" }, status })
  const addDetail = (id, fields) => f.manager.appendCustomEntry("moon-mcp-result", {
    parentEntryId: parent.entryId, parentIndex: parent.index, toolCallId: id,
    source: "MCP · files", ...fields,
  })
  addDetail("nested-empty", { isError: false, result: "" })
  addDetail("nested-error-without-body", { isError: true })
  addDetail("nested-old-content", { result: "actual legacy output" })
  f.addResult(parent, [], false, { nestedCalls: { complete: false, calls: [
    nested("nested-unfinished", "unfinished"), nested("nested-empty", "unfinished"),
    nested("nested-error-without-body", "unfinished"), nested("nested-old-content", "ok"),
    nested("nested-ok-without-body", "ok"), nested("nested-error-summary", "error"),
  ] } })
  await f.register()
  const before = await readFile(f.manager.getSessionFile())
  const snapshot = await f.read()
  const tools = snapshot.messages.flatMap((message) => message.tools || []).slice(1)
  assert.deepEqual(tools.map(({ status, resultAvailability, result }) => ({ status, resultAvailability, result })), [
    { status: "unknown", resultAvailability: "missing", result: "" },
    { status: "success", resultAvailability: "available", result: "" },
    { status: "failed", resultAvailability: "missing", result: "" },
    { status: "success", resultAvailability: "available", result: "actual legacy output" },
    { status: "success", resultAvailability: "missing", result: "" },
    { status: "failed", resultAvailability: "missing", result: "" },
  ])
  assert.deepEqual((await f.read(f.createService())).messages, snapshot.messages)
  assert.deepEqual(await readFile(f.manager.getSessionFile()), before)
})
