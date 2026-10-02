import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBridge } from "../bridge.mjs"

test("acceptance: retry list recovers after damaged configuration is repaired", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-acceptance-recovery-"))
  const bridge = createBridge({ env: { MOON_DATA_DIR: directory } })
  t.after(async () => {
    bridge.close()
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
  await writeFile(join(directory, "models.json"), "{broken")
  await assert.rejects(bridge.call("list", {}), /损坏/)
  await writeFile(
    join(directory, "models.json"),
    JSON.stringify({
      version: 1,
      deviceId: "acceptance",
      connections: [],
      credentials: {},
      authorizations: {},
    })
  )
  assert.deepEqual(await bridge.call("list", {}), [])
})
import { validateRequest, operations } from "../contract.mjs"
test("acceptance: contract rejects unsupported connection directory protocol before dispatch", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-acceptance-contract-"))
  const bridge = createBridge({ env: { MOON_DATA_DIR: directory } })
  t.after(async () => {
    bridge.close()
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
  const connection = {
    ...operations.save.example.connection,
    protocol: "openai-responses",
  }
  await assert.rejects(bridge.call("save", { connection }), /protocol.*选项/)
  assert.throws(() => validateRequest("save", { connection }), /协议|选项/)
})
test("acceptance: real Pi authorization can start and cancel without an account", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-acceptance-oauth-"))
  const bridge = createBridge({ env: { MOON_DATA_DIR: directory } })
  t.after(async () => {
    bridge.close()
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
  const providers = await bridge.call("providers", {})
  assert.ok(providers.some((p) => p.id === "anthropic"))
  const connection = {
    ...operations.save.example.connection,
    kind: "subscription",
    providerId: "anthropic",
    endpoint: "",
  }
  const started = await bridge.call("authStart", { connection })
  assert.equal(started.status, "pending")
  await bridge.call("authCancel", { id: started.id })
  const terminal = await bridge.call("authPoll", { id: started.id })
  assert.equal(terminal.status, "cancelled")
  const saved = await bridge.call("list", {})
  assert.equal(saved.length, 1)
  assert.equal(saved[0].account.loggedIn, false)
  const logout = await bridge.call("logout", { id: saved[0].id })
  assert.equal(logout.account.loggedIn, false)
})
import { readFile } from "node:fs/promises"
test("acceptance: structurally damaged connection document is not rewritten on startup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-acceptance-shape-"))
  const file = join(directory, "models.json")
  const damaged = JSON.stringify({
    version: 1,
    deviceId: "acceptance",
    connections: [null],
    credentials: {},
  })
  await writeFile(file, damaged)
  const bridge = createBridge({ env: { MOON_DATA_DIR: directory } })
  t.after(async () => {
    bridge.close()
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
  await assert.rejects(bridge.call("list", {}))
  assert.equal(await readFile(file, "utf8"), damaged)
})

test("acceptance: saved capabilities use Pi levels and existing valid v1 bytes survive startup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-acceptance-levels-"))
  const bridge = createBridge({ env: { MOON_DATA_DIR: directory } })
  t.after(async () => {
    bridge.close()
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  })
  const connection = {
    ...operations.save.example.connection,
    models: [
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek",
        api: "openai-completions",
        input: ["text"],
        reasoning: true,
        contextWindow: 1000000,
        maxTokens: 384000,
        thinkingLevelMap: {
          off: null,
          minimal: null,
          low: null,
          medium: null,
          high: "high",
          xhigh: null,
          max: "max",
        },
      },
    ],
  }
  const saved = await bridge.call("save", { connection })
  assert.deepEqual(saved.models[0].supportedThinkingLevels, ["high", "max"])
  const changed = await bridge.call("save", {
    connection: {
      ...saved,
      models: [{ ...saved.models[0], reasoning: false }],
    },
  })
  assert.deepEqual(changed.models[0].supportedThinkingLevels, [])
  bridge.close()
  const file = join(directory, "models.json")
  const old = JSON.parse(await readFile(file, "utf8"))
  delete old.authorizations
  const bytes = JSON.stringify(old)
  await writeFile(file, bytes)
  const next = createBridge({ env: { MOON_DATA_DIR: directory } })
  try {
    assert.equal((await next.call("list", {})).length, 1)
    assert.equal(await readFile(file, "utf8"), bytes)
  } finally {
    next.close()
  }
})

import { effectiveThinking } from "../../src/features/home/model-thinking.ts"
test("acceptance: both composers normalize old model thinking selections", () => {
  assert.equal(effectiveThinking("中等", ["高", "最高"]), "高")
  assert.equal(effectiveThinking("最高", ["高", "最高"]), "最高")
  assert.equal(effectiveThinking("高", []), "")
  assert.equal(effectiveThinking("中等", undefined), "中等")
})
