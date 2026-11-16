import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import http from "node:http"
import { validateDomains, validateStorage } from "./storage-validation.mjs"

test("领域健康只消费只读端口，损坏与慢域不冒充健康，维护严格拒绝", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-health-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const readers = Object.fromEntries(
    [
      "models",
      "conversations",
      "sessions",
      "mcp",
      "workspaces",
      "queueDocument",
    ].map((name) => [name, async () => ({})])
  )
  assert.ok(
    (await validateDomains(readers, directory)).domains.every((item) => item.ok)
  )
  readers.models = async () => {
    throw new Error("模型损坏")
  }
  const damaged = await validateDomains(readers, directory)
  assert.equal(damaged.readable, true)
  assert.equal(damaged.domains.find((item) => item.name === "models").ok, false)
  assert.ok(
    damaged.domains
      .filter((item) => item.name !== "models")
      .every((item) => item.ok)
  )
  await assert.rejects(validateStorage(readers, directory), /模型损坏/)
  readers.models = () => new Promise(() => {})
  const started = Date.now()
  const slow = await validateDomains(readers, directory)
  assert.match(
    slow.domains.find((item) => item.name === "models").issue,
    /超时/
  )
  assert.ok(Date.now() - started < 15_000)
  assert.ok(
    slow.domains
      .filter((item) => item.name !== "models")
      .every((item) => item.ok)
  )
})

test(
  "真实RPC子进程：坏模型不阻断工作台、冻结拒新、恢复及严格关闭",
  { timeout: 90000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "moon-startup-"))
    const reservation = http.createServer()
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    await mkdir(join(directory, "plugins", "notes-workbench"), {
      recursive: true,
    })
    const entries = Object.fromEntries(
      (
        await readdir(new URL("./plugins/", import.meta.url), {
          withFileTypes: true,
        })
      )
        .filter((item) => item.isDirectory())
        .map((item) => [
          item.name,
          {
            enabled: item.name === "notes-workbench",
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
    const child = spawn(process.execPath, ["backend/rpc.mjs"], {
      env: {
        ...process.env,
        MOON_DATA_DIR: directory,
        MOON_RUNTIME_FILE: join(directory, "runtime.json"),
        MOON_NOTES_DEV: "1",
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let exited = false
    const exit = new Promise((resolve) =>
      child.once("exit", (code) => {
        exited = true
        resolve(code)
      })
    )
    t.after(async () => {
      child.stdin.end()
      const timer = setTimeout(() => {
        if (!exited) child.kill()
      }, 10000)
      await exit
      clearTimeout(timer)
      await rm(directory, { recursive: true, force: true })
    })
    const pending = new Map(),
      unexpected = []
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    createInterface({ input: child.stdout }).on("line", (line) => {
      let value
      try {
        value = JSON.parse(line)
      } catch {
        unexpected.push(line)
        return
      }
      pending.get(value.id)?.(value)
      pending.delete(value.id)
    })
    let sequence = 0
    const request = (operation, input = {}) =>
      new Promise((resolve, reject) => {
        const id = `accept-${++sequence}`
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`超时：${operation}；stderr：${stderr}`))
        }, 45000)
        pending.set(id, (value) => {
          clearTimeout(timer)
          resolve(value)
        })
        child.stdin.write(JSON.stringify({ id, operation, input }) + "\n")
      })
    assert.equal((await request("$validateStorage")).result.readable, true)
    await writeFile(join(directory, "models.json"), "{invalid")
    const broken = await request("bootStatus")
    assert.equal(broken.result.readable, true)
    assert.equal(
      broken.result.domains.find((item) => item.name === "models").ok,
      false
    )
    const rejected = await request("list")
    assert.ok(rejected.error)
    assert.ok(rejected.issue.traceId)
    const runtime = JSON.parse(
      await readFile(join(directory, "runtime.json"), "utf8")
    )
    const httpResponse = await fetch(
      `http://127.0.0.1:${runtime.port}/api/models/list`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-moon-token": runtime.token,
        },
        body: "{}",
      }
    )
    const httpRejected = await httpResponse.json()
    assert.equal(httpResponse.status, 400)
    assert.ok(httpRejected.issue.traceId)
    assert.equal(
      await readFile(join(directory, "models.json"), "utf8"),
      "{invalid"
    )
    const ticketReply = await request("pluginCall", {
      id: "notes-workbench",
      operation: "ticket",
      payload: "{}",
    })
    assert.ok(!ticketReply.error, ticketReply.error)
    const ticket = JSON.parse(ticketReply.result.payload).value.ticket
    const page = await fetch(`http://127.0.0.1:${port}/?ticket=${ticket}`)
    assert.equal(page.status, 200)
    assert.ok((await page.text()).includes("window.__moonNotesWorkbenchToken="))
    const workbenchFailure = await request("pluginCall", {
      id: "notes-workbench",
      operation: "v2_read_version",
      payload: JSON.stringify({ draftId: "missing-diagnostic-draft" }),
    })
    assert.equal(workbenchFailure.issue.code, "not_found")
    assert.equal(workbenchFailure.issue.outcome, "rejected")
    assert.equal(
      (await request("$maintenance", { operationId: "m", action: "freeze" }))
        .result.frozen,
      true
    )
    assert.ok((await request("workspaceList")).error)
    assert.equal(
      (await request("$maintenance", { operationId: "m", action: "resume" }))
        .result.frozen,
      false
    )
    assert.ok(!(await request("workspaceList")).error)
    const closed = await request("$maintenance", {
      operationId: "m",
      action: "prepareShutdown",
      stopActive: true,
    })
    assert.equal(closed.result?.closed, true, JSON.stringify(closed))
    child.stdin.end()
    assert.equal(await exit, 0)
    assert.deepEqual(unexpected, [])
    const records = (
      await readFile(join(directory, "logs", "moon-node.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    for (const failure of [rejected, httpRejected]) {
      const record = records.find(
        (record) => record.error?.errorId === failure.issue.errorId
      )
      assert.ok(record, "传输错误与日志必须共用errorId")
      assert.equal(record.traceId, failure.issue.traceId)
      assert.equal(record.outcome, failure.issue.outcome)
    }
    assert.ok(
      !records.some(
        (record) =>
          record.event === "workspaceList" && record.outcome === "committed"
      ),
      "轮询读取不写INFO"
    )
    const workbenchRecords = records.filter(
      (record) => record.error?.errorId === workbenchFailure.issue.errorId
    )
    assert.equal(
      workbenchRecords.length,
      1,
      "领域已记录根因，RPC不得再次写同一失败"
    )
    assert.equal(workbenchRecords[0].module, "workbench")
    assert.equal(workbenchRecords[0].traceId, workbenchFailure.issue.traceId)
    assert.ok(workbenchRecords[0].operationId)
  }
)
