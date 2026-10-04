import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "node:http"
import { SessionManager } from "@earendil-works/pi-coding-agent"
import { McpService, nestedMcpTools, mcpResultsIndex } from "../mcp.mjs"
import { ModelService } from "../models.mjs"
import lockfile from "proper-lockfile"
const protocolServer = fileURLToPath(
  new URL("./fixtures/mcp-protocol-server.mjs", import.meta.url)
)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "moon-mcp-"))
  const cwd = join(root, "workspace")
  await mkdir(cwd)
  await writeFile(join(cwd, "真实笔记.txt"), "MCP_REAL_FILE_CONTENT")
  const directory = join(root, "data")
  const counter = join(root, "started.txt")
  const mcp = new McpService(directory)
  const cleanup = []
  t.after(async () => {
    for (const close of cleanup.reverse()) await close()
    await mcp.close()
    await rm(root, { recursive: true, force: true })
  })
  const configuration = {
    name: "files",
    transport: "stdio",
    command: process.execPath,
    args: [protocolServer, cwd, counter],
    cwd: "",
    env: [],
    url: "",
    headers: [],
    description: "真实本地文件",
    enabled: true,
    exposure: "codemode",
    timeout: 10,
  }
  return { root, cwd, directory, counter, mcp, configuration, cleanup }
}
async function processIds(counter) {
  return (await readFile(counter, "utf8")).trim().split("\n").map(Number)
}
async function waitForTool(session, name = "mcp__files__read_text") {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (session.getCallableToolNames().includes(name)) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail(`MCP tool did not become callable: ${name}`)
}
async function liveFixture(t, delay = 0) {
  const value = await fixture(t)
  const configuration = {
    ...value.configuration,
    exposure: "direct",
    args: [...value.configuration.args, String(delay)],
  }
  await value.mcp.test(configuration, value.cwd)
  await value.mcp.save(configuration)
  const service = new ModelService(value.directory)
  await service.initialize()
  value.cleanup.push(() => service.close())
  const config = await service.sessions.apply(
    "sample",
    value.cwd,
    ["read", "mcp__files__read_text"],
    "none"
  )
  const session = await service.sessions.create(
    value.cwd,
    [],
    config.toolIds,
    undefined,
    false,
    { sessionManager: SessionManager.inMemory(value.cwd) }
  )
  service.sessions.active.get("sample").session.dispose()
  service.sessions.active.set("sample", {
    session,
    revision: config.revision,
    persistent: true,
    busy: false,
  })
  return { ...value, configuration, service, session, config }
}
test("MCP CRUD is revisioned, Pi-compatible and does not connect while browsing", async (t) => {
  const { mcp, configuration, counter } = await fixture(t)
  const saved = await mcp.save(configuration)
  assert.equal(saved.revision, 1)
  assert.equal((await mcp.list()).length, 1)
  await assert.rejects(readFile(counter), { code: "ENOENT" })
  const document = JSON.parse(await readFile(mcp.file, "utf8"))
  assert.equal(document.mcpServers.files.command, process.execPath)
  await assert.rejects(
    mcp.save({ ...configuration, description: "stale" }),
    /已变化/
  )
  const updated = await mcp.save(
    { ...configuration, enabled: false },
    saved.revision
  )
  await assert.rejects(mcp.remove("files", saved.revision), (error) => {
    assert.equal(error.issue.code, "mcp_revision_conflict")
    assert.equal(error.issue.recovery, "reload")
    return true
  })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(mcp.remove("files", updated.revision, controller.signal))
  assert.equal((await mcp.list()).length, 1)
  await mcp.remove("files", updated.revision)
  assert.equal((await mcp.list()).length, 0)
})
test("stdio test discovers real tools, closes its process and persists only matching saved metadata", async (t) => {
  const { mcp, configuration, cwd, directory, cleanup } = await fixture(t)
  const tested = await mcp.test(configuration, cwd)
  assert.equal(tested.state, "connected")
  assert.equal(tested.tools[0].id, "mcp__files__read_text")
  assert.equal((await mcp.list()).length, 0)
  await mcp.save(configuration)
  const reopened = new McpService(directory)
  cleanup.push(() => reopened.close())
  assert.equal((await reopened.catalog())[0].id, "mcp__files__read_text")
  assert.equal((await reopened.list())[0].runtime, undefined)
})
test("real session uses hidden exact exposure and catalog/configuration creates no MCP processes", async (t) => {
  const { mcp, configuration, cwd, directory, counter, cleanup } =
    await fixture(t)
  await mcp.test(configuration, cwd)
  await mcp.save(configuration)
  const before = (await readFile(counter, "utf8")).trim().split("\n").length
  const service = new ModelService(directory)
  await service.initialize()
  cleanup.push(() => service.close())
  const toolIds = ["read", "mcp__files__read_text"]
  await service.sessions.catalog(cwd)
  await service.sessions.apply("sample", cwd, toolIds, "none")
  assert.equal(
    (await readFile(counter, "utf8")).trim().split("\n").length,
    before
  )
  const session = await service.sessions.create(
    cwd,
    [],
    toolIds,
    undefined,
    false,
    { sessionManager: SessionManager.inMemory(cwd) }
  )
  cleanup.push(() => session.dispose())
  for (
    let attempt = 0;
    attempt < 100 &&
    !session
      .getAllTools()
      .some((tool) => tool.name === "mcp__files__read_text");
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(session.getCallableToolNames().includes("mcp__files__read_text"))
  assert.ok(
    !session.getCallableToolNames().includes("mcp__files__never_selected")
  )
  assert.equal(
    session
      .getAllTools()
      .find((tool) => tool.name === "mcp__files__never_selected").exposure,
    "hidden"
  )
  const availability = service.sessions.availability.bind(service.sessions)
  service.sessions.availability = (name) =>
    name === "read" ? "fixture dependency unavailable" : availability(name)
  const snapshot = service.sessions.snapshot({ toolIds }, session)
  assert.deepEqual(snapshot.unavailableToolIds, ["read"])
  assert.deepEqual(snapshot.effectiveToolIds, ["codemode", "tool_search"])
  assert.ok(session.getCallableToolNames().includes("mcp__files__read_text"))
  assert.ok(!session.getActiveToolNames().includes("mcp__files__read_text"))
  assert.ok(
    !session.getCallableToolNames().includes("mcp__files__never_selected")
  )
})
test("nested MCP successful results follow Pi occurrence identity even when provider IDs are reused", () => {
  const records = mcpResultsIndex([
    {
      type: "custom",
      customType: "moon-mcp-result",
      data: {
        parentEntryId: "entry-a",
        parentIndex: 0,
        toolCallId: "call/1",
        result: "FIRST",
        source: "MCP · files",
      },
    },
    {
      type: "custom",
      customType: "moon-mcp-result",
      data: {
        parentEntryId: "entry-b",
        parentIndex: 0,
        toolCallId: "call/1",
        result: "SECOND",
        source: "MCP · files",
      },
    },
  ])
  const result = {
    nestedCalls: {
      calls: [
        {
          id: "call/1",
          name: "mcp__files__read_text",
          arguments: { path: "note.txt" },
          status: "ok",
          durationMs: 3,
        },
      ],
      complete: true,
    },
  }
  assert.equal(
    nestedMcpTools(
      result,
      records,
      { entryId: "entry-a", index: 0 },
      () => undefined
    )[0].result,
    "FIRST"
  )
  assert.equal(
    nestedMcpTools(
      result,
      records,
      { entryId: "entry-b", index: 0 },
      () => undefined
    )[0].result,
    "SECOND"
  )
})

test("Streamable HTTP verification uses real HTTP and identifies missing authentication", async (t) => {
  const { mcp, configuration, cwd, cleanup } = await fixture(t)
  let needsAuth = false
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(405)
      response.end()
      return
    }
    if (request.method === "DELETE") {
      response.writeHead(204)
      response.end()
      return
    }
    if (needsAuth) {
      response.writeHead(401, { "www-authenticate": "Bearer" })
      response.end("Unauthorized")
      return
    }
    let body = ""
    for await (const chunk of request) body += chunk
    const message = JSON.parse(body)
    if (message.id === undefined) {
      response.writeHead(202)
      response.end()
      return
    }
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "initialize"
            ? {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: {
                  name: "moon-real-http-fixture",
                  version: "1.0.0",
                },
              }
            : {
                tools: [
                  {
                    name: "http_tool",
                    description: "真实 HTTP 工具目录",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              },
      })
    )
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise((resolve) => server.close(resolve)))
  const http = {
    ...configuration,
    name: "http",
    transport: "http",
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    command: "",
    args: [],
  }
  const success = await mcp.test(http, cwd)
  assert.equal(success.state, "connected")
  assert.equal(success.tools[0].id, "mcp__http__http_tool")
  needsAuth = true
  assert.equal((await mcp.test(http, cwd)).state, "needs-auth")
})

test("cancelling a real stdio initialization waits for owned child cleanup", async (t) => {
  const { mcp, configuration, cwd, counter } = await fixture(t)
  const controller = new AbortController()
  const running = mcp.test(
    { ...configuration, args: [...configuration.args, "10000"] },
    cwd,
    controller.signal
  )
  const rejected = assert.rejects(running)
  let pid
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      pid = Number((await readFile(counter, "utf8")).trim())
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  assert.ok(pid)
  controller.abort()
  await rejected
  assert.throws(() => process.kill(pid, 0))
  assert.equal(mcp.clients.size, 0)
})

test("same live session reopens real stdio exactly once after configuration and global MCP changes", async (t) => {
  const { service, session, config, cwd, counter, configuration } =
    await liveFixture(t)
  await waitForTool(session)
  const first = (await processIds(counter)).at(-1)
  const original = session
  await service.sessions.apply(
    "sample",
    cwd,
    ["mcp__files__read_text"],
    "none",
    config.revision
  )
  assert.equal(service.sessions.active.get("sample").session, original)
  assert.throws(() => process.kill(first, 0))
  await waitForTool(session)
  let ids = await processIds(counter)
  assert.equal(ids.length, 3, "validation plus exactly two runtime instances")
  const second = ids.at(-1)
  const call = () =>
    session
      .getToolDefinition("mcp__files__read_text")
      .execute("reload-read", { path: "真实笔记.txt" })
  assert.equal((await call()).content[0].text, "MCP_REAL_FILE_CONTENT")
  assert.ok(
    !session.getCallableToolNames().includes("mcp__files__never_selected")
  )

  const changed = { ...configuration, description: "更新后的真实本地文件" }
  await service.mcp.test(changed, cwd)
  const saved = await service.mcp.save(
    changed,
    (await service.mcp.list())[0].revision
  )
  const beforeGlobalReload = (await processIds(counter)).length
  await service.sessions.exclusive("sample", () =>
    service.sessions.refreshForRunExclusive("sample")
  )
  assert.throws(() => process.kill(second, 0))
  await waitForTool(session)
  ids = await processIds(counter)
  assert.equal(ids.length, beforeGlobalReload + 1)
  assert.equal((await call()).content[0].text, "MCP_REAL_FILE_CONTENT")
  const third = ids.at(-1)
  await service.mcp.save({ ...changed, enabled: false }, saved.revision)
  await assert.rejects(
    service.sessions.exclusive("sample", () =>
      service.sessions.refreshForRunExclusive("sample")
    ),
    /停用、删除或失效/
  )
  assert.throws(() => process.kill(third, 0))
  assert.ok(!session.getCallableToolNames().includes("mcp__files__read_text"))
})

test("removing selected MCP during real stdio initialization awaits the uninitialized owned process", async (t) => {
  const { service, session, config, cwd, counter } = await liveFixture(t, 2000)
  let ids
  for (let attempt = 0; attempt < 100; attempt++) {
    ids = await processIds(counter)
    if (ids.length === 2) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(ids.length, 2)
  assert.ok(!session.getCallableToolNames().includes("mcp__files__read_text"))
  const initializing = ids.at(-1)
  await service.sessions.apply("sample", cwd, ["read"], "none", config.revision)
  assert.throws(() => process.kill(initializing, 0))
  assert.equal(service.sessions.resources.get(session).transports.size, 0)
  assert.ok(!session.getCallableToolNames().includes("mcp__files__read_text"))
  assert.equal((await processIds(counter)).length, 2)
})

test("official extension binding persists safe host diagnostics and restarts once on reload", async (t) => {
  const { directory, cwd, cleanup } = await fixture(t)
  const service = new ModelService(directory)
  await service.initialize()
  cleanup.push(() => service.close())
  let starts = 0
  const session = await service.sessions.create(
    cwd,
    [],
    ["read"],
    undefined,
    false,
    {
      extensionFactories: [
        (pi) => {
          pi.on("session_start", () => {
            starts++
            throw new Error("Bearer should-never-appear-in-diagnostics")
          })
        },
      ],
    }
  )
  cleanup.push(() => session.dispose())
  await session.reload()
  assert.equal(starts, 2, "one startup and exactly one official reload event")
  const diagnostics = session.sessionManager
    .getBranch()
    .filter(
      (entry) =>
        entry.type === "custom" && entry.customType === "moon-extension-error"
    )
  assert.equal(diagnostics.length, 2)
  assert.equal(diagnostics[1].data.event, "session_start")
  assert.ok(diagnostics[1].data.occurredAt)
  assert.ok(!JSON.stringify(diagnostics).includes("should-never-appear"))
  assert.ok(!JSON.stringify(diagnostics).includes("Bearer"))
})

test("MCP unlock failure after atomic commit requires checking and never claims an uncommitted write", async (t) => {
  const { mcp, configuration } = await fixture(t)
  const acquire = lockfile.lock
  t.mock.method(lockfile, "lock", async (...args) => {
    const release = await acquire(...args)
    return async () => {
      await release()
      throw Object.assign(new Error("PRIVATE_FIXTURE_UNLOCK_PATH"), {
        code: "EPERM",
      })
    }
  })
  await assert.rejects(mcp.save(configuration), (error) => {
    assert.equal(error.issue.code, "result_unknown")
    assert.equal(error.issue.recovery, "check")
    assert.equal(error.issue.severity, "warning")
    assert.doesNotMatch(
      JSON.stringify(error.issue),
      /PRIVATE_FIXTURE_UNLOCK_PATH/
    )
    return true
  })
  const records = await mcp.list()
  assert.equal(records.length, 1)
  assert.equal(records[0].configuration.name, configuration.name)
  assert.equal(records[0].revision, 1)
})
