import assert from "node:assert/strict"
import test from "node:test"
import http from "node:http"
import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PluginHost } from "./plugin-host.mjs"
import { withRequestContext } from "./request-context.mjs"

test("正式 PluginHost 的 Pi 工具与共享契约一致，写入身份由宿主提供", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-pi-workbench-"))
  const root = fileURLToPath(new URL("./plugins/", import.meta.url))
  const reservation = http.createServer()
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  await mkdir(join(directory, "plugins", "notes-workbench"), {
    recursive: true,
  })
  const entries = Object.fromEntries(
    (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => [
        entry.name,
        {
          enabled: entry.name === "notes-workbench",
          revision: 0,
          configuration: "{}",
        },
      ])
  )
  await writeFile(
    join(directory, "plugins", "configuration.json"),
    JSON.stringify({ version: 1, entries, imports: [] })
  )
  await writeFile(
    join(directory, "plugins", "notes-workbench", "settings.json"),
    JSON.stringify({ revision: 0, port })
  )
  const host = new PluginHost(
    directory,
    { assertIdle() {}, diagnostics: { append() {} } },
    root
  )
  t.after(async () => {
    await host.close({ strict: true })
    await rm(directory, { recursive: true, force: true })
  })
  const factories = await host.factories(directory, {
    sessionId: "pi-acceptance",
  })
  const factory = factories.find(
    (item) => item.name === "moon-plugin-notes-workbench"
  )
  assert.ok(factory, host.entries.get("notes-workbench")?.error)
  const tools = new Map()
  await factory.factory({ registerTool: (tool) => tools.set(tool.name, tool) })
  const entry = host.entries.get("notes-workbench")
  const prefix = "moon_ext__notes-workbench__"
  assert.equal(tools.size, 22)
  for (const shared of entry.application.sharedTools) {
    const tool = tools.get(prefix + shared.name)
    assert.deepEqual(tool.parameters, shared.inputSchema)
    assert.equal(
      entry.policies.get(tool.name).effect,
      shared.annotations?.readOnlyHint ? "read" : "write"
    )
  }
  assert.equal(tools.has(prefix + "read_page"), false)
  const signal = new AbortController().signal
  const invoke = (name, input) =>
    tools.get(prefix + name).execute("call", input, signal, undefined, {})
  const created = await invoke("create_project", {
    name: "Pi 项目",
    requestKey: "pi-create",
  })
  assert.notEqual(created.isError, true)
  const project = JSON.parse(created.content[0].text)
  const listed = JSON.parse((await invoke("list_projects", {})).content[0].text)
  assert.ok(listed.items.some((item) => item.id === project.id))
  const row = entry.application.operations.v2_create_project
  const replay = (
    await row.execute(
      { name: "Pi 项目", requestKey: "pi-create" },
      { source: "pi", actorId: "internal-pi" },
      signal
    )
  ).value
  assert.equal(replay.id, project.id)
  assert.equal(replay.replayed, true)
  const parent = JSON.parse(
    (
      await invoke("create_directory", {
        projectId: project.id,
        name: "父目录",
        requestKey: "pi-parent",
      })
    ).content[0].text
  )
  const child = JSON.parse(
    (
      await invoke("create_directory", {
        projectId: project.id,
        parentId: parent.id,
        name: "子目录",
        requestKey: "pi-child",
      })
    ).content[0].text
  )
  const moved = JSON.parse(
    (
      await invoke("update_directory", {
        directoryId: child.id,
        parentId: null,
        requestKey: "pi-root",
      })
    ).content[0].text
  )
  assert.equal(moved.parentId, null)
  const unauthorized = await entry.application.sharedTools
    .find((tool) => tool.name === "create_project")
    .execute({ name: "无身份", requestKey: "denied" }, undefined, signal)
  assert.equal(unauthorized.isError, true)
  assert.match(unauthorized.content[0].text, /identity_denied/)
  const sharedOptions = {
    allowed: () => true,
    actorId: "agent-test",
    credentialId: "credential-test",
    generation: entry.generation,
  }
  await assert.rejects(
    host.callSharedTool(
      "notes-workbench__list_projects",
      {},
      { ...sharedOptions, allowed: () => false }
    ),
    /不可调用/
  )
  await assert.rejects(
    host.callSharedTool(
      "notes-workbench__list_projects",
      {},
      { ...sharedOptions, generation: -1 }
    ),
    /不可调用/
  )
  let entered, release, toolSignal
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const finished = new Promise((resolve) => {
    release = resolve
  })
  entry.application.sharedTools.push({
    name: "lifecycle_probe",
    description: "隔离测试消费者",
    shareable: true,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute(_input, context, signal) {
      assert.equal(context.actorId, "agent-test")
      toolSignal = signal
      entered()
      await finished
      signal.throwIfAborted()
      return { content: [{ type: "text", text: "done" }] }
    },
  })
  host.validateSharedTools(entry.application.sharedTools)
  const inFlight = host.callSharedTool(
    "notes-workbench__lifecycle_probe",
    {},
    sharedOptions
  )
  const rejected = assert.rejects(inFlight, /取消/)
  await started
  let frozen = false
  const freeze = host.freeze().then(() => {
    frozen = true
  })
  assert.equal(toolSignal.aborted, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(frozen, false)
  await assert.rejects(invoke("list_projects", {}), /停用|释放|维护/)
  release()
  await rejected
  await freeze
  assert.equal(entry.sharedCalls.size, 0)
  assert.equal(entry.sharedPending.size, 0)
  assert.equal(entry.leases.size, 0)
  await host.resume()
  assert.notEqual((await invoke("list_projects", {})).isError, true)
  entry.generation++
  await assert.rejects(invoke("list_projects", {}), /插件配置已变化/)
  const manage = (action) =>
    withRequestContext({ source: "local", clientId: "lifecycle-test" }, action)
  const disabled = await manage(() =>
    host.configure(entry.id, entry.revision, false, entry.configuration)
  )
  assert.equal(disabled.state, "disabled")
  await assert.rejects(invoke("list_projects", {}), /停用|配置已变化/)
  await assert.rejects(
    manage(() =>
      host.configure(entry.id, disabled.revision - 1, true, entry.configuration)
    ),
    /配置已变化/
  )
  const enabled = await manage(() =>
    host.configure(entry.id, disabled.revision, true, entry.configuration)
  )
  assert.equal(enabled.state, "active", enabled.error)
  const refreshed = (
    await host.factories(directory, { sessionId: "pi-acceptance" })
  ).find((item) => item.name === factory.name)
  const freshTools = new Map()
  await refreshed.factory({
    registerTool: (tool) => freshTools.set(tool.name, tool),
  })
  const afterReload = JSON.parse(
    (
      await freshTools
        .get(prefix + "list_projects")
        .execute("reloaded", {}, signal, undefined, {})
    ).content[0].text
  )
  assert.ok(afterReload.items.some((item) => item.id === project.id))
  await assert.rejects(invoke("list_projects", {}), /配置已变化/)
})
