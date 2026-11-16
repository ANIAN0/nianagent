import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBoundedJsonlLogger } from "./logger.mjs"
import { createDiagnosticQuery } from "./diagnostic-query.mjs"
import { activate } from "./plugins/logs/host.mjs"

test("统一诊断查询合并Node/Rust、按错误身份/时间/模块过滤，出口再次脱敏", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "moon-log-query-"))
  const logger = createBoundedJsonlLogger({ directory })
  t.after(async () => {
    await logger.close()
    await rm(directory, { recursive: true, force: true })
  })
  const at = new Date().toISOString()
  await logger.append({
    level: "error",
    module: "workbench",
    event: "publish",
    traceId: "same-trace",
    outcome: "unknown",
    error: { errorId: "abcd1234", code: "internal_error", cause: "安全摘要" },
  })
  const rust = {
    schemaVersion: 1,
    timestamp: at,
    level: "warn",
    process: "moon-rust-1",
    module: "desktop",
    event: "model_request",
    traceId: "same-trace",
    operationId: "rust-operation",
    outcome: "unknown",
    error: {
      errorId: "abcd1234",
      code: "internal_error",
      cause: "Bearer SECRET_SENTINEL",
    },
  }
  await writeFile(
    join(directory, "moon-rust.jsonl"),
    JSON.stringify(rust) + "\n"
  )
  await writeFile(
    join(directory, "moon-rust-status.json"),
    JSON.stringify({ dropped: 7, issue: "磁盘写入失败" })
  )
  const port = createDiagnosticQuery(directory, logger)
  const plugin = await activate({ operationLog: port, logs: {} })
  const { value } = await plugin.operations.operationQuery.execute({
    traceId: "same-trace",
  })
  assert.equal(value.records.length, 2)
  assert.deepEqual(
    new Set(value.records.map((record) => record.module)),
    new Set(["desktop", "workbench"])
  )
  assert.ok(!JSON.stringify(value).includes("SECRET_SENTINEL"))
  assert.equal(value.dropped, 7)
  assert.match(value.issue, /磁盘/)
  assert.equal(
    (await port.query({ module: "desktop", errorId: "abcd1234", from: at }))
      .length,
    1
  )
  assert.equal((await port.query({ errorId: "other" })).length, 0)
  await writeFile(join(directory, "moon-rust.jsonl"), "invalid\n")
  await assert.rejects(port.query(), /损坏/)
})

test("实际工具活动身份字段符合查看契约，额外载荷不进入文件", async (t) => {
  const { ActivityLog } = await import("./activity-log.mjs")
  const { validatePluginValue } = await import("./plugin-helpers.mjs")
  const directory = await mkdtemp(join(tmpdir(), "moon-activity-contract-"))
  const logs = new ActivityLog(directory)
  t.after(async () => {
    await logs.close()
    await rm(directory, { recursive: true, force: true })
  })
  await logs.append({
    source: "tool",
    plugin: "notes-workbench",
    tool: "publish_version",
    status: "succeeded",
    actorId: "agent-A",
    credentialId: "credential-A",
    rawPayload: "PRIVATE_BODY_SENTINEL",
  })
  const plugin = await activate({ logs })
  const page = await plugin.operations.query.execute({ limit: 50 })
  validatePluginValue(plugin.operations.query.output, page)
  assert.equal(page.value.entries[0].actorId, "agent-A")
  assert.equal(page.value.entries[0].credentialId, "credential-A")
  assert.ok(!JSON.stringify(page).includes("PRIVATE_BODY_SENTINEL"))
  const detail = await plugin.operations.detail.execute({
    id: page.value.entries[0].id,
  })
  validatePluginValue(plugin.operations.detail.output, detail)
})
