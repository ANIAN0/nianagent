import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { ModelService } from "../models.mjs"
import { ModelStore, memoryCredentials } from "../store.mjs"
import { createBridge } from "../bridge.mjs"
const signal = () => new AbortController().signal
const model = {
  id: "moon-test",
  name: "Test",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 128,
}
function connection(endpoint) {
  return {
    id: "test",
    name: "测试连接",
    kind: "api",
    endpoint,
    protocol: "openai-completions",
    credential: "key",
    keySaved: false,
    apiKey: "test-secret-value",
    environmentVariable: "",
    headers: '{"X-Moon":"fixture"}',
    models: [model],
  }
}
async function fixture(t, discoveryId = model.id) {
  const directory = await mkdtemp(join(tmpdir(), "moon-model-test-"))
  const service = new ModelService(directory)
  await service.initialize()
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    requests.push({ path: req.url, headers: req.headers, body })
    res.setHeader("content-type", "application/json")
    if (req.headers["anthropic-version"]) {
      const next = new URL(req.url, "http://localhost").searchParams.has(
        "after_id"
      )
      res.end(
        JSON.stringify({
          data: [{ id: next ? "second-model" : "first-model" }],
          has_more: !next,
          last_id: next ? "second-model" : "first-model",
        })
      )
      return
    }
    if (req.headers.authorization === "Bearer rejected-fixture") {
      res.statusCode = 401
      res.end(JSON.stringify({ error: { message: "rejected-fixture" } }))
      return
    }
    if (req.url.endsWith("/models"))
      res.end(JSON.stringify({ data: [{ id: discoveryId }] }))
    else {
      res.setHeader("content-type", "text/event-stream")
      res.end(
        `data: ${JSON.stringify({ id: "chat-test", object: "chat.completion.chunk", created: 1, model: model.id, choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "chat-test", object: "chat.completion.chunk", created: 1, model: model.id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`
      )
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(async () => {
    service.close()
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    service,
    directory,
    requests,
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
  }
}
test("API credentials persist without echo; concurrent stale saves rejected; clear is explicit", async (t) => {
  const { service, directory, endpoint } = await fixture(t)
  const saved = await service.save(connection(endpoint), signal())
  assert.equal(saved.apiKey, "")
  assert.equal(saved.keySaved, true)
  assert.equal(saved.revision, 1)
  const restarted = new ModelService(directory)
  await restarted.initialize()
  assert.equal((await restarted.list())[0].keySaved, true)
  const changed = await restarted.save({ ...saved, name: "改名" }, signal())
  await assert.rejects(
    service.save({ ...saved, name: "旧窗口" }, signal()),
    /更新/
  )
  assert.equal(changed.keySaved, true)
  const cleared = await restarted.save({ ...changed, clearKey: true }, signal())
  assert.equal(cleared.keySaved, false)
  assert.match(cleared.issue, /密钥/)
  assert.ok(
    !(await readFile(join(directory, "models.json"), "utf8")).includes(
      "test-secret-value"
    )
  )
  await restarted.remove(cleared.id, cleared.revision)
  assert.deepEqual(await restarted.list(), [])
  await assert.rejects(restarted.save(cleared, signal()), /已删除/)
})
test("real protocol discovery and Pi completion use draft credentials without saving", async (t) => {
  const { service, endpoint, requests } = await fixture(t)
  const draft = connection(endpoint)
  const found = await service.discover({ ...draft, models: [] }, signal())
  assert.equal(found[0].id, model.id)
  assert.equal(found[0].contextWindow, undefined)
  assert.equal(requests[0].headers.authorization, "Bearer test-secret-value")
  await service.check(draft, model, signal())
  assert.ok(requests.some((item) => item.path.endsWith("/chat/completions")))
  assert.equal((await service.list()).length, 0)
  await service.check(
    { ...draft, credential: "none", apiKey: "" },
    model,
    signal()
  )
  assert.equal(requests.at(-1).headers.authorization, undefined)
  assert.equal(requests.at(-1).headers["x-api-key"], undefined)
})
test("Anthropic discovery follows pagination without sending a Bearer header", async (t) => {
  const { service, endpoint, requests } = await fixture(t)
  const models = await service.discover(
    { ...connection(endpoint), protocol: "anthropic-messages", models: [] },
    signal()
  )
  assert.deepEqual(
    models.map((model) => model.id),
    ["first-model", "second-model"]
  )
  assert.equal(requests[1].path, "/v1/models?after_id=first-model")
  assert.equal(requests[0].headers["x-api-key"], "test-secret-value")
  assert.equal(requests[0].headers.authorization, undefined)
})
test("environment credentials resolve only in backend and switch removes prior key", async (t) => {
  const { service, endpoint, requests } = await fixture(t)
  const key = "MOON_MODEL_TEST_TOKEN"
  process.env[key] = "env-fixture-token"
  t.after(() => delete process.env[key])
  const original = await service.save(connection(endpoint), signal())
  const saved = await service.save(
    { ...original, credential: "environment", environmentVariable: key },
    signal()
  )
  assert.equal(saved.keySaved, false)
  assert.equal(saved.issue, "")
  await service.discover(saved, signal())
  assert.equal(
    requests.at(-1).headers.authorization,
    "Bearer env-fixture-token"
  )
  delete process.env[key]
  assert.match((await service.list())[0].issue, /环境变量/)
})
test("invalid capabilities, header execution and corrupt documents are rejected without overwrite", async (t) => {
  const { service, endpoint, directory } = await fixture(t)
  await assert.rejects(
    service.save(
      { ...connection(endpoint), models: [{ ...model, maxTokens: 5000 }] },
      signal()
    ),
    /上限/
  )
  await assert.rejects(
    service.save(
      { ...connection(endpoint), headers: '{"x-command":"!echo bad"}' },
      signal()
    ),
    /字面值/
  )
  const file = join(directory, "models.json")
  await writeFile(file, "null")
  await assert.rejects(service.initialize(), /损坏/)
  assert.equal(await readFile(file, "utf8"), "null")
})
test("CredentialStore undefined callback preserves credentials and missing connection rejects late OAuth writes", async (t) => {
  const { service } = await fixture(t)
  const credentials = service.store.credentialStore()
  const value = { type: "api_key", key: "fixture" }
  await credentials.modify("example", async () => value)
  assert.deepEqual(
    await credentials.modify("example", async () => undefined),
    value
  )
  const memory = memoryCredentials({ example: value })
  assert.deepEqual(await memory.modify("example", async () => undefined), value)
  const guarded = service.store.credentialStore({
    id: "old-job",
    connectionId: "removed",
    revision: 1,
  })
  await assert.rejects(
    guarded.modify("example", async () => value),
    /已变更/
  )
})
test("stdio bridge routes real CRUD and rejects unknown operations", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-rpc-test-"))
  const bridge = createBridge({ env: { MOON_DATA_DIR: directory } })
  t.after(async () => {
    bridge.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    await rm(directory, { recursive: true, force: true })
  })
  assert.deepEqual(await bridge.call("list", {}, signal()), [])
  const saved = await bridge.call(
    "save",
    { connection: connection("http://127.0.0.1:1/v1") },
    signal()
  )
  assert.equal(saved.apiKey, "")
  assert.equal(saved.keySaved, true)
  await assert.rejects(bridge.call("unknown", {}, signal()), /未知接口/)
  const providers = await bridge.call("providers", {}, signal())
  assert.ok(providers.length > 0)
  await bridge.call(
    "remove",
    { id: saved.id, revision: saved.revision },
    signal()
  )
  assert.deepEqual(await bridge.call("list", {}, signal()), [])
})

test("Pi error responses are failures without returning credential text", async (t) => {
  const { service, endpoint } = await fixture(t)
  await assert.rejects(
    service.check(
      { ...connection(endpoint), apiKey: "rejected-fixture" },
      model,
      signal()
    ),
    (error) =>
      error.message.includes("未成功") &&
      !error.message.includes("rejected-fixture")
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    service.check(connection(endpoint), model, controller.signal)
  )
})

test("discovered Claude on compatible connection calls OpenAI completions", async (t) => {
  const { service, endpoint, requests } = await fixture(
    t,
    "claude-haiku-4-5-20251001"
  )
  const draft = connection(endpoint)
  const found = await service.dispatch(
    "discover",
    { connection: draft },
    signal()
  )
  assert.equal(found[0].api, "openai-completions")
  await service.dispatch(
    "check",
    { connection: draft, model: { ...model, ...found[0] } },
    signal()
  )
  assert.equal(requests.at(-1).path, "/v1/chat/completions")
  assert.equal(requests.at(-1).headers["anthropic-version"], undefined)
})
