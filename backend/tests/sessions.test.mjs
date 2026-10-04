import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import filesystem from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
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
    "MUST_NOT_LOAD_HIDDEN_APPEND"
  )
  await writeFile(
    join(directory, "agent", "AGENTS.md"),
    "MOON_TEST_GLOBAL_INSTRUCTIONS"
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
      signal
    )
  return { root, cwd, directory, service, apply }
}

test("session catalog and configuration use real Pi without a configured model", async (t) => {
  const { service, cwd, apply } = await fixture(t)
  const catalog = await service.dispatch("sessionCatalog", { cwd })
  assert.ok(catalog.tools.some((tool) => tool.id === "read"))
  assert.ok(catalog.tools.some((tool) => tool.id === "write"))
  assert.ok(
    !catalog.tools.some((tool) => tool.id === "browser" || tool.id === "shell")
  )
  assert.equal(
    catalog.instructions.filter((file) => file.source === "global").length,
    1
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
      file.content.includes("MOON_TEST_DIRECTORY")
    )
  )
  assert.ok(
    !snapshot.instructions.some((file) =>
      file.content.includes("CHANGED_AFTER_COMMIT")
    )
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
    ["read"]
  )
  const updated = await apply({
    revision: first.revision,
    instructionScope: "all",
  })
  assert.ok(
    updated.instructions.some((file) =>
      file.content.includes("CHANGED_AFTER_COMMIT")
    )
  )
})

test("host runtime guidance survives no project instructions and cannot be replaced by hidden Pi prompt files", async (t) => {
  const { service, root, directory, apply } = await fixture(t)
  const cwd = join(root, "中文 工作目录")
  await mkdir(join(cwd, ".pi"), { recursive: true })
  await writeFile(join(cwd, "AGENTS.md"), "UNLOADED_DIRECTORY_CONTEXT")
  await writeFile(join(cwd, ".pi", "SYSTEM.md"), "HIDDEN_DIRECTORY_REPLACEMENT")
  await writeFile(
    join(cwd, ".pi", "APPEND_SYSTEM.md"),
    "HIDDEN_DIRECTORY_APPEND"
  )
  await writeFile(
    join(directory, "agent", "SYSTEM.md"),
    "HIDDEN_GLOBAL_REPLACEMENT"
  )
  await writeFile(
    join(directory, "agent", "APPEND_SYSTEM.md"),
    "HIDDEN_GLOBAL_APPEND"
  )
  const configuration = await apply({ cwd, instructionScope: "none" })
  assert.deepEqual(configuration.instructions, [])
  const session = service.sessions.active.get("session-a").session
  const prompt = session.systemPrompt
  assert.ok(prompt.includes("Moon host runtime"))
  assert.ok(prompt.includes(JSON.stringify(configuration.cwd)))
  assert.ok(prompt.includes("Prefer paths relative to this working directory"))
  assert.ok(!prompt.includes("UNLOADED_DIRECTORY_CONTEXT"))
  assert.ok(!prompt.includes("HIDDEN_"))
  assert.ok(!prompt.includes("MOON_TEST_GLOBAL_INSTRUCTIONS"))
  if (process.platform === "win32") {
    assert.ok(prompt.includes("Windows (win32)"))
    assert.ok(prompt.includes('cygpath -w "$PWD"'))
    assert.ok(
      prompt.includes("Never guess drive letters or shell mount mappings")
    )
  }
})

test("conflicts and invalid configuration preserve committed state", async (t) => {
  const { service, cwd, root, apply } = await fixture(t)
  await apply()
  await assert.rejects(apply(), /版本/)
  await assert.rejects(apply({ revision: 1, toolIds: ["browser"] }), /不可用/)
  await assert.rejects(
    apply({ revision: 1, toolIds: ["read", "read"] }),
    /重复/
  )
  await assert.rejects(
    apply({ revision: 1, cwd: join(root, "missing") }),
    /不存在/
  )
  await assert.rejects(apply({ revision: 1, cwd: root }), /更换工作目录/)
  await assert.rejects(apply({ sessionId: "__proto__" }), /标识/)
  const results = await Promise.allSettled([
    apply({ revision: 1, toolIds: ["read", "write"] }),
    apply({ revision: 1, toolIds: [] }),
  ])
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  )
  assert.equal(
    (await service.dispatch("sessionRead", { sessionId: "session-a" }))
      .revision,
    2
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
    saved
  )
})

test("retrying an identical configuration with its original version commits at most once", async (t) => {
  const { service, apply } = await fixture(t)
  const previous = await apply()
  const input = {
    revision: previous.revision,
    toolIds: ["read", "write"],
    instructionScope: "none",
  }
  const results = await Promise.allSettled([apply(input), apply(input)])
  assert.equal(
    results.filter((value) => value.status === "fulfilled").length,
    1
  )
  const refused = results.find((value) => value.status === "rejected")
  assert.equal(refused.reason.issue.code, "session_revision_conflict")
  assert.equal(refused.reason.issue.recovery, "reload")
  const snapshot = await service.dispatch("sessionRead", {
    sessionId: "session-a",
  })
  assert.equal(snapshot.revision, previous.revision + 1)
  assert.deepEqual(snapshot.toolIds, input.toolIds)
  assert.equal(snapshot.instructionScope, input.instructionScope)
  const disk = JSON.parse(await readFile(service.sessions.file, "utf8"))
  assert.equal(disk.sessions["session-a"].revision, snapshot.revision)
})

test("a failed precommit attempt can be retried using the same original version", async (t) => {
  const { service, apply } = await fixture(t)
  const previous = await apply()
  const originalRename = filesystem.rename
  const mocked = t.mock.method(filesystem, "rename", async (...args) => {
    if (args[1] === service.sessions.file)
      throw Object.assign(new Error("ENOSPC rename"), { code: "ENOSPC" })
    return originalRename(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  const input = { revision: previous.revision, toolIds: [] }
  await assert.rejects(apply(input), /ENOSPC/)
  assert.equal(
    (await service.dispatch("sessionRead", { sessionId: "session-a" }))
      .revision,
    previous.revision
  )
  mocked.mock.restore()
  syncBuiltinESMExports()
  const saved = await apply(input)
  assert.equal(saved.revision, previous.revision + 1)
  assert.deepEqual(saved.toolIds, [])
  await assert.rejects(
    apply(input),
    (error) => error.issue?.code === "session_revision_conflict"
  )
  assert.equal(
    (await service.dispatch("sessionRead", { sessionId: "session-a" }))
      .revision,
    saved.revision
  )
})

test("read waits for the earlier same-session apply to reach its final result", async (t) => {
  const { service, apply } = await fixture(t)
  const previous = await apply()
  const originalCreate = service.sessions.create.bind(service.sessions)
  let entered
  let release
  const creating = new Promise((resolve) => {
    entered = resolve
  })
  const proceed = new Promise((resolve) => {
    release = resolve
  })
  t.mock.method(service.sessions, "create", async (...args) => {
    entered()
    await proceed
    return originalCreate(...args)
  })
  const applying = apply({ revision: previous.revision, toolIds: [] })
  await creating
  const reading = service.dispatch("sessionRead", { sessionId: "session-a" })
  release()
  const saved = await applying
  const snapshot = await reading
  assert.equal(snapshot.revision, saved.revision)
  assert.deepEqual(snapshot.toolIds, [])
})

test("committed apply and copied configuration do not clean paths consumed by rename", async (t) => {
  const { service, apply } = await fixture(t)
  const previous = await apply()
  const originalRemove = filesystem.rm
  let attempts = 0
  const mocked = t.mock.method(filesystem, "rm", async (...args) => {
    if (
      String(args[0]).startsWith(join(service.sessions.directory, ".sessions-"))
    ) {
      attempts++
      throw Object.assign(new Error("EPERM cleanup"), { code: "EPERM" })
    }
    return originalRemove(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  const saved = await apply({ revision: previous.revision, toolIds: [] })
  const copied = await service.sessions.copyConfiguration(
    "copied-session",
    saved
  )
  assert.equal(attempts, 0)
  assert.equal(saved.revision, previous.revision + 1)
  assert.equal(copied.revision, 1)
  const disk = JSON.parse(await readFile(service.sessions.file, "utf8"))
  assert.deepEqual(disk.sessions["session-a"].toolIds, [])
  assert.deepEqual(disk.sessions["copied-session"].toolIds, [])
  assert.equal(
    service.sessions.active.get("session-a").revision,
    saved.revision
  )
})

test("unlock failures after apply or copy preserve saved state and require confirmation", async (t) => {
  const { service, apply } = await fixture(t)
  const previous = await apply()
  const originalLock = lockfile.lock.bind(lockfile)
  let fail = true
  const mocked = t.mock.method(lockfile, "lock", async (...args) => {
    const unlock = await originalLock(...args)
    return async () => {
      await unlock()
      if (fail && args[0] === service.sessions.directory) {
        fail = false
        throw Object.assign(new Error("EBUSY unlock"), { code: "EBUSY" })
      }
    }
  })
  t.after(() => mocked.mock.restore())
  const unknown = (error) =>
    error.issue?.code === "result_unknown" &&
    error.issue.recovery === "check" &&
    error.issue.severity === "warning"
  await assert.rejects(
    apply({ revision: previous.revision, toolIds: [] }),
    unknown
  )
  const snapshot = await service.dispatch("sessionRead", {
    sessionId: "session-a",
  })
  assert.equal(snapshot.revision, previous.revision + 1)
  assert.deepEqual(snapshot.toolIds, [])
  fail = true
  await assert.rejects(
    service.sessions.copyConfiguration("copied-session", snapshot),
    unknown
  )
  const disk = JSON.parse(await readFile(service.sessions.file, "utf8"))
  assert.equal(disk.sessions["session-a"].revision, snapshot.revision)
  assert.equal(disk.sessions["copied-session"].revision, 1)
  assert.deepEqual(disk.sessions["copied-session"].toolIds, [])
})

test("corrupt session data is not replaced by empty defaults", async (t) => {
  const { service, apply } = await fixture(t)
  await apply()
  await writeFile(service.sessions.file, "{broken")
  await assert.rejects(
    service.dispatch("sessionRead", { sessionId: "session-a" }),
    /损坏/
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
    /不存在/
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
    /不可用/
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
  assert.deepEqual(
    service.sessions.active.get("session-a").session.getActiveToolNames(),
    []
  )
  service.sessions.availability = availability
  const restored = await service.dispatch("sessionRead", {
    sessionId: "session-a",
  })
  assert.deepEqual(restored.toolIds, ["read"])
  assert.deepEqual(restored.unavailableToolIds, [])
  assert.deepEqual(restored.effectiveToolIds, ["read"])
  assert.equal(restored.revision, loaded.revision)
  const saved = await apply({ revision: loaded.revision, toolIds: [] })
  assert.equal(saved.revision, 2)
})
