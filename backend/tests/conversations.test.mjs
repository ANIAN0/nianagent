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
import { createBridge } from "./stdio-client.mjs"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"

const model = {
  id: "local/moon-test",
  name: "本地协议验收",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 8192,
  maxTokens: 256,
}
const chunk = (delta, finish_reason = null) =>
  `data: ${JSON.stringify({ id: "local-response", object: "chat.completion.chunk", created: 1, model: model.id, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
async function fixture(
  t,
  respond = (_request, response) => {
    response.end(
      chunk({ role: "assistant", content: "已读取请求" }) +
        chunk({}, "stop") +
        "data: [DONE]\n\n"
    )
  }
) {
  const root = await mkdtemp(join(tmpdir(), "moon-conversation-"))
  const cwd = join(root, "project")
  const directory = join(root, "data")
  await mkdir(cwd)
  await writeFile(join(cwd, "AGENTS.md"), "FIRST_INSTRUCTION_SNAPSHOT")
  const requests = []
  const server = createServer(async (request, response) => {
    try {
      let text = ""
      for await (const part of request) text += part
      const body = JSON.parse(text)
      requests.push(body)
      response.setHeader("Content-Type", "text/event-stream")
      await respond(body, response, requests.length)
    } catch (error) {
      if (!response.writableEnded) {
        response.statusCode = 500
        response.end(String(error))
      }
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const service = new ModelService(directory)
  await service.initialize()
  const store = new ConversationStore(directory)
  await store.initialize()
  const workspaces = {
    get: async (id) => (id === "workspace-test" ? { id, path: cwd } : null),
  }
  const chats = new ConversationService(
    directory,
    service,
    service.sessions,
    store,
    workspaces
  )
  service.conversations = chats
  const sdkErrors = []
  const onEvent = chats.event.bind(chats)
  chats.event = (state, event) => {
    if (event.message?.errorMessage) sdkErrors.push(event.message.errorMessage)
    onEvent(state, event)
  }
  await service.save({
    id: "local",
    name: "本地测试",
    kind: "api",
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: "openai-completions",
    credential: "none",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [model],
  })
  await service.sessions.apply("session-test", cwd, [], "directory")
  t.after(async () => {
    await chats.close()
    await service.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  })
  const send = (clientRequestId, text, signal) =>
    service.dispatch(
      "conversationSend",
      {
        sessionId: "session-test",
        workspaceId: "workspace-test",
        clientRequestId,
        text,
        connectionId: "local",
        modelId: model.id,
        thinking: "off",
      },
      signal
    )
  const read = () =>
    service.dispatch("conversationRead", { sessionId: "session-test" })
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const result = await read()
      if (!["running", "stopping"].includes(result.phase)) return result
      await delay(25)
    }
    throw new Error("Local Pi protocol fixture did not settle")
  }
  return {
    root,
    cwd,
    directory,
    service,
    chats,
    store,
    workspaces,
    requests,
    sdkErrors,
    send,
    read,
    settled,
  }
}

test("unknown compact receipts block formal sends until authoritative reconciliation", async (t) => {
  const f = await fixture(t)
  await f.send("before-unknown-control", "建立真实 Pi 历史")
  await f.settled()
  const controls = f.chats.controls
  const originalPersist = controls.persist.bind(controls)
  let writes = 0
  controls.persist = async (...args) => {
    if (++writes > 1) throw new Error("receipt disk unavailable")
    return originalPersist(...args)
  }
  await f.service.dispatch("conversationCompact", {
    sessionId: "session-test",
    operationId: "unknown-compact",
    focus: "",
  })
  await Promise.allSettled([...controls.tasks.values()])
  const unknown = await f.read()
  assert.equal(unknown.control.operation.status, "unknown")
  const record = await f.store.get("session-test")
  const originalBytes = await readFile(record.sessionFile)
  await assert.rejects(f.send("must-not-pollute", "不能污染未决压缩边界"), /上次操作/)
  assert.deepEqual(await readFile(record.sessionFile), originalBytes)
  assert.equal(f.requests.length, 1)
  await assert.rejects(
    f.service.dispatch("conversationControlRead", {
      sessionId: "session-test",
      operationId: "unknown-compact",
    }),
    /receipt disk unavailable/
  )
  assert.equal((await f.read()).control.operation.status, "unknown")
  await assert.rejects(
    f.send("still-must-not-pollute", "回执保存失败仍须阻止新运行"),
    /上次操作/
  )
  assert.deepEqual(await readFile(record.sessionFile), originalBytes)
  controls.persist = originalPersist
  const reconciled = await f.service.dispatch("conversationControlRead", {
    sessionId: "session-test",
    operationId: "unknown-compact",
  })
  assert.equal(reconciled.status, "failed")
  await f.send("after-reconcile", "边界已确认，继续")
  assert.equal((await f.settled()).phase, "completed")
  assert.equal(f.requests.length, 2)
})
test("manual compaction cancelled before Pi creates its controller is actually aborted", async (t) => {
  const f = await fixture(t)
  await f.send("before-early-cancel", "建立真实 Pi 历史")
  await f.settled()
  const state = f.chats.active.get("session-test")
  const session = state.session
  const originalAbort = session.abort.bind(session)
  let releaseAbort
  const blocked = new Promise((resolve) => {
    releaseAbort = resolve
  })
  session.abort = async () => {
    await blocked
    return originalAbort()
  }
  const events = []
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "compaction_end") events.push(event)
  })
  const record = await f.store.get("session-test")
  const before = await readFile(record.sessionFile)
  try {
    await f.service.dispatch("conversationCompact", {
      sessionId: "session-test",
      operationId: "cancel-before-controller",
      focus: "",
    })
    const cancelling = await f.service.dispatch("conversationCompactCancel", {
      sessionId: "session-test",
      operationId: "cancel-before-controller",
    })
    assert.equal(cancelling.status, "cancelling")
    releaseAbort()
    await Promise.allSettled([...f.chats.controls.tasks.values()])
    assert.equal(events.length, 1)
    assert.equal(events[0].aborted, true)
    const cancelled = await f.service.dispatch("conversationControlRead", {
      sessionId: "session-test",
      operationId: "cancel-before-controller",
    })
    assert.equal(cancelled.status, "cancelled")
    assert.equal(cancelled.compactionEntryId, undefined)
    assert.deepEqual(await readFile(record.sessionFile), before)
  } finally {
    releaseAbort()
    session.abort = originalAbort
    unsubscribe()
  }
})
test("real Pi text turns preserve context, deduplicate accepted sends and restore JSONL", async (t) => {
  const f = await fixture(t)
  const first = await f.send("request-1", "记住代号 BLUE-MOON")
  assert.equal(first.phase, "running")
  const completed = await f.settled()
  assert.equal(completed.phase, "completed")
  assert.equal(
    completed.messages.filter((item) => item.role === "user").length,
    1
  )
  await f.send("request-1", "记住代号 BLUE-MOON")
  assert.equal(f.requests.length, 1)
  await assert.rejects(f.send("request-1", "different"), /标识/)
  await f.send("request-2", "重复刚才的代号")
  const second = await f.settled()
  assert.equal(second.messages.filter((item) => item.role === "user").length, 2)
  assert.ok(JSON.stringify(f.requests[1].messages).includes("BLUE-MOON"))
  const metadata = await f.store.get("session-test")
  const jsonl = await readFile(metadata.sessionFile, "utf8")
  assert.ok(jsonl.includes('"type":"session"'))
  assert.ok(jsonl.includes("moon-request"))
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  t.after(() => restored.close())
  const result = await restored.read("session-test")
  assert.deepEqual(result.messages, second.messages)
  assert.notEqual(result.epoch, second.epoch)
  const replay = await restored.send(
    "session-test",
    "workspace-test",
    "request-2",
    "重复刚才的代号",
    "local",
    model.id,
    "off"
  )
  assert.equal(replay.phase, "completed")
  assert.equal(f.requests.length, 2)
})

test("applied tools and instructions update the same Pi session without losing transcript", async (t) => {
  const f = await fixture(t)
  await f.send("request-1", "hello")
  await f.settled()
  const before = f.chats.active.get("session-test").session
  const messages = [...before.messages]
  await writeFile(join(f.cwd, "AGENTS.md"), "SECOND_INSTRUCTION_SNAPSHOT")
  await f.service.sessions.apply(
    "session-test",
    f.cwd,
    ["read"],
    "directory",
    1
  )
  const after = f.chats.active.get("session-test").session
  assert.equal(after, before)
  assert.deepEqual(after.messages, messages)
  assert.deepEqual(after.getActiveToolNames(), ["read"])
  assert.ok(after.systemPrompt.includes("SECOND_INSTRUCTION_SNAPSHOT"))
  await f.send("request-2", "second")
  await f.settled()
  assert.ok(f.requests[1].tools.some((item) => item.function.name === "read"))
  assert.ok(
    JSON.stringify(f.requests[1].messages).includes(
      "SECOND_INSTRUCTION_SNAPSHOT"
    )
  )
  await f.service.sessions.apply("session-test", f.cwd, ["read"], "none", 2)
  assert.equal(f.chats.active.get("session-test").session, before)
  assert.ok(before.systemPrompt.includes("Moon host runtime"))
  assert.ok(!before.systemPrompt.includes("SECOND_INSTRUCTION_SNAPSHOT"))
  await f.send("request-3", "third without project instructions")
  await f.settled()
  assert.ok(
    JSON.stringify(f.requests[2].messages).includes("Moon host runtime")
  )
})

test("Pi executes selected read tool and snapshot exposes actual tool result", async (t) => {
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1)
      response.end(
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "read-fixture",
              type: "function",
              function: { name: "read", arguments: '{"path":"fixture.txt"}' },
            },
          ],
        }) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n"
      )
    else
      response.end(
        chunk({ role: "assistant", content: "读取完成" }) +
          chunk({}, "stop") +
          "data: [DONE]\n\n"
      )
  })
  await writeFile(join(f.cwd, "fixture.txt"), "ACTUAL_LOCAL_FILE_CONTENT")
  await f.service.sessions.apply(
    "session-test",
    f.cwd,
    ["read"],
    "directory",
    1
  )
  await f.send("request-1", "读取 fixture.txt")
  const result = await f.settled()
  assert.equal(result.phase, "completed")
  assert.ok(
    JSON.stringify(f.requests[1].messages).includes("ACTUAL_LOCAL_FILE_CONTENT")
  )
  const tool = result.messages.flatMap((message) => message.tools || [])[0]
  assert.equal(tool.status, "success")
  assert.ok(tool.result.includes("ACTUAL_LOCAL_FILE_CONTENT"))
  assert.equal(Object.hasOwn(tool, "exitCode"), false)
  assert.equal(Object.hasOwn(tool, "durationMs"), false)
})

test("official Pi shell results preserve zero/nonzero exit codes and durations after restart", async (t) => {
  let shell
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) {
      const commands =
        shell === "powershell"
          ? [
              "Write-Output 'EXIT_ZERO'; exit 0",
              "Write-Output 'EXIT_SEVEN'; exit 7",
            ]
          : ["printf EXIT_ZERO; exit 0", "printf EXIT_SEVEN; exit 7"]
      response.end(
        chunk({
          role: "assistant",
          tool_calls: commands.map((command, index) => ({
            index,
            id: `shell-${index}`,
            type: "function",
            function: { name: shell, arguments: JSON.stringify({ command }) },
          })),
        }) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n"
      )
    } else
      response.end(
        chunk({ role: "assistant", content: "命令结果已返回" }) +
          chunk({}, "stop") +
          "data: [DONE]\n\n"
      )
  })
  const catalog = await f.service.sessions.catalog(f.cwd)
  shell =
    catalog.tools.find((tool) => tool.id === "powershell" && tool.available)
      ?.id ||
    catalog.tools.find((tool) => tool.id === "bash" && tool.available)?.id
  assert.ok(
    shell,
    "This regression requires an available official Pi shell tool"
  )
  await f.service.sessions.apply("session-test", f.cwd, [shell], "directory", 1)
  await f.send("shell-request", "执行两条命令并显示实际退出码")
  const done = await f.settled()
  const tools = done.messages.flatMap((message) => message.tools || [])
  assert.equal(tools.length, 2)
  assert.equal(tools[0].exitCode, 0)
  assert.equal(tools[0].status, "success")
  assert.equal(tools[1].exitCode, 7)
  assert.equal(tools[1].status, "failed")
  for (const tool of tools)
    assert.ok(Number.isFinite(tool.durationMs) && tool.durationMs >= 0)
  assert.equal(done.runtime, undefined)
  const record = await f.store.get("session-test")
  const raw = await readFile(record.sessionFile, "utf8")
  assert.ok(raw.includes("moon-shell-result"))
  assert.ok(raw.includes('"exitCode":0'))
  assert.ok(raw.includes('"exitCode":7'))
  assert.ok(raw.includes("moon-context-usage"))
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  t.after(() => restored.close())
  const history = await restored.read("session-test")
  assert.deepEqual(history.messages, done.messages)
  assert.equal(history.runtime, undefined)
  assert.equal(history.context?.source, "pi-context-estimate")
  assert.equal(history.context?.estimated, true)
  assert.equal(history.context?.restored, true)
  assert.equal(history.context?.usedTokens, done.context.usedTokens)
  assert.equal(await readFile(record.sessionFile, "utf8"), raw)
})

test("SDK recovery events expose safe retry/compaction stages and stop discards late stages", async (t) => {
  const f = await fixture(t, async (_request, response) => {
    response.write(chunk({ role: "assistant", content: "仍在生成" }))
    await new Promise((resolve) => response.once("close", resolve))
  })
  const accepted = await f.send("feedback-request", "慢速生成")
  const state = f.chats.active.get("session-test")
  const emit = (event) => f.chats.event(state, event)
  const snapshot = () => f.chats.snapshot(state)
  assert.equal(snapshot().runtime.phase, "responding")
  emit({
    type: "auto_retry_start",
    attempt: 2,
    maxAttempts: 3,
    delayMs: 4000,
    errorMessage: "503 overloaded API_KEY_SECRET",
  })
  const retry = snapshot().runtime
  assert.equal(retry.phase, "retrying")
  assert.equal(retry.attempt, 2)
  assert.equal(retry.maxAttempts, 3)
  assert.equal(retry.retrySource, "response")
  assert.ok(Date.parse(retry.retryAt) > Date.now())
  assert.ok(!JSON.stringify(retry).includes("API_KEY_SECRET"))
  emit({ type: "turn_start" })
  assert.equal(snapshot().runtime.phase, "responding")
  assert.equal(snapshot().runtime.retryAt, undefined)
  emit({ type: "compaction_start", reason: "threshold" })
  assert.equal(snapshot().runtime.phase, "compacting")
  emit({
    type: "summarization_retry_scheduled",
    attempt: 1,
    maxAttempts: 2,
    delayMs: 1000,
    errorMessage: "429 SECRET_TOKEN",
  })
  assert.equal(snapshot().runtime.retrySource, "compaction")
  assert.ok(!JSON.stringify(snapshot().runtime).includes("SECRET_TOKEN"))
  emit({
    type: "summarization_retry_attempt_start",
    source: "compaction",
    reason: "threshold",
  })
  assert.equal(snapshot().runtime.phase, "compacting")
  emit({
    type: "compaction_end",
    reason: "threshold",
    result: {},
    aborted: false,
    willRetry: false,
  })
  assert.equal(snapshot().runtime.phase, "responding")
  state.manager.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "one", name: "read", arguments: {} },
      { type: "toolCall", id: "two", name: "ls", arguments: {} },
    ],
    api: model.api,
    provider: "moon-local",
    model: model.id,
    stopReason: "toolUse",
    timestamp: Date.now(),
  })
  emit({ type: "tool_execution_start", toolCallId: "one", toolName: "read" })
  emit({ type: "tool_execution_start", toolCallId: "two", toolName: "ls" })
  emit({
    type: "tool_execution_end",
    toolCallId: "one",
    toolName: "read",
    result: { content: [] },
    isError: false,
  })
  assert.equal(snapshot().runtime.phase, "tool")
  assert.equal(snapshot().runtime.toolName, "ls")
  emit({
    type: "tool_execution_end",
    toolCallId: "two",
    toolName: "ls",
    result: { content: [] },
    isError: false,
  })
  assert.equal(snapshot().runtime.phase, "responding")
  await f.chats.stop("session-test", accepted.runId)
  emit({
    type: "auto_retry_start",
    attempt: 3,
    maxAttempts: 3,
    delayMs: 1000,
    errorMessage: "503",
  })
  assert.equal(snapshot().runtime, undefined)
  const stopped = await f.settled()
  assert.equal(stopped.runtime, undefined)
  emit({ type: "compaction_start", reason: "overflow" })
  assert.equal(snapshot().runtime, undefined)
})

test("unknown SDK context usage is not zero and its historical state survives restart", async (t) => {
  const f = await fixture(t, async (_request, response) => {
    response.write(chunk({ role: "assistant", content: "仍在生成" }))
    await new Promise((resolve) => response.once("close", resolve))
  })
  const accepted = await f.send("unknown-context", "等待下一次统计")
  const state = f.chats.active.get("session-test")
  state.session.getContextUsage = () => ({
    tokens: null,
    contextWindow: 8192,
    percent: null,
  })
  const unknown = await f.read()
  assert.equal(unknown.context, undefined)
  assert.equal(unknown.contextState.status, "awaiting-response")
  assert.equal(unknown.contextState.contextWindow, 8192)
  assert.ok(unknown.contextState.observedAt)
  await f.chats.stop("session-test", accepted.runId)
  const done = await f.settled()
  assert.equal(done.context, undefined)
  const record = await f.store.get("session-test")
  const before = await readFile(record.sessionFile, "utf8")
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  t.after(() => restored.close())
  const history = await restored.read("session-test")
  assert.equal(history.context, undefined)
  assert.equal(history.contextState.status, "awaiting-response")
  assert.equal(history.contextState.contextWindow, 8192)
  assert.equal(await readFile(record.sessionFile, "utf8"), before)
})

test("failed threshold compaction persists a safe notice without declaring completed reply failed", async (t) => {
  const f = await fixture(t)
  const onEvent = f.chats.event.bind(f.chats)
  let failCompaction = true
  f.chats.event = (state, event) => {
    onEvent(state, event)
    if (
      failCompaction &&
      event.type === "message_end" &&
      event.message?.role === "assistant"
    )
      onEvent(state, {
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted: false,
        willRetry: false,
        errorMessage: "503 API_KEY_SECRET",
      })
  }
  await f.send("notice-first", "回复已完成但压缩失败")
  const done = await f.settled()
  assert.equal(done.phase, "completed")
  assert.equal(done.error, "")
  assert.equal(done.runtime, undefined)
  assert.equal(done.notice.kind, "compaction-failed")
  assert.equal(done.notice.runId, done.runId)
  assert.ok(!done.notice.message.includes("API_KEY_SECRET"))
  const record = await f.store.get("session-test")
  const raw = await readFile(record.sessionFile, "utf8")
  assert.ok(!raw.includes("API_KEY_SECRET"))
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  t.after(() => restored.close())
  assert.deepEqual((await restored.read("session-test")).notice, done.notice)
  failCompaction = false
  const next = await restored.send(
    "session-test",
    "workspace-test",
    "notice-next",
    "继续正常对话",
    "local",
    model.id,
    "off"
  )
  assert.equal(next.notice, undefined)
  await restored.active.get("session-test").run
  const result = await restored.read("session-test")
  assert.equal(result.notice, undefined)
  assert.equal(result.phase, "completed")
})

test("stop interrupts streaming, preserves partial text, rejects busy config and stale run", async (t) => {
  let began
  const started = new Promise((resolve) => {
    began = resolve
  })
  const f = await fixture(t, async (_request, response) => {
    response.write(chunk({ role: "assistant", content: "部分回复" }))
    began()
    await new Promise((resolve) => response.once("close", resolve))
  })
  const initial = await f.send("request-1", "slow")
  await Promise.race([
    started,
    delay(5000, undefined, { ref: false }).then(() => {
      throw new Error(
        `Protocol request not received: ${f.sdkErrors.join(" | ")}`
      )
    }),
  ])
  await assert.rejects(
    f.service.sessions.apply("session-test", f.cwd, [], "none", 1),
    /正在执行/
  )
  await assert.rejects(f.chats.stop("session-test", "stale-run"), /变化/)
  await f.chats.stop("session-test", initial.runId)
  const result = await f.settled()
  assert.equal(result.phase, "interrupted")
  assert.equal(
    result.messages.filter((message) => message.role === "user").length,
    1
  )
  const replay = await f.send("request-1", "slow")
  assert.equal(replay.phase, "interrupted")
  assert.equal(f.requests.length, 1)
})

test("explicit stop projects Pi error cancellation as interrupted without hiding earlier model failures", async (t) => {
  let began
  const started = new Promise((resolve) => {
    began = resolve
  })
  const f = await fixture(t, async (_request, response, number) => {
    if (number === 1) {
      response.statusCode = 400
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          error: { message: "fixture rejected", type: "invalid_request_error" },
        })
      )
    } else if (number === 2) {
      response.write(chunk({ role: "assistant", content: "部分回复" }))
      began()
      await new Promise((resolve) => response.once("close", resolve))
    } else
      response.end(
        chunk({ role: "assistant", content: "后续回复正常" }) +
          chunk({}, "stop") +
          "data: [DONE]\n\n"
      )
  })
  await f.send("real-failure", "首次真实错误")
  const failed = await f.settled()
  assert.equal(failed.phase, "failed")
  assert.equal(
    failed.messages.find((message) => message.role === "assistant").status,
    "failed"
  )
  const onEvent = f.chats.event.bind(f.chats)
  f.chats.event = (state, event) => {
    // Reproduce the supported Pi cancellation variant: an error-shaped terminal
    // message paired with Moon's explicit Stop, rather than an aborted message.
    if (
      state.stopRequested &&
      event.type === "message_end" &&
      event.message?.role === "assistant"
    ) {
      event.message.stopReason = "error"
      event.message.errorMessage = "请求已停止。"
    }
    onEvent(state, event)
  }
  const run = await f.send("stopped-reply", "停止第二次回复")
  await started
  await f.chats.stop("session-test", run.runId)
  const stopped = await f.settled()
  assert.equal(stopped.phase, "interrupted")
  const assistants = stopped.messages.filter(
    (message) => message.role === "assistant"
  )
  assert.equal(assistants[0].status, "failed")
  assert.equal(assistants.at(-1).status, "interrupted")
  const state = f.chats.active.get("session-test")
  assert.equal(
    state.manager
      .getBranch()
      .filter(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant"
      )
      .at(-1).message.stopReason,
    "error"
  )
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  t.after(() => restored.close())
  assert.deepEqual(
    (await restored.read("session-test")).messages,
    stopped.messages
  )
  await restored.send(
    "session-test",
    "workspace-test",
    "next-normal",
    "正常继续",
    "local",
    model.id,
    "off"
  )
  await restored.active.get("session-test").run
  const next = await restored.read("session-test")
  const history = next.messages.filter(
    (message) => message.role === "assistant"
  )
  assert.equal(history[0].status, "failed")
  assert.equal(history[1].status, "interrupted")
  assert.equal(history.at(-1).status, "settled")
})

test("stop targets only active shell calls while retaining genuine nonzero failures after restart", async (t) => {
  let shell
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) {
      const commands =
        shell === "powershell"
          ? [
              "Write-Output 'GENUINE_FAILURE'; exit 7",
              "Start-Sleep -Seconds 30; Write-Output 'SHOULD_NOT_FINISH'",
            ]
          : [
              "printf GENUINE_FAILURE; exit 7",
              "sleep 30; printf SHOULD_NOT_FINISH",
            ]
      response.end(
        chunk({
          role: "assistant",
          tool_calls: commands.map((command, index) => ({
            index,
            id: index === 0 ? "genuine-failure" : "active-cancel",
            type: "function",
            function: { name: shell, arguments: JSON.stringify({ command }) },
          })),
        }) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n"
      )
    } else
      response.end(
        chunk({ role: "assistant", content: "回复结束" }) +
          chunk({}, "stop") +
          "data: [DONE]\n\n"
      )
  })
  const catalog = await f.service.sessions.catalog(f.cwd)
  shell =
    catalog.tools.find((tool) => tool.id === "powershell" && tool.available)
      ?.id ||
    catalog.tools.find((tool) => tool.id === "bash" && tool.available)?.id
  assert.ok(shell)
  await f.service.sessions.apply("session-test", f.cwd, [shell], "directory", 1)
  const run = await f.send("stop-tools", "停止正在运行的工具，保留之前的错误")
  let ready = false
  for (let i = 0; i < 240; i++) {
    const progress = [
      ...f.chats.active.get("session-test").toolProgress.values(),
    ]
    if (
      progress.find((tool) => tool.toolCallId === "genuine-failure")
        ?.exitCode === 7 &&
      progress.find((tool) => tool.toolCallId === "active-cancel")?.status ===
        "running"
    ) {
      ready = true
      break
    }
    await delay(25)
  }
  assert.ok(
    ready,
    "Nonzero command must finish while the other command is still running"
  )
  await f.chats.stop("session-test", run.runId)
  const stopped = await f.settled()
  const tools = stopped.messages.flatMap((message) => message.tools || [])
  assert.equal(
    tools.find((tool) => tool.id === "genuine-failure").status,
    "failed"
  )
  assert.equal(tools.find((tool) => tool.id === "genuine-failure").exitCode, 7)
  assert.equal(
    tools.find((tool) => tool.id === "active-cancel").status,
    "stopped"
  )
  assert.equal(
    tools.find((tool) => tool.id === "active-cancel").exitCode,
    undefined
  )
  const record = await f.store.get("session-test")
  const lines = (await readFile(record.sessionFile, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  const marker = lines
    .filter(
      (entry) =>
        entry.type === "custom" && entry.customType === "moon-run-result"
    )
    .at(-1)
  assert.deepEqual(marker.data.stoppedToolIds, ["active-cancel"])
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  t.after(() => restored.close())
  assert.deepEqual(
    (await restored.read("session-test")).messages,
    stopped.messages
  )
})

test("failed generation remains visible and explicit continuation does not repeat user text", async (t) => {
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) {
      response.statusCode = 400
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          error: { message: "fixture rejected", type: "invalid_request_error" },
        })
      )
    } else
      response.end(
        chunk({ role: "assistant", content: "已继续" }) +
          chunk({}, "stop") +
          "data: [DONE]\n\n"
      )
  })
  await f.send("request-1", "UNIQUE_ORIGINAL_REQUEST")
  const failed = await f.settled()
  assert.equal(failed.phase, "failed")
  assert.match(failed.error, /400/)
  const active = f.chats.active.get("session-test")
  const agentError = active.session.messages
    .filter((message) => message.role === "assistant")
    .at(-1)
  const savedError = active.manager
    .getBranch()
    .filter(
      (entry) => entry.type === "message" && entry.message.role === "assistant"
    )
    .at(-1).message
  // Pi 1 finalizes agent context from the persisted projection. Its public
  // message event must carry the original diagnostic before recovery decides.
  assert.ok(f.sdkErrors.some((error) => error.includes("fixture rejected")))
  assert.ok(!agentError.errorMessage.includes("fixture rejected"))
  assert.ok(!savedError.errorMessage.includes("fixture rejected"))
  assert.ok(!JSON.stringify(failed).includes("fixture rejected"))
  const metadata = await f.store.get("session-test")
  assert.ok(
    !(await readFile(metadata.sessionFile, "utf8")).includes("fixture rejected")
  )
  await f.service.dispatch("conversationRetry", {
    sessionId: "session-test",
    clientRequestId: "retry-1",
    connectionId: "local",
    modelId: model.id,
    thinking: "off",
  })
  const result = await f.settled()
  assert.equal(result.phase, "completed")
  assert.equal(
    result.messages.filter(
      (message) =>
        message.role === "user" && message.text === "UNIQUE_ORIGINAL_REQUEST"
    ).length,
    1
  )
  assert.ok(
    result.messages.some((message) =>
      message.text.includes("请继续完成上一条用户请求")
    )
  )
})

test("cancelled send never starts or appends a user message", async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(f.send("cancelled", "no run", controller.signal), {
    name: "AbortError",
  })
  assert.equal(f.requests.length, 0)
  assert.equal(await f.store.get("session-test"), null)
})

test("preflight failure preserves input, same request is idempotent, explicit new request can recover", async (t) => {
  const f = await fixture(t)
  const create = f.service.sessions.create.bind(f.service.sessions)
  let unavailable = true
  f.service.sessions.create = async (...args) => {
    const session = await create(...args)
    const runtime = session.modelRuntime
    const hasConfigured = runtime.hasConfiguredAuth.bind(runtime)
    const checkAuth = runtime.checkAuth.bind(runtime)
    const setModel = session.setModel.bind(session)
    session.setModel = async (...input) => {
      runtime.hasConfiguredAuth = hasConfigured
      runtime.checkAuth = checkAuth
      await setModel(...input)
      // Simulate credentials becoming unavailable between successful selection
      // and prompt preflight, without making an external request.
      runtime.hasConfiguredAuth = (...value) =>
        !unavailable && hasConfigured(...value)
      runtime.checkAuth = (...value) =>
        unavailable ? Promise.resolve(undefined) : checkAuth(...value)
    }
    return session
  }
  const failed = await f.send("preflight-1", "KEEP_DRAFT")
  assert.equal(failed.phase, "failed")
  assert.equal(failed.inputAccepted, false)
  assert.equal(failed.clientRequestId, "preflight-1")
  assert.equal(failed.messages.length, 0)
  assert.equal(f.requests.length, 0)
  unavailable = false
  assert.equal((await f.send("preflight-1", "KEEP_DRAFT")).phase, "failed")
  assert.equal(f.requests.length, 0)
  const accepted = await f.send("preflight-2", "KEEP_DRAFT")
  assert.equal(accepted.inputAccepted, true)
  const done = await f.settled()
  assert.equal(done.phase, "completed")
  assert.equal(
    done.messages.filter((message) => message.role === "user").length,
    1
  )
  unavailable = true
  const failedNext = await f.send("preflight-3", "KEEP_NEW_DRAFT")
  assert.equal(failedNext.inputAccepted, false)
  assert.equal(
    failedNext.messages.filter((message) => message.role === "user").length,
    1
  )
  const retry = () =>
    f.service.dispatch("conversationRetry", {
      sessionId: "session-test",
      clientRequestId: "invalid-continue",
      connectionId: "local",
      modelId: model.id,
      thinking: "off",
    })
  await assert.rejects(retry(), /尚未写入对话/)
  assert.equal(f.requests.length, 1)
  await f.chats.close()
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  f.service.conversations = restored
  t.after(() => restored.close())
  assert.equal((await restored.read("session-test")).inputAccepted, false)
  await assert.rejects(retry(), /尚未写入对话/)
  assert.equal(f.requests.length, 1)
})

test("stored transcript remains readable without model or working directory and read does not mutate JSONL", async (t) => {
  const f = await fixture(t)
  await f.send("request-1", "PERSISTENT_HISTORY")
  const result = await f.settled()
  const metadata = await f.store.get("session-test")
  const before = await readFile(metadata.sessionFile, "utf8")
  await f.chats.close()
  const connection = (await f.service.list())[0]
  await f.service.remove(connection.id, connection.revision)
  await rm(f.cwd, { recursive: true, force: true })
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    { get: async () => null }
  )
  t.after(() => restored.close())
  const read = await restored.read("session-test")
  assert.deepEqual(read.messages, result.messages)
  assert.equal(read.inputAccepted, true)
  assert.equal(await readFile(metadata.sessionFile, "utf8"), before)
  await assert.rejects(
    restored.send(
      "session-test",
      "workspace-test",
      "request-2",
      "next",
      "local",
      model.id,
      "off"
    ),
    /工作区已移除/
  )
})

test("formal RPC rejects damaged Pi history without changing any original bytes", async (t) => {
  const f = await fixture(t)
  await f.send("history-source", "PRESERVE_HISTORY")
  await f.settled()
  const record = await f.store.get("session-test")
  const original = await readFile(record.sessionFile, "utf8")
  const header = JSON.parse(original.split("\n")[0])
  await f.chats.close()
  const bridge = createBridge({ env: { MOON_DATA_DIR: f.directory } })
  t.after(() => bridge.close())
  const broken = [
    "",
    " \n\r\n",
    '{"type":"session",',
    JSON.stringify({ type: "message", message: { role: "user" } }) + "\n",
    JSON.stringify({ ...header, id: "" }) + "\n",
    JSON.stringify({ ...header, cwd: null }) + "\n",
    JSON.stringify({ ...header, cwd: f.root }) + "\n",
    JSON.stringify({ ...header, version: 999 }) + "\n",
    original + '{"type":"message",',
    original + "null\n",
  ]
  for (const content of broken) {
    await writeFile(record.sessionFile, content)
    const before = await readFile(record.sessionFile)
    await assert.rejects(
      bridge.call("conversationRead", { sessionId: "session-test" }),
      /损坏|工作目录|版本/
    )
    assert.deepEqual(await readFile(record.sessionFile), before)
  }
  await writeFile(record.sessionFile, original)
  const recovered = await bridge.call("conversationRead", {
    sessionId: "session-test",
  })
  assert.ok(
    recovered.messages.some((message) => message.text === "PRESERVE_HISTORY")
  )
  assert.equal(await readFile(record.sessionFile, "utf8"), original)
  assert.equal(f.requests.length, 1)
})

test("legacy Pi history and missing final newline stay read-only until explicit send", async (t) => {
  for (const version of [undefined, 1, 2, 3])
    await t.test(`version ${version ?? "legacy unspecified"}`, async (t) => {
      const f = await fixture(t)
      await f.send("legacy-source", "LEGACY_CONTEXT")
      const completed = await f.settled()
      const record = await f.store.get("session-test")
      const entries = (await readFile(record.sessionFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      if (version === undefined) delete entries[0].version
      else entries[0].version = version
      if (!version || version === 1)
        for (const entry of entries.slice(1)) {
          delete entry.id
          delete entry.parentId
        }
      const legacy = entries.map((entry) => JSON.stringify(entry)).join("\n")
      await f.chats.close()
      await writeFile(record.sessionFile, legacy)
      const restored = new ConversationService(
        f.directory,
        f.service,
        f.service.sessions,
        f.store,
        f.workspaces
      )
      f.service.conversations = restored
      t.after(() => restored.close())
      const read = await restored.read("session-test")
      // A v1 file has no durable Pi IDs. The SDK creates random IDs while
      // migrating in memory; they must never become public fork boundaries.
      const legacyWithoutIds = version === undefined || version === 1
      assert.deepEqual(
        read.messages,
        completed.messages.map(({ entryId, forkable, ...message }) => ({
          ...message,
          ...(!legacyWithoutIds ? { entryId } : {}),
          ...(forkable !== undefined
            ? { forkable: version === 3 ? forkable : false }
            : {}),
        }))
      )
      const anotherHost = new ConversationService(
        f.directory,
        f.service,
        f.service.sessions,
        f.store,
        f.workspaces
      )
      t.after(() => anotherHost.close())
      assert.deepEqual(
        (await anotherHost.read("session-test")).messages,
        read.messages,
        "Independent read-only restores must expose the same message identity"
      )
      if (version !== 3) {
        assert.match(read.historyNotice, /旧格式历史.*继续发送一次消息/)
        assert.equal(read.control.forkDisabledReason, read.historyNotice)
        const temporaryAnchor = restored.active.get("session-test").manager
          .getBranch().find((entry) => entry.type === "message" && entry.message.role === "assistant").id
        await assert.rejects(
          f.service.dispatch("conversationFork", {
            sessionId: "session-test",
            operationId: "legacy-fork-rejected",
            entryId: temporaryAnchor,
          }),
          /旧格式历史.*继续发送一次消息/
        )
      } else assert.equal(read.historyNotice, undefined)
      assert.equal(
        restored.active.get("session-test").manager.isPersisted(),
        false
      )
      assert.equal(await readFile(record.sessionFile, "utf8"), legacy)
      await f.send("legacy-next", "Continue the saved context")
      assert.equal((await f.settled()).phase, "completed")
      assert.ok(
        JSON.stringify(f.requests[1].messages).includes("LEGACY_CONTEXT")
      )
      const after = await readFile(record.sessionFile, "utf8")
      assert.equal(JSON.parse(after.split("\n")[0]).version, 3)
      assert.ok(after.endsWith("\n"))
      assert.equal(
        restored.active.get("session-test").manager.getSessionFile(),
        record.sessionFile
      )
      const migrated = await f.read()
      assert.equal(migrated.historyNotice, undefined)
      assert.ok(migrated.messages.every((message) => message.entryId))
      const selected = migrated.messages.find((message) => message.role === "assistant" && message.forkable)
      assert.ok(selected)
      const forked = await f.service.dispatch("conversationFork", {
        sessionId: "session-test",
        operationId: "legacy-fork-after-migration",
        entryId: selected.entryId,
      })
      assert.equal(forked.status, "completed")
      assert.equal(await readFile(record.sessionFile, "utf8"), after,
        "Fork must preserve the migrated source file byte-for-byte")
      const branch = await f.service.dispatch("conversationRead", {
        sessionId: forked.targetSessionId,
      })
      assert.deepEqual(branch.messages, migrated.messages.slice(0,
        migrated.messages.findIndex((message) => message.id === selected.id) + 1))
    })
})

test("read-only restore retains the official active branch and valid custom entries when sending", async (t) => {
  const f = await fixture(t)
  await f.send("branch-source", "ACTIVE_CONTEXT")
  await f.settled()
  const manager = f.chats.active.get("session-test").manager
  const leaf = manager.getLeafId()
  manager.appendMessage({
    role: "user",
    content: "ABANDONED_CONTEXT",
    timestamp: Date.now(),
  })
  manager.branch(leaf)
  const selectedLeaf = manager.appendCustomEntry("valid-host-metadata", {
    futureField: true,
  })
  const record = await f.store.get("session-test")
  await f.chats.close()
  const original = await readFile(record.sessionFile, "utf8")
  const restored = new ConversationService(
    f.directory,
    f.service,
    f.service.sessions,
    f.store,
    f.workspaces
  )
  f.service.conversations = restored
  t.after(() => restored.close())
  const read = await restored.read("session-test")
  assert.ok(
    !read.messages.some((message) => message.text === "ABANDONED_CONTEXT")
  )
  assert.equal(
    restored.active.get("session-test").manager.getLeafId(),
    selectedLeaf
  )
  assert.equal(await readFile(record.sessionFile, "utf8"), original)
  await f.send("branch-next", "Continue only the selected branch")
  assert.equal((await f.settled()).phase, "completed")
  const context = JSON.stringify(f.requests[1].messages)
  assert.ok(context.includes("ACTIVE_CONTEXT"))
  assert.ok(!context.includes("ABANDONED_CONTEXT"))
})

test("formal stdio RPC connects workspace, session config, real chat and persistent sidebar", async (t) => {
  const f = await fixture(t)
  const bridge = createBridge({ env: { MOON_DATA_DIR: f.directory } })
  t.after(() => bridge.close())
  const workspace = await bridge.call("workspaceAdd", { path: f.cwd })
  const send = {
    sessionId: "session-test",
    workspaceId: workspace.id,
    clientRequestId: "rpc-first",
    text: "RPC_FIRST_CONTEXT",
    connectionId: "local",
    modelId: model.id,
    thinking: "off",
  }
  const first = await bridge.call("conversationSend", send)
  assert.equal(first.inputAccepted, true)
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const state = await bridge.call("conversationRead", {
        sessionId: "session-test",
      })
      if (!["running", "stopping"].includes(state.phase)) return state
      await delay(25)
    }
    throw new Error("RPC local conversation did not settle")
  }
  assert.equal((await settled()).phase, "completed")
  await bridge.call("conversationSend", send)
  assert.equal(f.requests.length, 1)
  await bridge.call("conversationSend", {
    ...send,
    clientRequestId: "rpc-second",
    text: "RPC_SECOND_CONTEXT",
  })
  const final = await settled()
  assert.equal(
    final.messages.filter((message) => message.role === "user").length,
    2
  )
  assert.ok(
    JSON.stringify(f.requests[1].messages).includes("RPC_FIRST_CONTEXT")
  )
  const list = await bridge.call("conversationList", {})
  assert.equal(list.length, 1)
  assert.equal(list[0].status, "completed")
  assert.equal(list[0].unread, true)
  assert.equal(
    (
      await bridge.call("conversationMarkRead", {
        id: list[0].id,
        revision: list[0].revision,
      })
    ).unread,
    false
  )
  bridge.close()
  const restarted = createBridge({ env: { MOON_DATA_DIR: f.directory } })
  t.after(() => restarted.close())
  const restored = await restarted.call("conversationRead", {
    sessionId: "session-test",
  })
  assert.deepEqual(restored.messages, final.messages)
  assert.notEqual(restored.epoch, final.epoch)
})

// Fail the real filesystem boundary, after Pi has already changed its memory.
// Restore the builtin binding as well as fs's property for following tests.
function failHistoryWrite(t, method, matches) {
  const original = fs[method]
  let failures = 0
  const mocked = t.mock.method(fs, method, (...args) => {
    if (matches(...args)) {
      failures++
      throw Object.assign(new Error("ENOSPC: review disk fault"), {
        code: "ENOSPC",
      })
    }
    return original(...args)
  })
  syncBuiltinESMExports()
  const restore = () => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  }
  t.after(restore)
  return { restore, count: () => failures }
}

test("disk failure never accepts a user message or flushes the failed in-memory entry", async (t) => {
  for (const existing of [false, true]) {
    await t.test(existing ? "existing history" : "first message", async (t) => {
      const f = await fixture(t)
      if (existing) {
        await f.send("before-fault", "已经保存")
        await f.settled()
      }
      const fault = existing
        ? failHistoryWrite(
            t,
            "appendFileSync",
            (file, data) =>
              String(file).endsWith(".jsonl") &&
              String(data).includes('"role":"user"')
          )
        : failHistoryWrite(
            t,
            "openSync",
            (file, flags) => String(file).endsWith(".jsonl") && flags === "wx"
          )
      const response = await f.send("disk-fault", "必须保留的草稿")
      const failed = await f.settled()
      assert.ok(fault.count() > 0, "fault reached Pi's real disk write")
      fault.restore()
      assert.equal(response.inputAccepted, false)
      assert.equal(failed.phase, "failed")
      assert.match(failed.error, /保存失败.*磁盘空间/)
      assert.equal(
        failed.messages.filter((m) => m.role === "user").length,
        existing ? 1 : 0
      )
      assert.equal(
        f.requests.length,
        existing ? 1 : 0,
        "no inference on unsaved input"
      )
      const replay = await f.send("disk-fault", "必须保留的草稿")
      assert.equal(
        replay.inputAccepted,
        false,
        "same request is not silently replayed"
      )
      const recovered = await f.send("after-fault", "必须保留的草稿")
      assert.equal(recovered.inputAccepted, true)
      const final = await f.settled()
      assert.equal(final.phase, "completed")
      assert.equal(
        final.messages.filter((m) => m.text === "必须保留的草稿").length,
        1
      )
      const record = await f.store.get("session-test")
      const persisted = await readFile(record.sessionFile, "utf8")
      assert.equal(
        persisted
          .split("\n")
          .filter(
            (line) =>
              line.includes('"role":"user"') && line.includes("必须保留的草稿")
          ).length,
        1
      )
    })
  }
})

test("failed continuation persistence is not acknowledged and preserves earlier history", async (t) => {
  const f = await fixture(t, (_request, response) => {
    response.statusCode = 400
    response.end(JSON.stringify({ error: { message: "invalid request" } }))
  })
  await f.send("initial", "原始请求")
  assert.equal((await f.settled()).phase, "failed")
  const fault = failHistoryWrite(
    t,
    "appendFileSync",
    (file, data) =>
      String(file).endsWith(".jsonl") &&
      String(data).includes('"type":"custom_message"')
  )
  const result = await f.service.dispatch("conversationRetry", {
    sessionId: "session-test",
    clientRequestId: "continue-fault",
    connectionId: "local",
    modelId: model.id,
    thinking: "off",
  })
  await f.settled()
  assert.ok(fault.count() > 0)
  fault.restore()
  assert.equal(result.inputAccepted, false)
  assert.equal(result.messages.filter((m) => m.role === "user").length, 1)
  assert.equal(f.requests.length, 1)
})

test("a partial history write is preserved and cannot be hidden by a later append", async (t) => {
  const f = await fixture(t)
  await f.send("before-partial", "已保存历史")
  await f.settled()
  const record = await f.store.get("session-test")
  const original = fs.appendFileSync
  let broken
  const mocked = t.mock.method(fs, "appendFileSync", (...args) => {
    if (
      String(args[0]) === record.sessionFile &&
      String(args[1]).includes('"role":"user"')
    ) {
      original(args[0], '{"type":"message"')
      broken = fs.readFileSync(args[0])
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" })
    }
    return original(...args)
  })
  syncBuiltinESMExports()
  t.after(() => {
    mocked.mock.restore()
    syncBuiltinESMExports()
  })
  const response = await f.send("partial-write", "不应丢失的草稿")
  assert.equal(response.phase, "failed")
  mocked.mock.restore()
  syncBuiltinESMExports()
  assert.equal(response.inputAccepted, false)
  assert.ok(broken)
  assert.deepEqual(await readFile(record.sessionFile), broken)
  await assert.rejects(f.read(), /损坏/)
  await assert.rejects(f.send("after-partial", "不应丢失的草稿"), /损坏/)
  assert.deepEqual(await readFile(record.sessionFile), broken)
})

test("durable queue edits/removes pending inputs and all mode delivers distinct Pi user entries", async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(t, async (_request, response, number) => {
    response.write(chunk({ role: "assistant", content: "正在处理" }))
    if (number === 1) await gate
    response.end(chunk({}, "stop") + "data: [DONE]\n\n")
  })
  t.after(() => release())
  await f.send("queue-source", "第一项工作")
  await f.send("queue-first", "需要修订的要求")
  await f.send("queue-removed", "不应交付的要求")
  let snapshot = await f.send("queue-third", "第三项工作")
  assert.equal(snapshot.queue.items.length, 3)
  const revision = snapshot.queue.revision
  snapshot = await f.service.dispatch("conversationQueueEdit", {
    sessionId: snapshot.id,
    itemId: snapshot.queue.items[0].id,
    text: "已经修订的要求",
    revision,
  })
  await assert.rejects(
    f.service.dispatch("conversationQueueRemove", {
      sessionId: snapshot.id,
      itemId: snapshot.queue.items[1].id,
      revision,
    }),
    /队列已变化/
  )
  snapshot = await f.service.dispatch("conversationQueueRemove", {
    sessionId: snapshot.id,
    itemId: snapshot.queue.items[1].id,
    revision: snapshot.queue.revision,
  })
  snapshot = await f.service.dispatch("conversationQueueMode", {
    sessionId: snapshot.id,
    mode: "all",
    revision: snapshot.queue.revision,
  })
  const duplicate = await f.send("queue-first", "需要修订的要求")
  assert.equal(duplicate.queue.items.length, 2)
  release()
  const completed = await f.settled()
  assert.equal(completed.phase, "completed")
  assert.equal(completed.queue.items.length, 0)
  assert.deepEqual(
    completed.messages
      .filter((item) => item.role === "user")
      .map((item) => item.text),
    ["第一项工作", "已经修订的要求", "第三项工作"]
  )
  const users = f.requests
    .at(-1)
    .messages.filter((item) => item.role === "user")
  assert.deepEqual(
    users.slice(-2).map((item) =>
      typeof item.content === "string"
        ? item.content
        : item.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("")
    ),
    ["已经修订的要求", "第三项工作"]
  )
  assert.equal(f.requests.length, 2)
})

test("stopped queue survives restart without automatic sending and resumes only explicitly", async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(t, async (_request, response, number) => {
    response.write(chunk({ role: "assistant", content: "正在处理" }))
    if (number === 1) await gate
    response.end(chunk({}, "stop") + "data: [DONE]\n\n")
  })
  t.after(() => release())
  const running = await f.send("stop-source", "需要停止的工作")
  await f.send("kept-input", "保留到我确认后再发送")
  await f.service.dispatch("conversationStop", {
    sessionId: running.id,
    runId: running.runId,
  })
  const stopped = await f.settled()
  assert.equal(stopped.queue.paused, true)
  assert.equal(stopped.queue.items.length, 1)
  await f.chats.close()
  release()
  const restoredService = new ModelService(f.directory)
  await restoredService.initialize()
  const restored = new ConversationService(
    f.directory,
    restoredService,
    restoredService.sessions,
    f.store,
    f.workspaces
  )
  restoredService.conversations = restored
  t.after(async () => {
    await restored.close()
    await restoredService.close()
  })
  let snapshot = await restoredService.dispatch("conversationRead", {
    sessionId: running.id,
  })
  await delay(80)
  assert.equal(f.requests.length, 1)
  assert.equal(snapshot.queue.paused, true)
  await restoredService.dispatch("conversationQueueDeliver", {
    sessionId: running.id,
    itemId: snapshot.queue.items[0].id,
    revision: snapshot.queue.revision,
  })
  for (let i = 0; i < 200; i++) {
    snapshot = await restoredService.dispatch("conversationRead", {
      sessionId: running.id,
    })
    if (snapshot.phase === "completed" && !snapshot.queue.items.length) break
    await delay(25)
  }
  assert.equal(snapshot.phase, "completed")
  assert.equal(snapshot.queue.items.length, 0)
  assert.equal(
    snapshot.messages.filter(
      (item) => item.role === "user" && item.text === "保留到我确认后再发送"
    ).length,
    1
  )
})

test("a queued Skill fixes its body and preserves original input identity through Pi expansion", async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(t, async (_request, response, number) => {
    response.write(chunk({ role: "assistant", content: "正在处理" }))
    if (number === 1) await gate
    response.end(chunk({}, "stop") + "data: [DONE]\n\n")
  })
  t.after(() => release())
  const folder = join(f.cwd, ".pi", "skills", "queue-review")
  await mkdir(folder, { recursive: true })
  const skill = join(folder, "SKILL.md")
  const header =
    "---\nname: queue-review\ndescription: Queue delivery regression skill\n---\n"
  await writeFile(skill, header + "FIXED_BODY_AT_ACCEPTANCE")
  await f.send("skill-source", "第一项工作")
  const queued = await f.send(
    "skill-queued",
    "/skill:queue-review 保留这句原文"
  )
  assert.equal(queued.queue.items[0].materials[0].type, "skill")
  await writeFile(skill, header + "CHANGED_AFTER_ACCEPTANCE")
  release()
  const completed = await f.settled()
  assert.equal(completed.queue.items.length, 0)
  const user = completed.messages.find(
    (item) => item.text === "/skill:queue-review 保留这句原文"
  )
  assert.ok(user)
  assert.equal(user.attachments[0].materialType, "skill")
  assert.ok(
    JSON.stringify(f.requests.at(-1)).includes("FIXED_BODY_AT_ACCEPTANCE")
  )
  assert.ok(
    !JSON.stringify(f.requests.at(-1)).includes("CHANGED_AFTER_ACCEPTANCE")
  )
  assert.equal(
    (await f.send("skill-queued", "/skill:queue-review 保留这句原文")).queue
      .items.length,
    0
  )
})

test("failed queued user persistence recovers in the same process without dispatching deadlock", async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const f = await fixture(t, async (_request, response, number) => {
    response.write(chunk({ role: "assistant", content: "正在处理" }))
    if (number === 1) await gate
    response.end(chunk({}, "stop") + "data: [DONE]\n\n")
  })
  t.after(() => release())
  await f.send("disk-source", "第一项工作")
  await f.send("disk-queue", "QUEUED_DISK_FAULT")
  const fault = failHistoryWrite(
    t,
    "appendFileSync",
    (file, data) =>
      String(file).endsWith(".jsonl") &&
      String(data).includes('"role":"user"') &&
      String(data).includes("QUEUED_DISK_FAULT")
  )
  release()
  const failed = await f.settled()
  assert.ok(fault.count() > 0)
  fault.restore()
  assert.equal(failed.phase, "failed")
  assert.equal(failed.queue.items[0].status, "failed")
  const refreshed = await f.read()
  await f.service.dispatch("conversationQueueDeliver", {
    sessionId: refreshed.id,
    itemId: refreshed.queue.items[0].id,
    revision: refreshed.queue.revision,
  })
  let recovered
  for (let i = 0; i < 200; i++) {
    recovered = await f.read()
    if (recovered.phase === "completed" && !recovered.queue.items.length) break
    await delay(25)
  }
  assert.equal(recovered.phase, "completed")
  assert.equal(
    recovered.messages.filter(
      (item) => item.role === "user" && item.text === "QUEUED_DISK_FAULT"
    ).length,
    1
  )
})
