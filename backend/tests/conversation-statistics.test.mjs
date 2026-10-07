import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { ConversationService } from "../conversations.mjs"
import { ConversationStore } from "../conversation-store.mjs"
import { ModelService } from "../models.mjs"
import { assertSchema, schemas } from "../schema.mjs"

const time = 1700000000000
const assistant = (content, stopReason = "stop", timestamp = time + 1) => ({
  role: "assistant", content, timestamp, model: "model", api: "openai-completions",
  provider: "local", stopReason,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
})

// Real SessionManager + ConversationStore through the public read path, so the
// counted branch is the persisted Pi history, not a synthetic array.
async function statisticsFixture(t) {
  const temporaryDirectory = fileURLToPath(new URL("../../.dev/", import.meta.url))
  await mkdir(temporaryDirectory, { recursive: true })
  const root = await mkdtemp(join(temporaryDirectory, "statistics-"))
  const cwd = join(root, "project")
  const directory = join(root, "data")
  await mkdir(cwd)
  const models = new ModelService(directory)
  await models.initialize()
  const store = new ConversationStore(directory)
  await store.initialize()
  const workspaces = { get: async () => ({ id: "workspace-test", path: cwd }) }
  const chats = new ConversationService(
    directory,
    models,
    models.sessions,
    store,
    workspaces
  )
  await mkdir(chats.directory, { recursive: true })
  const manager = SessionManager.create(cwd, chats.directory)
  t.after(async () => {
    await chats.close()
    await models.close()
    const within = relative(resolve(temporaryDirectory), resolve(root))
    assert.ok(
      within && !isAbsolute(within) && within !== ".." && !within.startsWith(`..${sep}`),
      "Only this fixture's .dev directory may be removed"
    )
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const register = async () => {
    await store.create({
      id: "statistics-session",
      workspaceId: "workspace-test",
      cwd,
      title: "轮次统计",
      sessionFile: manager.getSessionFile(),
      modelId: "local/model",
    })
    await store.update("statistics-session", {
      runId: "run-first",
      lastRequestId: "statistics-input",
      status: "failed",
    })
  }
  const read = async () => {
    const snapshot = await chats.read("statistics-session")
    assertSchema(schemas.ConversationSnapshot, snapshot)
    return snapshot.statistics
  }
  return { manager, register, read }
}

test("statistics count two user turns and three assistant steps including a tool-use step", async (t) => {
  const f = await statisticsFixture(t)
  const call = {
    type: "toolCall",
    id: "tool-1",
    name: "edit",
    arguments: { path: "file.md", edits: [] },
  }
  f.manager.appendMessage({ role: "user", content: "第一问", timestamp: time })
  f.manager.appendMessage(
    assistant([call, { type: "text", text: "调用工具" }], "toolUse")
  )
  f.manager.appendMessage(assistant([{ type: "text", text: "继续回复" }]))
  f.manager.appendMessage({ role: "user", content: "第二问", timestamp: time + 4 })
  f.manager.appendMessage(
    assistant([{ type: "text", text: "回答第二问" }], "stop", time + 5)
  )
  await f.register()
  const statistics = await f.read()
  assert.equal(statistics.turns, 2)
  assert.equal(statistics.steps, 3)
  assert.equal(statistics.toolCalls, 1)
})

test("statistics never count an assistant-led branch without a preceding user as a turn", async (t) => {
  const f = await statisticsFixture(t)
  f.manager.appendMessage(
    assistant([{ type: "text", text: "分支首条即助手消息" }])
  )
  await f.register()
  const statistics = await f.read()
  assert.equal(statistics.turns, 0)
  assert.equal(statistics.steps, 1)
})

test("statistics keep a normal user to assistant round as exactly one turn", async (t) => {
  const f = await statisticsFixture(t)
  f.manager.appendMessage({ role: "user", content: "一次请求", timestamp: time })
  f.manager.appendMessage(assistant([{ type: "text", text: "一次回复" }]))
  await f.register()
  const statistics = await f.read()
  assert.equal(statistics.turns, 1)
  assert.equal(statistics.steps, 1)
})
