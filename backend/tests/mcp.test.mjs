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
  await assert.rejects(mcp.remove("files", saved.revision), /版本已变化/)
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
  assert.ok(!session.getCallableToolNames().includes("mcp__files__never_selected"))
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
