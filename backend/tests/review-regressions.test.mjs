import { WorkspaceService } from "../workspaces.mjs"
import { ConversationCatalogService } from "../conversation-catalog.mjs"
import { ConversationService } from "../conversations.mjs"
import { ConversationControls } from "../conversation-controls.mjs"
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { ModelService } from "../models.mjs"
import { SessionService } from "../sessions.mjs"
import { MaterialService } from "../materials.mjs"
import { McpService } from "../mcp.mjs"
import { AuthorizationJobs } from "../oauth.mjs"
import { createBridge } from "./stdio-client.mjs"
import { matchModel } from "../model-metadata.mjs"
import { operations, validateRequest, dispatchOperation } from "../contract.mjs"

test("cancel deletion while storage lock is held preserves connection and credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-review-lock-"))
  const service = new ModelService(directory)
  await service.initialize()
  t.after(async () => {
    service.close()
    await rm(directory, { recursive: true, force: true })
  })
  const saved = await service.dispatch("save", {
    connection: {
      ...operations.save.example.connection,
      credential: "key",
      apiKey: "fixture-only",
    },
  })
  const before = await readFile(join(directory, "models.json"), "utf8")
  const unlock = await lockfile.lock(directory, { realpath: false })
  const controller = new AbortController()
  const pending = service.dispatch(
    "remove",
    { id: saved.id, revision: saved.revision },
    controller.signal
  )
  const rejected = assert.rejects(pending, { name: "AbortError" })
  controller.abort()
  await unlock()
  await rejected
  assert.equal(await readFile(join(directory, "models.json"), "utf8"), before)
})

test("formal Node bridge preserves corrupt configuration diagnostic and original bytes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-review-corrupt-"))
  await writeFile(join(directory, "models.json"), "{broken")
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
  await assert.rejects(
    bridge.call("list", {}),
    (error) =>
      /配置文件损坏/.test(error.message) && !error.message.includes("Node")
  )
  assert.equal(
    await readFile(join(directory, "models.json"), "utf8"),
    "{broken"
  )
})

test("metadata matching preserves transport, service ID, supported mappings and ambiguous limits", () => {
  const base = {
    id: "claude-haiku-4-5-20251001",
    name: "Claude",
    provider: "anthropic",
    api: "anthropic-messages",
    input: ["text"],
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 64000,
    thinkingLevelMap: { high: "enabled" },
  }
  const found = matchModel({ id: base.id }, [base], {
    protocol: "openai-completions",
  })
  assert.equal(found.api, "openai-completions")
  assert.equal(found.thinkingLevelMap.high, "enabled")
  const deep = { ...base, id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }
  const matched = matchModel({ id: "DeepSeek-V4-Flash" }, [deep], {
    protocol: "openai-responses",
  })
  assert.equal(matched.id, "DeepSeek-V4-Flash")
  assert.equal(matched.contextWindow, 200000)
  const partial = matchModel(
    { id: "DeepSeek-V4-Flash" },
    [deep, { ...deep, provider: "other", maxTokens: 128 }],
    {}
  )
  assert.equal(partial.maxTokens, undefined)
  assert.equal(partial.metadata.status, "partial")
  assert.equal(
    matchModel({ id: "DeepSeek-V4-Flash-Vision-Exp" }, [deep], {}).metadata
      .status,
    "unknown"
  )
})

test("every operation example is validated, dispatch registered and malformed nested fields rejected", async () => {
  for (const [name, definition] of Object.entries(operations)) {
    validateRequest(name, definition.example)
    const parts = definition.method.split(".")
    const method = parts.pop()
    const owner =
      parts.length === 0
        ? ModelService.prototype
        : {
            jobs: AuthorizationJobs.prototype,
            sessions: SessionService.prototype,
            materials: MaterialService.prototype,
            mcp: McpService.prototype,
            workspaces: WorkspaceService.prototype,
            conversationCatalog: ConversationCatalogService.prototype,
            conversations: ConversationService.prototype,
            "conversations.controls": ConversationControls.prototype,
          }[parts.join(".")]
    assert.ok(owner, `Unknown operation owner: ${definition.method}`)
    assert.equal(typeof owner[method], "function", definition.method)
  }
  assert.throws(
    () =>
      validateRequest("save", {
        connection: {
          ...operations.save.example.connection,
          models: [
            {
              id: "bad",
              name: "Bad",
              api: "openai-completions",
              input: ["text"],
              contextWindow: "large",
            },
          ],
        },
      }),
    /contextWindow/
  )
  assert.throws(
    () => validateRequest("remove", { id: "x", revision: 1, unknown: true }),
    /未声明/
  )
  await assert.rejects(
    dispatchOperation({ list: () => [{ apiKey: "secret" }] }, "list", {}),
    /返回结果/
  )
})

test("stdio cancel reaches a deletion queued behind the storage lock", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-review-rpc-cancel-"))
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
  const saved = await bridge.call("save", {
    connection: operations.save.example.connection,
  })
  const before = await readFile(join(directory, "models.json"), "utf8")
  const unlock = await lockfile.lock(directory, { realpath: false })
  try {
    const controller = new AbortController()
    const pending = bridge.call(
      "remove",
      { id: saved.id, revision: saved.revision },
      controller.signal
    )
    const rejected = assert.rejects(pending, { name: "AbortError" })
    await bridge.call("list", {}) // stdin FIFO barrier: delete has been dispatched.
    controller.abort()
    await rejected
    await bridge.call("list", {}) // cancellation has reached RPC before unlock.
  } finally {
    await unlock()
  }
  // Lock retry is capped at 300ms; wait beyond it to detect a late commit.
  await new Promise((resolve) => setTimeout(resolve, 650))
  assert.equal(await readFile(join(directory, "models.json"), "utf8"), before)
})
