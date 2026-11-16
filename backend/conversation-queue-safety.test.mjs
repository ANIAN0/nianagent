import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConversationQueue } from "./conversation-queue.mjs"
import { restoreRequestContext } from "./request-context.mjs"

async function fixture(t, origin) {
  const directory = await mkdtemp(join(tmpdir(), "moon-queue-safety-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let executed = 0
  const conversations = {
    epoch: "test-epoch",
    closed: false,
    touch() {},
    start() {
      executed++
      throw new Error("unsafe execution")
    },
    models: {
      materials: {
        resolveForPrompt() {
          executed++
          throw new Error("unsafe material access")
        },
      },
    },
  }
  const queue = new ConversationQueue(directory, conversations)
  const item = {
    id: "item",
    clientRequestId: "request",
    text: "preserve",
    materials: [],
    status: "pending",
    delivery: "followUp",
    error: "",
    createdAt: new Date().toISOString(),
    ...(origin === undefined ? {} : { origin }),
  }
  const state = {
    record: { id: "session", modelId: "connection/model" },
    entry: { busy: false },
    session: { model: {} },
    queuePrepared: new Map(),
    queue: {
      version: 1,
      revision: 0,
      mode: "single",
      paused: false,
      items: [item],
    },
  }
  await queue.save(state)
  return { queue, state, item, executed: () => executed }
}

for (const path of ["prepare", "resume"]) {
  for (const origin of [undefined, { source: "untrusted", clientId: "bad" }]) {
    test(`${path}: untrusted queue stays isolated and durable (${origin ? "unknown" : "legacy"})`, async (t) => {
      const f = await fixture(t, origin)
      if (path === "prepare")
        assert.deepEqual(await f.queue.prepare(f.state, [f.item]), [])
      else await assert.rejects(f.queue.resume(f.state), /来源/)
      const saved = await f.queue.document("session")
      assert.equal(saved.paused, true)
      assert.equal(saved.items[0].status, "failed")
      assert.equal(saved.items[0].text, "preserve")
      if (!origin) assert.equal(saved.items[0].legacyQueue, true)
      assert.equal(f.executed(), 0)
    })
  }
}

test("malformed persisted local identities do not regain authenticated authority", async () => {
  await assert.rejects(
    restoreRequestContext({ source: "local", clientId: "" }),
    /身份/
  )
  await assert.rejects(restoreRequestContext({ source: "remote" }), /身份/)
})
