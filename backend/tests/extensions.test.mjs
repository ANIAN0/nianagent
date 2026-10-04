import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, basename } from "node:path"
import { ModelService } from "../models.mjs"
import { ExtensionService, extensionToolName } from "../extensions.mjs"
import { SessionManager } from "@earendil-works/pi-coding-agent"

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
async function within(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Cancellation waited for the blocked initializer")), 1000) })]) }
  finally { clearTimeout(timer) }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "moon-extension-"))
  const cwd = join(root, "project")
  const modules = join(root, "modules")
  await mkdir(cwd)
  await mkdir(join(modules, "fixture"), { recursive: true })
  await writeFile(join(modules, "fixture", "manifest.mjs"), `
    import { appendFile } from "node:fs/promises";
    import { join } from "node:path";
    export default {
      apiVersion: 1, id: "fixture", version: "1.0.0", name: "Fixture", description: "Contract fixture",
      configurationSchema: { type: "object", properties: { prefix: { type: "string", minLength: 1, maxLength: 8, title: "前缀" } }, required: ["prefix"], additionalProperties: false }, defaultConfiguration: { prefix: "记录" },
      resultKinds: [{ kind: "moon.fixture.note", version: 1, schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }],
      async createSession({cwd, signal}) {
        await appendFile(join(cwd, "lifetime.txt"), "open\\n");
        return { async dispose() { await appendFile(join(cwd, "lifetime.txt"), "close\\n"); } };
      },
      tools: [{ id: "note", label: "Note", description: "Record a note", parameters: { type: "object", properties: { text: { type: "string" }, fail: { type: "boolean" }, wait: { type: "boolean" } }, required: ["text"], additionalProperties: false },
        async execute({arguments: input, configuration, signal}) {
          if (input.wait) await new Promise((resolve, reject) => { const timer=setTimeout(resolve,10000); const abort=()=>{clearTimeout(timer);reject(signal.reason);}; signal.addEventListener("abort",abort,{once:true}); if(signal.aborted)abort(); });
          if(input.fail)throw new Error("PRIVATE_EXTENSION_DIAGNOSTIC");
          return { content:[{type:"text",text:configuration.prefix+input.text}],presentation:{kind:"moon.fixture.note",version:1,data:{text:input.text}}};
        }
      }]
    };
  `)
  const service = new ModelService(join(root, "data"))
  await service.initialize()
  service.extensions = new ExtensionService(join(root, "data"), { moduleRoot: modules })
  t.after(async () => {
    await service.close()
    assert.equal(resolve(root), root)
    assert.equal(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")), true)
    assert.equal(basename(root).startsWith("moon-extension-"), true)
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const configure = (extra = {}) => service.dispatch("extensionConfigure", { id: "fixture", revision: 0, enabled: true, configuration: '{"prefix":"记录"}', ...extra })
  const create = (toolIds = [extensionToolName("fixture", "note")]) => service.sessions.create(cwd, [], toolIds, undefined, false, { sessionManager: SessionManager.inMemory(cwd) })
  return { root, cwd, modules, service, configure, create }
}

test("declarations/configuration/catalog are authoritative and default disabled without starting resources", async (t) => {
  const f = await fixture(t)
  const initial = await f.service.dispatch("extensionList", {})
  assert.equal(initial[0].enabled, false)
  assert.equal(initial[0].tools[0].available, false)
  assert.equal(initial[0].revision, 0)
  assert.equal(JSON.parse(initial[0].configurationSchema).properties.prefix.title, "前缀")
  const catalog = await f.service.sessions.catalog(f.cwd)
  assert.equal(catalog.tools.find((tool) => tool.id === extensionToolName("fixture", "note")).available, false)
  await assert.rejects(readFile(join(f.cwd, "lifetime.txt")), { code: "ENOENT" })
  await assert.rejects(f.configure({ configuration: '{"prefix":3}' }), /配置字段/)
  const saved = await f.configure({ operationRequestId: "configure-original" })
  assert.equal(saved.revision, 1)
  assert.equal(saved.enabled, true)
  assert.equal((await f.service.dispatch("writeReceiptRead", { operation: "extensionConfigure", operationRequestId: "configure-original" })).state, "committed")
  await assert.rejects(f.configure(), /已更新/)
  assert.equal((await f.service.extensions.list())[0].revision, 1)
})

test("official Pi registration returns a versioned persisted result, isolates failure, cancellation, reload and disposal", async (t) => {
  const f = await fixture(t)
  await f.configure()
  const session = await f.create()
  const name = extensionToolName("fixture", "note")
  assert.deepEqual(session.getActiveToolNames(), [name])
  assert.ok(session.getAllTools().some((tool) => tool.name === name))
  assert.equal((await f.service.extensions.list())[0].activeSessions, 1)
  const tool = session.getToolDefinition(name)
  const result = await tool.execute("direct-result", { text: "正文" }, undefined)
  assert.equal(result.content[0].text, "记录正文")
  assert.deepEqual(f.service.extensions.presentation(result, name), { kind: "moon.fixture.note", version: 1, payload: '{"text":"正文"}' })
  session.sessionManager.appendMessage({ role: "toolResult", toolCallId: "direct-result", toolName: name, content: result.content, details: result.details, isError: false, timestamp: Date.now() })
  const stored = session.sessionManager.getEntries().find((entry) => entry.message?.role === "toolResult")
  assert.deepEqual(f.service.extensions.presentation(stored.message, name), f.service.extensions.presentation(result, name))
  f.service.extensions.loadedToolSources.clear()
  assert.equal(f.service.extensions.toolSource(name, stored.message), "扩展 · Fixture")
  assert.equal(f.service.extensions.presentation(result, "mcp__fixture__note"), undefined)
  assert.equal(f.service.extensions.presentation(result, "read"), undefined)
  assert.equal(f.service.extensions.presentation(result), undefined)
  const manifest = (await f.service.extensions.discover()).get("fixture").manifest
  assert.throws(() => f.service.extensions.result(manifest, manifest.tools[0], { content: [{ type: "text", text: "forged" }], details: { moonPresentation: result.details.moonPresentation } }), /宿主保留字段/)
  assert.throws(() => f.service.extensions.result(manifest, manifest.tools[0], { content: [{ type: "text", text: "bad schema" }], presentation: { kind: "moon.fixture.note", version: 1, data: { other: true } } }), /required|必须|缺少/)
  await assert.rejects(tool.execute("failure", { text: "正文", fail: true }, undefined), (error) => error.issue.code === "extension_tool_failed" && !error.message.includes("PRIVATE_EXTENSION_DIAGNOSTIC"))
  assert.equal((await tool.execute("after-failure", { text: "仍可用" }, undefined)).content[0].text, "记录仍可用")
  const controller = new AbortController()
  const waiting = tool.execute("cancel", { text: "取消", wait: true }, controller.signal)
  controller.abort()
  await assert.rejects(waiting, { name: "AbortError" })
  await session.reload()
  await session.getToolDefinition(name).execute("after-reload", { text: "重新加载" }, undefined)
  assert.equal((await readFile(join(f.cwd, "lifetime.txt"), "utf8")), "open\nclose\nopen\n")
  session.dispose()
  session.dispose()
  await f.service.sessions.close()
  await f.service.extensions.close()
  assert.equal(await readFile(join(f.cwd, "lifetime.txt"), "utf8"), "open\nclose\nopen\nclose\n")
  await assert.rejects(tool.execute("stale", { text: "旧句柄" }, undefined), { name: "AbortError" })
})

test("invalid modules and corrupt configuration isolate extensions from built-in tools without overwriting files", async (t) => {
  const f = await fixture(t)
  await mkdir(join(f.modules, "broken"))
  await writeFile(join(f.modules, "broken", "manifest.mjs"), "throw new Error('PRIVATE_MODULE_PATH');")
  f.service.extensions.modules = undefined
  const list = await f.service.extensions.list()
  assert.equal(list.find((entry) => entry.id === "broken").state, "failed")
  assert.equal(list.find((entry) => entry.id === "fixture").state, "ready")
  assert.equal(JSON.stringify(list).includes("PRIVATE_MODULE_PATH"), false)
  await f.configure()
  await writeFile(f.service.extensions.file, "{broken-config")
  assert.equal((await f.service.extensions.list()).every((entry) => entry.state === "failed"), true)
  const session = await f.create(["read"])
  assert.deepEqual(session.getActiveToolNames(), ["read"])
  session.dispose()
  assert.equal(await readFile(f.service.extensions.file, "utf8"), "{broken-config")
})

test("disabled capability stays unavailable until explicitly selected, and old result presentation remains inspectable", async (t) => {
  const f = await fixture(t)
  await f.configure()
  const session = await f.create(["read"])
  assert.deepEqual(session.getActiveToolNames(), ["read"])
  const saved = await f.service.extensions.configure("fixture", 1, false, '{"prefix":"记录"}')
  assert.equal(saved.enabled, false)
  session.dispose()
  await assert.rejects(f.create(), /不可用/)
  assert.deepEqual(f.service.extensions.presentation({ details: { moonPresentation: { kind: "moon.fixture.note", version: 1, payload: '{"text":"历史"}' } } }, extensionToolName("fixture", "note")), { kind: "moon.fixture.note", version: 1, payload: '{"text":"历史"}' })
})

test("last initialization waiter cancels immediately, releases a late resource exactly once and serializes the next initialization", async (t) => {
  const f = await fixture(t)
  await f.configure()
  const manifest = (await f.service.extensions.discover()).get("fixture").manifest
  const started = deferred()
  const finish = deferred()
  let initializationSignal
  let opened = 0
  let disposed = 0
  let executed = 0
  manifest.createSession = async ({ signal }) => {
    const generation = ++opened
    if (generation === 1) { initializationSignal = signal; started.resolve(); await finish.promise }
    return { generation, dispose: async () => { disposed++ } }
  }
  const execute = manifest.tools[0].execute
  manifest.tools[0].execute = async (context) => { executed++; return execute(context) }
  const session = await f.create()
  const tool = session.getToolDefinition(extensionToolName("fixture", "note"))
  const cancellation = new AbortController()
  try {
    const first = tool.execute("cancel-initialization", { text: "取消" }, cancellation.signal)
    const firstRejected = assert.rejects(first, { name: "AbortError" })
    await started.promise
    cancellation.abort()
    await within(firstRejected)
    assert.equal(initializationSignal.aborted, true)
    assert.equal(disposed, 0)
    assert.equal(executed, 0)
    const next = tool.execute("next-initialization", { text: "新调用" }, undefined)
    await Promise.resolve()
    assert.equal(opened, 1)
    finish.resolve()
    const result = await next
    assert.equal(result.content[0].text, "记录新调用")
    assert.equal(opened, 2)
    assert.equal(disposed, 1)
    assert.equal(executed, 1)
    session.dispose()
    session.dispose()
    await f.service.sessions.close()
    await f.service.extensions.close()
    assert.equal(disposed, 2)
  } finally { finish.resolve() }
})

test("one cancelled parallel waiter does not abort initialization or dispose an acquired resource used by another tool", async (t) => {
  const f = await fixture(t)
  await f.configure()
  const manifest = (await f.service.extensions.discover()).get("fixture").manifest
  const started = deferred()
  const finish = deferred()
  let initializationSignal
  let opened = 0
  let disposed = 0
  const toolStarted = deferred()
  const execute = manifest.tools[0].execute
  manifest.tools[0].execute = async (context) => { if (context.arguments.wait) toolStarted.resolve(); return execute(context) }
  manifest.createSession = async ({ signal }) => {
    opened++
    initializationSignal = signal
    started.resolve()
    await finish.promise
    return { dispose: async () => { disposed++ } }
  }
  const session = await f.create()
  const tool = session.getToolDefinition(extensionToolName("fixture", "note"))
  const firstCancellation = new AbortController()
  try {
    const first = tool.execute("first-waiter", { text: "取消" }, firstCancellation.signal)
    const firstRejected = assert.rejects(first, { name: "AbortError" })
    const second = tool.execute("second-waiter", { text: "仍需资源" }, undefined)
    await started.promise
    firstCancellation.abort()
    await within(firstRejected)
    assert.equal(initializationSignal.aborted, false)
    assert.equal(opened, 1)
    assert.equal(disposed, 0)
    finish.resolve()
    assert.equal((await second).content[0].text, "记录仍需资源")
    const thirdCancellation = new AbortController()
    const third = tool.execute("cancel-after-acquired", { text: "复用资源", wait: true }, thirdCancellation.signal)
    const thirdRejected = assert.rejects(third, { name: "AbortError" })
    await toolStarted.promise
    thirdCancellation.abort()
    await within(thirdRejected)
    assert.equal(initializationSignal.aborted, false)
    assert.equal(disposed, 0)
    assert.equal(opened, 1)
    session.dispose()
    await f.service.sessions.close()
    await f.service.extensions.close()
    assert.equal(initializationSignal.aborted, true)
    assert.equal(disposed, 1)
  } finally { finish.resolve() }
})

test("session shutdown rejects a waiting tool immediately but awaits a late initializer and its one resource release", async (t) => {
  const f = await fixture(t)
  await f.configure()
  const manifest = (await f.service.extensions.discover()).get("fixture").manifest
  const started = deferred()
  const finish = deferred()
  let disposed = 0
  let initializationSignal
  manifest.createSession = async ({ signal }) => {
    initializationSignal = signal
    started.resolve()
    await finish.promise
    return { dispose: async () => { disposed++ } }
  }
  const session = await f.create()
  const tool = session.getToolDefinition(extensionToolName("fixture", "note"))
  try {
    const waiting = tool.execute("shutdown-initialization", { text: "关闭" }, undefined)
    const rejected = assert.rejects(waiting, { name: "AbortError" })
    await started.promise
    session.dispose()
    let closed = false
    const closing = f.service.sessions.close().then(() => { closed = true })
    await within(rejected)
    assert.equal(initializationSignal.aborted, true)
    assert.equal(closed, false)
    assert.equal(disposed, 0)
    finish.resolve()
    await closing
    await f.service.extensions.close()
    assert.equal(closed, true)
    assert.equal(disposed, 1)
    session.dispose()
    assert.equal(disposed, 1)
  } finally { finish.resolve() }
})
