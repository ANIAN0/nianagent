import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createBoundedJsonlLogger,
  diagnosticFrames,
  DIAGNOSTIC_LIMITS,
} from "./logger.mjs"

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "moon-diagnostics-"))
  const logger = createBoundedJsonlLogger({
    directory,
    name: "test",
    ...options,
  })
  t.after(async () => {
    await logger.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { logger, directory, file: join(directory, "test.jsonl") }
}
const record = (event, extra = {}) => ({
  level: "info",
  module: "fixture",
  event,
  traceId: "trace-1",
  outcome: "committed",
  ...extra,
})

test("单writer并发记录恰好一次，读取默认不产生INFO，过滤与关闭明确", async (t) => {
  const { logger } = await fixture(t)
  for (let i = 0; i < 300; i++) logger.append(record(`event-${i}`))
  logger.append(record("poll", { level: "debug" }))
  await logger.flush()
  const all = await logger.query({ limit: 500 })
  assert.equal(all.length, 300)
  assert.equal(new Set(all.map((item) => item.event)).size, 300)
  assert.equal((await logger.query({ module: "other" })).length, 0)
  assert.equal((await logger.query({ traceId: "trace-1", limit: 3 })).length, 3)
  await assert.rejects(logger.query({ limit: 0 }), /参数/)
  await assert.rejects(logger.query({ from: "invalid" }), /参数/)
  await logger.close()
  assert.throws(() => logger.append(record("late")), /关闭/)
})

test("队列严格4MiB、优先挤出debug并保留warn，丢弃计数含在途写失败", async (t) => {
  const { logger, file } = await fixture(t, { level: "debug" })
  const frames = " at fixture (fixture.mjs:1:1)".repeat(60)
  for (let i = 0; i < 6500; i++)
    logger.append(record(`debug-${i}`, { level: "debug", error: { frames } }))
  for (let i = 0; i < 10; i++)
    logger.append(record(`important-${i}`, { level: "warn" }))
  assert.ok(logger.status().queuedBytes <= DIAGNOSTIC_LIMITS.queue)
  assert.ok(logger.dropped() > 0)
  await logger.flush()
  const lines = (await readFile(file, "utf8")).trim().split("\n")
  assert.equal(lines.length + logger.dropped(), 6510)
  assert.equal(
    lines.filter((line) => JSON.parse(line).level === "warn").length,
    10
  )
  assert.ok(
    lines.every(
      (line) => Buffer.byteLength(line) + 1 <= DIAGNOSTIC_LIMITS.record
    )
  )
})

test("磁盘失败显式计数且不改变调用结果，恢复后继续写，不递归泄漏错误文本", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moon-log-fault-"))
  const directory = join(root, "blocked")
  await writeFile(directory, "occupied")
  const logger = createBoundedJsonlLogger({ directory })
  t.after(async () => {
    await logger.close()
    await rm(root, { recursive: true, force: true })
  })
  for (let i = 0; i < 30; i++) logger.append(record(`failure-${i}`))
  await logger.flush()
  assert.equal(logger.dropped(), 30)
  assert.match(logger.issue(), /日志写入失败/)
  assert.ok(!logger.issue().includes(root))
  await rm(directory)
  await mkdir(directory)
  await logger.append(record("recovered"))
  assert.equal(logger.issue(), "")
  assert.equal((await logger.query())[0].event, "recovered")
  assert.equal(logger.dropped(), 30)
})

test("14日保留清理实际文件，坏行必须显式失败而非空成功", async (t) => {
  const { logger, file } = await fixture(t)
  const old = {
    ...record("expired"),
    schemaVersion: 1,
    timestamp: new Date(Date.now() - 15 * 86400000).toISOString(),
  }
  await writeFile(file, JSON.stringify(old) + "\n")
  await logger.append(record("current"))
  assert.ok(!(await readFile(file, "utf8")).includes("expired"))
  await writeFile(file, "{broken\n")
  await assert.rejects(logger.query(), /第 1 行损坏/)
})

test("轮转最多两个8MiB文件，单条不丢身份且不保存载荷和异常首行", async (t) => {
  const { logger, file } = await fixture(t)
  const error = new Error("PRIVATE_PROMPT_SENTINEL")
  const frames = diagnosticFrames(error)
  assert.ok(!frames.includes("PRIVATE_PROMPT_SENTINEL"))
  const payload = {
    error: {
      code: "internal_error",
      errorId: "12345678",
      cause: "Authorization: Bearer SECRET_SENTINEL",
      frames: " at fixture (fixture.mjs:1:1)".repeat(60),
    },
    input: "PRIVATE_BODY",
  }
  for (let batch = 0; batch < 8; batch++) {
    for (let i = 0; i < 700; i++)
      logger.append(record(`record-${batch}-${i}`, payload))
    await logger.flush()
  }
  assert.ok((await stat(file)).size <= DIAGNOSTIC_LIMITS.file)
  assert.ok((await stat(`${file}.1`)).size <= DIAGNOSTIC_LIMITS.file)
  const text = await readFile(file, "utf8")
  assert.ok(!text.includes("SECRET_SENTINEL") && !text.includes("PRIVATE_BODY"))
  assert.equal(
    (await logger.query({ errorId: "12345678", limit: 2 })).length,
    2
  )
})

test("后台重复故障首条加计数汇总，前台失败不合并", async (t) => {
  const { logger } = await fixture(t)
  for (let i = 0; i < 100; i++)
    logger.append(
      record("background", { level: "warn", repeatKey: "connection" })
    )
  for (let i = 0; i < 3; i++)
    logger.append(
      record("foreground", {
        level: "error",
        error: { errorId: `err0000${i}` },
      })
    )
  const records = await logger.query()
  assert.equal(records.filter((item) => item.event === "background").length, 2)
  assert.equal(records.find((item) => item.repeated)?.repeated, 99)
  assert.equal(records.filter((item) => item.event === "foreground").length, 3)
})
