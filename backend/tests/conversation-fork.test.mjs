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
function compactedReply(f) {
  const first = f.manager.getBranch()[0].id
  const manualId = f.manager.appendCompaction(
    "手动整理的真实Pi摘要",
    first,
    1200
  )
  const automaticId = f.manager.appendCompaction(
    "自动整理的真实Pi摘要",
    first,
    800
  )
  const now = new Date().toISOString()
  f.state.controls.push({
    id: "manual-source-operation",
    sessionId: f.state.record.id,
    kind: "compact",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    error: "",
    focus: "保留工作目标",
    compactionEntryId: manualId,
  })
  const reply = f.manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "压缩之后的稳定回复" }],
    model: "test-model",
    provider: "moon-test",
    api: "openai-completions",
    stopReason: "stop",
    timestamp: 5,
  })
  return { manualId, automaticId, reply }
}
test("official Pi forks retain manual and automatic summary provenance without copying source controls", async (t) => {
  const f = await fixture(t)
  const { manualId, automaticId, reply } = compactedReply(f)
  const sourceBytes = await readFile(f.state.record.sessionFile)
  const operation = await f.controls.forkStart(
    "source-session",
    "fork-with-summary",
    reply
  )
  assert.equal(operation.status, "completed")
  assert.equal(operation.inheritedManualCompactionIds, undefined)
  const record = await f.store.get(operation.targetSessionId)
  const target = f.host.active.get(record.id)
  assert.deepEqual(target.controls, [])
  assert.equal(target.entry.busy, false)
  const summaries = f.controls.projection(target).compactions
  assert.equal(
    summaries.find((entry) => entry.id === manualId).source,
    "manual"
  )
  assert.equal(
    summaries.find((entry) => entry.id === automaticId).source,
    "automatic"
  )
  const lineage = target.manager
    .getBranch()
    .find(
      (entry) =>
        entry.customType === "moon-fork-lineage" &&
        entry.data?.sessionId === record.id
    )
  assert.deepEqual(lineage.data.manualCompactionEntryIds, [manualId])
  assert.deepEqual(await readFile(f.state.record.sessionFile), sourceBytes)
  // A fresh readonly projection depends on Pi metadata, not the source journal.
  const restored = {
    record,
    manager: SessionManager.open(record.sessionFile, f.piDirectory),
    controls: [],
    controlsLoaded: false,
    entry: { busy: false },
    phase: "idle",
  }
  await f.controls.load(restored)
  assert.equal(
    f.controls
      .projection(restored)
      .compactions.find((entry) => entry.id === manualId).source,
    "manual"
  )
  assert.deepEqual(restored.controls, [])
  const targetBytes = await readFile(record.sessionFile)
  const readConfiguration = f.host.sessions.readExclusive
  f.host.sessions.readExclusive = async (id) =>
    f.configs.get(id) || readConfiguration(id)
  const nested = await f.controls.forkStart(record.id, "nested-fork", reply)
  assert.equal(nested.status, "completed")
  assert.equal(
    f.controls
      .projection(f.host.active.get(nested.targetSessionId))
      .compactions.find((entry) => entry.id === manualId).source,
    "manual"
  )
  assert.deepEqual(await readFile(record.sessionFile), targetBytes)
  const early = await f.controls.forkStart(
    "source-session",
    "early-fork",
    f.selected
  )
  assert.deepEqual(
    f.controls.projection(f.host.active.get(early.targetSessionId)).compactions,
    []
  )
})
test("fork summary provenance remains idempotent through publication failure", async (t) => {
  const f = await fixture(t)
  const { manualId, reply } = compactedReply(f)
  const create = f.store.create.bind(f.store)
  let fail = true
  f.store.create = async (...args) => {
    if (fail) {
      fail = false
      throw new Error("publication fault")
    }
    return create(...args)
  }
  const unknown = await f.controls.forkStart(
    "source-session",
    "unknown-provenance",
    reply
  )
  assert.equal(unknown.status, "unknown")
  const files = await readdir(f.piDirectory)
  const completed = await f.controls.read(
    "source-session",
    "unknown-provenance"
  )
  assert.equal(completed.status, "completed")
  assert.deepEqual(await readdir(f.piDirectory), files)
  const target = f.host.active.get(completed.targetSessionId)
  assert.equal(
    f.controls
      .projection(target)
      .compactions.find((entry) => entry.id === manualId).source,
    "manual"
  )
  assert.equal(
    target.manager
      .getBranch()
      .filter(
        (entry) =>
          entry.customType === "moon-fork-lineage" &&
          entry.data?.sessionId === target.record.id
      ).length,
    1
  )
})
test("older published forks restore provenance from lineage without changing either Pi file", async (t) => {
  const f = await fixture(t)
  const { manualId, reply } = compactedReply(f)
  await f.controls.persist(f.state)
  const sourceBytes = await readFile(f.state.record.sessionFile)
  const manager = SessionManager.open(
    f.state.record.sessionFile,
    f.piDirectory,
    f.state.record.cwd
  )
  manager.createBranchedSession(reply)
  manager.appendCustomEntry("moon-fork-lineage", {
    sessionId: "old-published-fork",
    sourceSessionId: "source-session",
    sourceEntryId: reply,
    operationId: "old-fork",
  })
  const record = await f.store.create({
    id: "old-published-fork",
    workspaceId: f.state.record.workspaceId,
    cwd: f.state.record.cwd,
    title: "旧版本分支",
    sessionFile: manager.getSessionFile(),
    modelId: f.state.record.modelId,
    thinking: f.state.record.thinking,
    lineage: {
      sourceSessionId: "source-session",
      sourceTitle: "来源",
      sourceEntryId: reply,
    },
  })
  const targetBytes = await readFile(record.sessionFile)
  const state = {
    record,
    manager,
    controls: [],
    controlsLoaded: false,
    entry: { busy: false },
    phase: "idle",
  }
  await f.controls.load(state)
  assert.equal(
    f.controls
      .projection(state)
      .compactions.find((entry) => entry.id === manualId).source,
    "manual"
  )
  assert.deepEqual(state.controls, [])
  assert.deepEqual(await readFile(record.sessionFile), targetBytes)
  assert.deepEqual(await readFile(f.state.record.sessionFile), sourceBytes)
})
