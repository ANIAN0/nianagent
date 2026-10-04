import test from "node:test"
import assert from "node:assert/strict"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { ConversationService } from "../conversations.mjs"
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
