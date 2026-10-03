import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { setTimeout as delay } from "node:timers/promises"
import { ModelService } from "../models.mjs"
import { ConversationService } from "../conversations.mjs"
import { ConversationStore } from "../conversation-store.mjs"

// Deliberate provider/transport faults validate Pi recovery integration. This is
// a local protocol regression, not evidence of an online model end-to-end run.
const definition = {
  id: "feedback-test",
  name: "反馈协议回归",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 32768,
  maxTokens: 256,
}
const chunk = (delta, finish_reason = null) =>
  `data: ${JSON.stringify({ id: "feedback-response", object: "chat.completion.chunk", created: 1, model: definition.id, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
const finish = (response, text) =>
  response.end(
    chunk({ role: "assistant", content: text }) +
      chunk({}, "stop") +
      `data: ${JSON.stringify({ id: "feedback-response", object: "chat.completion.chunk", created: 1, model: definition.id, choices: [], usage: { prompt_tokens: 256, completion_tokens: 16, total_tokens: 272 } })}\n\n` +
      "data: [DONE]\n\n"
  )
const reject = (response, status, message, code) => {
  response.statusCode = status
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify({ error: { message, code, type: code } }))
}

async function fixture(t, respond) {
  const root = await mkdtemp(join(tmpdir(), "moon-feedback-acceptance-"))
  const cwd = join(root, "project")
  const directory = join(root, "data")
  await mkdir(cwd)
  const requests = []
  const events = []
  const server = createServer(async (request, response) => {
    let text = ""
    for await (const part of request) text += part
    const body = JSON.parse(text)
    requests.push(body)
    response.setHeader("Content-Type", "text/event-stream")
    await respond(body, response, requests.length)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const models = new ModelService(directory)
  await models.initialize()
  const create = models.sessions.create.bind(models.sessions)
  models.sessions.create = async (...args) => {
    const session = await create(...args)
    // Public SDK settings, only for this isolated regression: disable provider
    // retries to observe exactly the official AgentSession recovery decisions.
    session.settingsManager.applyOverrides({
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 1, provider: { maxRetries: 0 } },
      compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 128 },
    })
    return session
  }
  const store = new ConversationStore(directory)
  await store.initialize()
  const workspaces = { get: async () => ({ id: "workspace-test", path: cwd }) }
  const chats = new ConversationService(directory, models, models.sessions, store, workspaces)
  models.conversations = chats
  const handle = chats.event.bind(chats)
  chats.event = (state, event) => {
    handle(state, event)
    events.push({
      type: event.type, reason: event.reason, phase: state.phase,
      ...(event.type === "compaction_end" ? { contextState: chats.snapshot(state).contextState } : {}),
    })
  }
  await models.save({
    id: "feedback-local", name: "反馈协议测试", kind: "api",
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: "openai-completions", credential: "none", keySaved: false,
    apiKey: "", environmentVariable: "", headers: "{}", models: [definition],
  })
  await models.sessions.apply("feedback-session", cwd, ["read"], "none")
  t.after(async () => {
    await chats.close()
    await models.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const send = (id, text) => chats.send(
    "feedback-session", "workspace-test", id, text, "feedback-local", definition.id, "off"
  )
  const read = () => chats.read("feedback-session")
  const settled = async () => {
    for (let i = 0; i < 300; i++) {
      const result = await read()
      if (!["running", "stopping"].includes(result.phase)) return result
      await delay(10)
    }
    throw new Error("Official Pi protocol run did not settle")
  }
  const persisted = async () => readFile((await store.get("feedback-session")).sessionFile, "utf8")
  return { chats, models, events, requests, store, send, read, settled, persisted, directory, cwd, workspaces }
}

async function verifyLegacyOccurrenceMarkers(t, f, expectedMessages) {
  const record = await f.store.get("feedback-session")
  const entries = (await f.persisted()).trim().split("\n").map((line) => JSON.parse(line))
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "moon-shell-result") {
      delete entry.data.callEntryId
      delete entry.data.callIndex
    }
    if (entry.type === "custom" && entry.customType === "moon-run-result")
      delete entry.data.stoppedToolCalls
  }
  // Only this test's disposable JSONL is converted to the previously shipped
  // marker form. Restoring it must preserve its bytes and execution meanings.
  const legacy = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
  await writeFile(record.sessionFile, legacy)
  const restored = new ConversationService(f.directory, f.models, f.models.sessions, f.store, f.workspaces)
  t.after(() => restored.close())
  assert.deepEqual((await restored.read("feedback-session")).messages, expectedMessages)
  assert.equal(await f.persisted(), legacy)
}

test("quota errors retain Pi's terminal classification while Moon persists safe diagnostics", async (t) => {
  const secret = "TEST_CREDENTIAL_MUST_NOT_PERSIST"
  const f = await fixture(t, (_request, response) => {
    reject(response, 429, `insufficient_quota billing ${secret}`, "insufficient_quota")
  })
  await f.send("quota-request", "测试额度耗尽不自动重试")
  const done = await f.settled()
  assert.equal(done.phase, "failed")
  assert.equal(f.requests.length, 1, "Pi quota/billing errors must not enter transient retry")
  assert.equal(f.events.some((event) => event.type === "auto_retry_start"), false)
  assert.ok(f.chats.active.get("feedback-session").session.messages.some((message) => message.role === "assistant" && message.errorMessage?.includes(secret)), "The SDK-owned diagnostic must remain original for its recovery classifier")
  assert.equal(JSON.stringify(done).includes(secret), false)
  assert.equal((await f.persisted()).includes(secret), false)
})

test("temporary transport failures recover through official Pi retry events", async (t) => {
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) response.destroy()
    else finish(response, "连接已恢复")
  })
  await f.send("network-request", "测试临时连接中断")
  const done = await f.settled()
  assert.equal(done.phase, "completed")
  assert.equal(f.requests.length, 2)
  assert.ok(f.events.some((event) => event.type === "auto_retry_start"))
  assert.ok(f.events.some((event) => event.type === "auto_retry_end"))
  assert.equal(done.runtime, undefined)
  assert.match(done.messages.at(-1).text, /连接已恢复/)
})

test("explicit provider context overflow preserves official compact-and-retry and safe persisted history", async (t) => {
  const secret = "TEST_OVERFLOW_BODY_MUST_NOT_PERSIST"
  let overflowing = false
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1 || number === 2) finish(response, "已确认已有上下文。".repeat(180))
    else if (!overflowing) {
      overflowing = true
      reject(response, 400, `prompt is too long ${secret}`, "context_length_exceeded")
    } else finish(response, "之前用户请求和已完成工作已保留，继续处理。")
  })
  await f.send("overflow-history-1", "建立第一轮历史")
  assert.equal((await f.settled()).phase, "completed")
  await f.send("overflow-history-2", "建立第二轮历史")
  assert.equal((await f.settled()).phase, "completed")
  await f.send("overflow-current", "触发协议中的上下文溢出")
  const done = await f.settled()
  assert.ok(f.events.some((event) => event.type === "compaction_start" && event.reason === "overflow"))
  assert.ok(f.events.some((event) => event.type === "compaction_end" && event.reason === "overflow"))
  assert.ok(f.events.some((event) => event.type === "compaction_end" && event.contextState?.status === "awaiting-response"), "Pi must invalidate usage immediately after actual compaction")
  assert.equal(done.phase, "completed")
  assert.equal(done.runtime, undefined)
  assert.equal(done.context?.source, "pi-context-estimate")
  assert.equal(done.context?.estimated, true)
  assert.ok(done.context?.usedTokens > 0, "A subsequent provider usage report must resolve the unknown context")
  assert.equal(JSON.stringify(done).includes(secret), false)
  const persisted = await f.persisted()
  assert.equal(persisted.includes(secret), false)
  assert.ok(persisted.includes('"type":"compaction"'))
  const saved = persisted.trim().split("\n").map((line) => JSON.parse(line)).filter((entry) => entry.type === "custom" && entry.customType === "moon-context-usage").at(-1).data.feedback.context
  await f.chats.close()
  const restored = new ConversationService(f.directory, f.models, f.models.sessions, f.store, f.workspaces)
  t.after(() => restored.close())
  const history = await restored.read("feedback-session")
  assert.deepEqual(history.context, { ...saved, restored: true })
  assert.equal(await f.persisted(), persisted)
})

test("interrupted partial tool calls never become running when a later reply starts", async (t) => {
  const f = await fixture(t, async (_request, response, number) => {
    if (number === 1)
      response.write(chunk({
        role: "assistant",
        tool_calls: [{ index: 0, id: "unfinished-call", type: "function", function: { name: "read", arguments: '{"path":' } }],
      }))
    else response.write(chunk({ role: "assistant", content: "新的回复正在生成" }))
    await new Promise((resolve) => response.once("close", resolve))
  })
  const first = await f.send("partial-first", "产生未完整返回的工具调用")
  let observed = false
  for (let i = 0; i < 200; i++) {
    const live = await f.read()
    if (live.messages.flatMap((message) => message.tools || []).some((tool) => tool.id === "unfinished-call")) {
      observed = true
      break
    }
    await delay(10)
  }
  assert.ok(observed, "Actual Pi streaming parser must first expose the partial tool call")
  await f.chats.stop("feedback-session", first.runId)
  const stopped = await f.settled()
  const oldTool = stopped.messages.flatMap((message) => message.tools || []).find((tool) => tool.id === "unfinished-call")
  assert.ok(oldTool)
  assert.notEqual(oldTool.status, "running")
  const next = await f.send("partial-next", "开始下一条独立回复")
  assert.equal(next.phase, "running")
  const oldDuringNext = next.messages.flatMap((message) => message.tools || []).find((tool) => tool.id === "unfinished-call")
  assert.equal(oldDuringNext.status, oldTool.status, "A prior unexecuted call must not borrow the current run's phase")
  await f.chats.stop("feedback-session", next.runId)
  await f.settled()
})

test("provider tool identifiers reused in later turns cannot overwrite prior shell feedback", async (t) => {
  let shell
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1 || number === 3) {
      const code = number === 1 ? 0 : 7
      const text = number === 1 ? "FIRST_ZERO" : "SECOND_SEVEN"
      const command = shell === "powershell"
        ? `Write-Output '${text}'; exit ${code}`
        : `printf ${text}; exit ${code}`
      response.end(
        chunk({ role: "assistant", tool_calls: [{ index: 0, id: "provider-call-reused", type: "function", function: { name: shell, arguments: JSON.stringify({ command }) } }] }) +
          chunk({}, "tool_calls") + "data: [DONE]\n\n"
      )
    } else finish(response, "本轮命令已返回")
  })
  const catalog = await f.models.sessions.catalog(f.cwd)
  shell = catalog.tools.find((tool) => tool.id === "powershell" && tool.available)?.id ||
    catalog.tools.find((tool) => tool.id === "bash" && tool.available)?.id
  assert.ok(shell, "This regression requires an actual official shell tool")
  await f.models.sessions.apply("feedback-session", f.cwd, [shell], "none", 1)
  await f.send("duplicate-first", "第一轮执行真实退出码0")
  const first = await f.settled()
  assert.equal(first.messages.flatMap((message) => message.tools || [])[0].exitCode, 0)
  await f.send("duplicate-second", "第二轮执行真实退出码7")
  const next = await f.settled()
  const calls = next.messages.flatMap((message) => message.tools || [])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].exitCode, 0, "A later occurrence of a provider call ID must not replace its prior exit code")
  assert.equal(calls[0].status, "success")
  assert.match(calls[0].result, /FIRST_ZERO/)
  assert.equal(calls[1].exitCode, 7)
  assert.equal(calls[1].status, "failed")
  assert.match(calls[1].result, /SECOND_SEVEN/)
  await f.chats.close()
  const restored = new ConversationService(f.directory, f.models, f.models.sessions, f.store, f.workspaces)
  t.after(() => restored.close())
  assert.deepEqual((await restored.read("feedback-session")).messages, next.messages)
  await verifyLegacyOccurrenceMarkers(t, f, next.messages)
})

test("same provider identifier in two assistant steps of one run preserves each command occurrence", async (t) => {
  let shell
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1 || number === 2) {
      const command = shell === "powershell"
        ? `Write-Output 'STEP_${number}'; exit ${number === 1 ? 0 : 7}`
        : `printf STEP_${number}; exit ${number === 1 ? 0 : 7}`
      response.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "same-run-reused", type: "function", function: { name: shell, arguments: JSON.stringify({ command }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    } else finish(response, "两步命令都已结束")
  })
  const catalog = await f.models.sessions.catalog(f.cwd)
  shell = catalog.tools.find((tool) => tool.id === "powershell" && tool.available)?.id || catalog.tools.find((tool) => tool.id === "bash" && tool.available)?.id
  assert.ok(shell)
  await f.models.sessions.apply("feedback-session", f.cwd, [shell], "none", 1)
  await f.send("same-run-request", "连续两步命令分别0和7")
  const done = await f.settled()
  const calls = done.messages.flatMap((message) => message.tools || [])
  assert.deepEqual(calls.map((tool) => tool.exitCode), [0, 7], "A run boundary alone cannot identify repeated calls in separate assistant steps")
  assert.deepEqual(calls.map((tool) => tool.status), ["success", "failed"])
  assert.match(calls[0].result, /STEP_1/)
  assert.match(calls[1].result, /STEP_2/)
  await f.chats.close()
  const restored = new ConversationService(f.directory, f.models, f.models.sessions, f.store, f.workspaces)
  t.after(() => restored.close())
  assert.deepEqual((await restored.read("feedback-session")).messages, done.messages)
})

test("stopping a current call with a prior reused identifier never rewrites historical failure or progress", async (t) => {
  let shell
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1 || number === 3) {
      const command = number === 1
        ? shell === "powershell" ? "Write-Output 'HISTORICAL_FAILURE'; exit 7" : "printf HISTORICAL_FAILURE; exit 7"
        : shell === "powershell" ? "Start-Sleep -Seconds 30; Write-Output 'MUST_STOP'" : "sleep 30; printf MUST_STOP"
      response.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "stop-reused", type: "function", function: { name: shell, arguments: JSON.stringify({ command }) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    } else finish(response, "本轮回复已结束")
  })
  const catalog = await f.models.sessions.catalog(f.cwd)
  shell = catalog.tools.find((tool) => tool.id === "powershell" && tool.available)?.id || catalog.tools.find((tool) => tool.id === "bash" && tool.available)?.id
  assert.ok(shell)
  await f.models.sessions.apply("feedback-session", f.cwd, [shell], "none", 1)
  await f.send("old-failed-call", "先保留一条真实退出码7的记录")
  assert.equal((await f.settled()).messages.flatMap((message) => message.tools || [])[0].exitCode, 7)
  const second = await f.send("current-stop-call", "停止复用同一provider标识的当前长命令")
  let actualRunning = false
  for (let i = 0; i < 200; i++) {
    if ((await f.read()).runtime?.phase === "tool") { actualRunning = true; break }
    await delay(10)
  }
  assert.ok(actualRunning, "The official command must actually be executing before Stop")
  const live = (await f.read()).messages.flatMap((message) => message.tools || [])
  assert.equal(live[0].status, "failed")
  assert.equal(live[0].exitCode, 7)
  assert.equal(live[1].status, "running", "Current progress must not borrow the prior result sharing its ID")
  assert.equal(live[1].exitCode, undefined)
  await f.chats.stop("feedback-session", second.runId)
  const done = await f.settled()
  const calls = done.messages.flatMap((message) => message.tools || [])
  assert.equal(calls[0].status, "failed")
  assert.equal(calls[0].exitCode, 7)
  assert.match(calls[0].result, /HISTORICAL_FAILURE/)
  assert.equal(calls[1].status, "stopped")
  assert.equal(calls[1].exitCode, undefined)
  await f.chats.close()
  const restored = new ConversationService(f.directory, f.models, f.models.sessions, f.store, f.workspaces)
  t.after(() => restored.close())
  assert.deepEqual((await restored.read("feedback-session")).messages, done.messages)
  await verifyLegacyOccurrenceMarkers(t, f, done.messages)
})
