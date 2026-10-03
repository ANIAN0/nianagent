import test from "node:test"
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { ConversationStore } from "../conversation-store.mjs"
import { ConversationControls } from "../conversation-controls.mjs"

// Exercises the official Pi persisted prefix, source integrity and durable
// publication recovery. It does not substitute for a real-model acceptance run.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-fork-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cwd = join(directory, "project")
  const piDirectory = join(directory, "conversations", "pi")
  await mkdir(cwd)
  await mkdir(piDirectory, { recursive: true })
  const manager = SessionManager.create(cwd, piDirectory)
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "前缀目标" }],
    timestamp: 1,
  })
  const selected = manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "稳定回复" }],
    model: "test-model",
    provider: "moon-test",
    api: "openai-completions",
    stopReason: "stop",
    timestamp: 2,
  })
  manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "后续排除内容" }],
    timestamp: 3,
  })
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "后续回复" }],
    model: "test-model",
    provider: "moon-test",
    api: "openai-completions",
    stopReason: "stop",
    timestamp: 4,
  })
  const store = new ConversationStore(directory)
  const record = await store.create({
    id: "source-session",
    workspaceId: "test-workspace",
    cwd,
    title: "测试会话",
    sessionFile: manager.getSessionFile(),
    modelId: "test/test-model",
    thinking: "off",
  })
  const configuration = {
    sessionId: record.id,
    cwd,
    revision: 2,
    toolIds: ["read"],
    effectiveToolIds: ["read"],
    unavailableToolIds: [],
    instructionScope: "none",
    instructions: [],
  }
  const state = {
    record,
    manager,
    entry: { busy: false },
    phase: "completed",
    controls: [],
    controlsLoaded: true,
  }
  const states = new Map([[record.id, state]])
  const configs = new Map()
  const gates = new Map()
  const host = {
    directory: piDirectory,
    active: states,
    store,
    ensureOpen() {},
    touch() {},
    selection: async () => ({}),
    fileManager: async (item) =>
      SessionManager.open(item.sessionFile, piDirectory, item.cwd),
    restore: async (item) => {
      if (states.has(item.id)) return states.get(item.id)
      const value = {
        record: item,
        manager: SessionManager.open(item.sessionFile, piDirectory, item.cwd),
        entry: { busy: false },
        phase: "idle",
        controls: [],
        controlsLoaded: true,
      }
      states.set(item.id, value)
      return value
    },
    sessions: {
      exclusive(id, action) {
        const result = (gates.get(id) || Promise.resolve()).then(action)
        gates.set(
          id,
          result.catch(() => {})
        )
        return result
      },
      readExclusive: async () => configuration,
      copyConfiguration: async (id, value) => {
        if (!configs.has(id))
          configs.set(id, {
            ...structuredClone(value),
            sessionId: id,
            revision: 1,
          })
        return configs.get(id)
      },
    },
  }
  const controls = new ConversationControls(host, directory)
  return {
    directory,
    piDirectory,
    host,
    controls,
    state,
    manager,
    selected,
    store,
    configs,
  }
}
test("fork includes the selected official assistant entry and excludes later records without modifying source", async (t) => {
  const f = await fixture(t)
  const source = await readFile(f.state.record.sessionFile, "utf8")
  const leaf = f.manager.getLeafId()
  const operation = await f.controls.forkStart(
    "source-session",
    "fork-one",
    f.selected
  )
  assert.equal(operation.status, "completed")
  const target = await f.store.get(operation.targetSessionId)
  assert.equal(target.lineage.sourceEntryId, f.selected)
  const branch = SessionManager.open(
    target.sessionFile,
    f.piDirectory
  ).getBranch()
  assert.ok(branch.some((entry) => entry.id === f.selected))
  assert.ok(!JSON.stringify(branch).includes("后续排除内容"))
  assert.equal(await readFile(f.state.record.sessionFile, "utf8"), source)
  assert.equal(f.manager.getLeafId(), leaf)
  const repeated = await f.controls.forkStart(
    "source-session",
    "fork-one",
    f.selected
  )
  assert.equal(repeated.targetSessionId, target.id)
  assert.equal((await f.store.list()).length, 2)
  assert.deepEqual(f.configs.get(target.id).toolIds, ["read"])
})
test("publication failure reconciles the already-created Pi file without a second fork", async (t) => {
  const f = await fixture(t)
  const create = f.store.create.bind(f.store)
  let failed = false
  f.store.create = async (...args) => {
    if (!failed) {
      failed = true
      throw new Error("disk fault")
    }
    return create(...args)
  }
  const operation = await f.controls.forkStart(
    "source-session",
    "fork-one",
    f.selected
  )
  assert.equal(operation.status, "unknown")
  const files = await readdir(f.piDirectory)
  const restored = await f.controls.read("source-session", "fork-one")
  assert.equal(restored.status, "completed")
  assert.deepEqual(await readdir(f.piDirectory), files)
  assert.equal((await f.store.list()).length, 2)
})
test("busy sources never fork or publish configuration", async (t) => {
  const f = await fixture(t)
  f.state.entry.busy = true
  await assert.rejects(
    f.controls.forkStart("source-session", "fork-one", f.selected),
    /正在执行/
  )
  assert.equal((await f.store.list()).length, 1)
  assert.equal(f.configs.size, 0)
})
