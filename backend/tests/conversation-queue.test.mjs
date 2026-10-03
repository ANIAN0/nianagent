import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import filesystem from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConversationQueue } from "../conversation-queue.mjs"

test("a failed mode transaction cannot leak through a concurrent durable Pi receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-queue-transaction-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const queue = new ConversationQueue(directory, { touch() {} })
  const item = { id: "queue-item", clientRequestId: "submitted-input", fingerprint: "signature", text: "保留要求", materials: [], status: "dispatching", delivery: "followUp", error: "", createdAt: new Date().toISOString() }
  const state = { record: { id: "session-test" }, manager: { getBranch: () => [] } }
  await queue.load(state)
  await queue.commit(state, (document) => document.items.push(item))
  const value = { item }
  state.queuePrepared.set(item.id, value)
  const rename = filesystem.rename
  let failed = false
  const mocked = t.mock.method(filesystem, "rename", async (...args) => {
    if (!failed && args[1] === join(queue.directory, "session-test.json")) {
      failed = true
      // The real user history has succeeded while the configuration write is pending.
      queue.afterInput(state, value)
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" })
    }
    return rename(...args)
  })
  syncBuiltinESMExports()
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(queue.commit(state, (document) => { document.mode = "all" }), /ENOSPC/)
  await queue.close()
  const saved = JSON.parse(await readFile(join(queue.directory, "session-test.json"), "utf8"))
  assert.equal(state.queue.mode, "single")
  assert.equal(saved.mode, "single")
  assert.equal(saved.items[0].status, "delivered")
  assert.equal(state.queue.items[0].status, "delivered")
  assert.equal(state.queue.paused, true)
})
