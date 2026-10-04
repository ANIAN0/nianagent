import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, basename } from "node:path"
import { ModelService } from "../models.mjs"

const connection = () => ({ id: "receipt-model", name: "回执验收", kind: "api", endpoint: "http://localhost:12345/v1", protocol: "openai-completions", credential: "key", keySaved: false, apiKey: "WRITE_RECEIPT_SECRET", environmentVariable: "", headers: "{}", models: [] })
const mcpConfiguration = () => ({ name: "receipt-mcp", transport: "stdio", command: "node", args: [], cwd: "", env: [], url: "", headers: [], description: "Receipt fixture", enabled: false, exposure: "direct", timeout: 60 })
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "moon-write-receipt-"))
  const service = new ModelService(directory)
  await service.initialize()
  t.after(async () => {
    await service.close()
    assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")), true)
    assert.equal(basename(directory).startsWith("moon-write-receipt-"), true)
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const receipt = (operation, operationRequestId) => service.dispatch("writeReceiptRead", { operation, operationRequestId })
  return { service, directory, receipt }
}

test("model writes persist exact receipts and replay never recreates or deletes a later target", async (t) => {
  const f = await fixture(t)
  const input = connection()
  const first = await f.service.dispatch("save", { connection: input, operationRequestId: "original-save" })
  assert.equal(first.revision, 1)
  assert.deepEqual(await f.receipt("save", "original-save"), { operation: "save", operationRequestId: "original-save", targetId: input.id, state: "committed", revision: 1 })
  await f.service.dispatch("save", { connection: input, operationRequestId: "original-save" })
  assert.equal((await f.service.list())[0].revision, 1)
  assert.equal(JSON.stringify((await f.service.store.read()).writeReceipts).includes(input.apiKey), false)
  await f.service.dispatch("save", { connection: { ...first, name: "后来修改" }, operationRequestId: "later-save" })
  const replayed = await f.service.dispatch("save", { connection: input, operationRequestId: "original-save" })
  assert.equal(replayed.name, "后来修改")
  assert.equal(replayed.revision, 2)
  await f.service.dispatch("remove", { id: input.id, revision: 2, operationRequestId: "original-remove" })
  await f.service.dispatch("save", { connection: input, operationRequestId: "recreated-save" })
  await f.service.dispatch("remove", { id: input.id, revision: 2, operationRequestId: "original-remove" })
  assert.equal((await f.service.list()).length, 1)
  assert.equal((await f.receipt("remove", "original-remove")).state, "committed")
})

test("rejected CAS and cancelled writes retain data, require new identities, and expose no false success", async (t) => {
  const f = await fixture(t)
  const saved = await f.service.save(connection())
  await assert.rejects(f.service.dispatch("save", { connection: { ...saved, revision: 99 }, operationRequestId: "rejected-save" }), /其他窗口|更新/)
  assert.equal((await f.receipt("save", "rejected-save")).state, "rejected")
  await assert.rejects(f.service.dispatch("save", { connection: saved, operationRequestId: "rejected-save" }), /标识已用于/)
  const controller = new AbortController()
  const update = f.service.store.update.bind(f.service.store)
  let writes = 0
  f.service.store.update = (change, signal) => { if (++writes === 2) controller.abort(); return update(change, signal) }
  await assert.rejects(f.service.dispatch("remove", { id: saved.id, revision: 1, operationRequestId: "cancelled-remove" }, controller.signal), { name: "AbortError" })
  f.service.store.update = update
  assert.equal((await f.service.list()).length, 1)
  assert.equal((await f.receipt("remove", "cancelled-remove")).state, "rejected")
})

test("lost response after atomic commit remains committed; receipt reads never mutate or infer from current equality", async (t) => {
  const f = await fixture(t)
  const present = f.service.present.bind(f.service)
  f.service.present = async () => { throw new Error("Lost response after commit") }
  await assert.rejects(f.service.dispatch("save", { connection: connection(), operationRequestId: "lost-response" }), (error) => error.issue?.code === "result_unknown" && error.issue.recovery === "check")
  await assert.rejects(f.service.dispatch("save", { connection: connection(), operationRequestId: "lost-response" }), (error) => error.issue?.code === "result_unknown" && error.issue.recovery === "check")
  f.service.present = present
  assert.equal((await f.receipt("save", "lost-response")).state, "committed")
  const before = await readFile(f.service.store.file)
  assert.equal((await f.receipt("save", "not-found")).state, "unknown")
  assert.equal((await f.receipt("remove", "lost-response")).state, "unknown")
  assert.deepEqual(await readFile(f.service.store.file), before)
  await f.service.store.update((document) => { document.writeReceipts["cold-preparing"] = { operationRequestId: "cold-preparing", operation: "save", targetId: "never-created", fingerprint: "a".repeat(64), ownerEpoch: "old-host", status: "preparing", updatedAt: new Date().toISOString() } })
  const coldBefore = await readFile(f.service.store.file)
  assert.equal((await f.receipt("save", "cold-preparing")).state, "rejected")
  assert.deepEqual(await readFile(f.service.store.file), coldBefore)
})

test("MCP save/remove use the same per-request atomic receipt and preserve later recreated services", async (t) => {
  const f = await fixture(t)
  const configuration = mcpConfiguration()
  await f.service.dispatch("mcpSave", { configuration, operationRequestId: "mcp-save" })
  await f.service.dispatch("mcpSave", { configuration, operationRequestId: "mcp-save" })
  assert.equal((await f.service.mcp.list())[0].revision, 1)
  assert.equal((await f.receipt("mcpSave", "mcp-save")).state, "committed")
  await f.service.dispatch("mcpRemove", { name: configuration.name, revision: 1, operationRequestId: "mcp-remove" })
  await f.service.dispatch("mcpSave", { configuration, operationRequestId: "mcp-recreated" })
  await f.service.dispatch("mcpRemove", { name: configuration.name, revision: 1, operationRequestId: "mcp-remove" })
  assert.equal((await f.service.mcp.list()).length, 1)
  assert.equal((await f.receipt("mcpRemove", "mcp-remove")).state, "committed")
})
