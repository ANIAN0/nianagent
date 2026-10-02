import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import lockfile from "proper-lockfile"
import { ModelService } from "../models.mjs"

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "moon-session-config-"))
  const directory = join(root, "data")
  const cwd = join(root, "project")
  await mkdir(cwd)
  await mkdir(join(directory, "agent"), { recursive: true })
  await writeFile(join(cwd, "AGENTS.md"), "MOON_TEST_DIRECTORY_INSTRUCTIONS")
  await mkdir(join(cwd, ".pi"))
  await writeFile(join(cwd, ".pi", "SYSTEM.md"), "MUST_NOT_LOAD_HIDDEN_SYSTEM")
  await writeFile(
    join(cwd, ".pi", "APPEND_SYSTEM.md"),
    "MUST_NOT_LOAD_HIDDEN_APPEND",
  )
  await writeFile(
    join(directory, "agent", "AGENTS.md"),
    "MOON_TEST_GLOBAL_INSTRUCTIONS",
  )
  const service = new ModelService(directory)
  await service.initialize()
  t.after(async () => {
    service.close()
    await rm(root, { recursive: true, force: true })
  })
  const apply = (extra = {}, signal) =>
    service.dispatch(
      "sessionApply",
      {
        sessionId: "session-a",
        cwd,
        toolIds: ["read"],
        instructionScope: "all",
        ...extra,
      },
      signal,
    )
  return { root, cwd, directory, service, apply }
}

test("session catalog and configuration use real Pi without a configured model", async (t) => {
  const { service, cwd, apply } = await fixture(t)
  const catalog = await service.dispatch("sessionCatalog", { cwd })
  assert.ok(catalog.tools.some((tool) => tool.id === "read"))
  assert.ok(catalog.tools.some((tool) => tool.id === "write"))
  assert.ok(
    !catalog.tools.some((tool) => tool.id === "browser" || tool.id === "shell"),
  )
  assert.equal(
    catalog.instructions.filter((file) => file.source === "global").length,
    1,
  )
  const result = await apply()
  assert.deepEqual(result.effectiveToolIds, ["read"])
  const session = service.sessions.active.get("session-a").session
  assert.deepEqual(session.getActiveToolNames(), ["read"])
  assert.ok(session.systemPrompt.includes("MOON_TEST_GLOBAL_INSTRUCTIONS"))
  assert.ok(session.systemPrompt.includes("MOON_TEST_DIRECTORY_INSTRUCTIONS"))
  assert.equal(session.messages.length, 0)
  assert.ok(!session.systemPrompt.includes("MUST_NOT_LOAD_HIDDEN"))
})

test("scope, empty tools, snapshot restore, and per-session isolation", async (t) => {
  const { service, cwd, directory, apply } = await fixture(t)
  const first = await apply({ instructionScope: "directory" })
  assert.ok(first.instructions.every((file) => file.source === "directory"))
  await writeFile(join(cwd, "AGENTS.md"), "CHANGED_AFTER_COMMIT")
  const restored = new ModelService(directory)
  t.after(() => restored.close())
  await restored.initialize()
  const snapshot = await restored.dispatch("sessionRead", {
    sessionId: "session-a",
  })
  assert.ok(
    snapshot.instructions.some((file) =>
      file.content.includes("MOON_TEST_DIRECTORY"),
    ),
  )
  assert.ok(
    !snapshot.instructions.some((file) =>
      file.content.includes("CHANGED_AFTER_COMMIT"),
    ),
  )
  const second = await apply({
    sessionId: "session-b",
    toolIds: [],
    instructionScope: "none",
  })
  assert.deepEqual(second.effectiveToolIds, [])
  assert.deepEqual(second.instructions, [])
  const noneSession = service.sessions.active.get("session-b").session
  assert.ok(noneSession.systemPrompt.length > 0)
  assert.ok(!noneSession.systemPrompt.includes("MOON_TEST_"))
  assert.ok(!noneSession.systemPrompt.includes("MUST_NOT_LOAD_HIDDEN"))
  assert.deepEqual(
    (await service.dispatch("sessionRead", { sessionId: "session-a" })).toolIds,
    ["read"],
  )
  const updated = await apply({
    revision: first.revision,
    instructionScope: "all",
  })
  assert.ok(
    updated.instructions.some((file) =>
      file.content.includes("CHANGED_AFTER_COMMIT"),
    ),
  )
})

test("conflicts and invalid configuration preserve committed state", async (t) => {
  const { service, cwd, root, apply } = await fixture(t)
  await apply()
  await assert.rejects(apply(), /版本/)
  await assert.rejects(apply({ revision: 1, toolIds: ["browser"] }), /不可用/)
  await assert.rejects(
    apply({ revision: 1, toolIds: ["read", "read"] }),
    /重复/,
  )
  await assert.rejects(
    apply({ revision: 1, cwd: join(root, "missing") }),
    /不存在/,
  )
  await assert.rejects(apply({ revision: 1, cwd: root }), /更换工作目录/)
  await assert.rejects(apply({ sessionId: "__proto__" }), /标识/)
  const results = await Promise.allSettled([
    apply({ revision: 1, toolIds: ["read", "write"] }),
    apply({ revision: 1, toolIds: [] }),
  ])
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  )
  assert.equal(
    (await service.dispatch("sessionRead", { sessionId: "session-a" }))
      .revision,
    2,
  )
  assert.equal((await service.dispatch("sessionCatalog", { cwd })).cwd, cwd)
})

test("cancel while waiting for transaction lock cannot commit", async (t) => {
  const { service, apply } = await fixture(t)
  const saved = await apply()
  const unlock = await lockfile.lock(service.sessions.directory, {
    realpath: false,
  })
  const controller = new AbortController()
  const request = apply({ revision: 1, toolIds: [] }, controller.signal)
  controller.abort()
  await unlock()
  await assert.rejects(request)
  assert.deepEqual(
    await service.dispatch("sessionRead", { sessionId: "session-a" }),
    saved,
  )
})

test("corrupt session data is not replaced by empty defaults", async (t) => {
  const { service, apply } = await fixture(t)
  await apply()
  await writeFile(service.sessions.file, "{broken")
  await assert.rejects(
    service.dispatch("sessionRead", { sessionId: "session-a" }),
    /损坏/,
  )
  await assert.rejects(apply({ revision: 1 }), /损坏/)
  assert.equal(await readFile(service.sessions.file, "utf8"), "{broken")
})

test("closing service during candidate creation cannot commit or recreate active sessions", async (t) => {
  const { service, apply } = await fixture(t)
  const create = service.sessions.create.bind(service.sessions)
  let created
  const ready = new Promise((resolve) => {
    created = resolve
  })
  let resume
  const pause = new Promise((resolve) => {
    resume = resolve
  })
  service.sessions.create = async (...args) => {
    const candidate = await create(...args)
    created()
    await pause
    return candidate
  }
  const pending = apply()
  await ready
  service.close()
  resume()
  await assert.rejects(pending, /关闭/)
  assert.equal(service.sessions.active.size, 0)
  await assert.rejects(readFile(service.sessions.file), { code: "ENOENT" })
})

test("cached session read still reports deleted work directory", async (t) => {
  const { service, cwd, apply } = await fixture(t)
  await apply()
  await rm(cwd, { recursive: true, force: true })
  await assert.rejects(
    service.dispatch("sessionRead", { sessionId: "session-a" }),
    /不存在/,
  )
})

test("unknown saved tools remain editable and can be removed with current revision", async (t) => {
  const { service, directory, apply } = await fixture(t)
  await apply()
  const data = JSON.parse(await readFile(service.sessions.file, "utf8"))
  data.sessions["session-a"].toolIds = ["read", "removed-tool"]
  delete data.sessions["session-a"].unavailableToolIds
  await writeFile(service.sessions.file, JSON.stringify(data))
  const restored = new ModelService(directory)
  t.after(() => restored.close())
  await restored.initialize()
  const loaded = await restored.dispatch("sessionRead", {
    sessionId: "session-a",
  })
  assert.deepEqual(loaded.toolIds, ["read", "removed-tool"])
  assert.deepEqual(loaded.effectiveToolIds, ["read"])
  assert.deepEqual(loaded.unavailableToolIds, ["removed-tool"])
  assert.equal(loaded.revision, 1)
  await assert.rejects(
    apply({ revision: loaded.revision, toolIds: loaded.toolIds }),
    /不可用/,
  )
  const saved = await apply({ revision: loaded.revision, toolIds: ["read"] })
  assert.equal(saved.revision, 2)
  assert.deepEqual(saved.unavailableToolIds, [])
})

test("missing dependency returns recoverable saved selection instead of a read failure", async (t) => {
  const { service, apply } = await fixture(t)
  await apply()
  const availability = service.sessions.availability.bind(service.sessions)
  service.sessions.availability = (name) =>
    name === "read" ? "fixture dependency unavailable" : availability(name)
  const loaded = await service.dispatch("sessionRead", {
    sessionId: "session-a",
  })
  assert.deepEqual(loaded.toolIds, ["read"])
  assert.deepEqual(loaded.unavailableToolIds, ["read"])
  assert.deepEqual(loaded.effectiveToolIds, [])
  const saved = await apply({ revision: loaded.revision, toolIds: [] })
  assert.equal(saved.revision, 2)
})
