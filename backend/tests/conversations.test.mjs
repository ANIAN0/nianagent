import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { setTimeout as delay } from "node:timers/promises"
import { ModelService } from "../models.mjs"
import { createHash } from "node:crypto"
import { ConversationService } from "../conversations.mjs"
import { ConversationStore } from "../conversation-store.mjs"
import { extensionToolName } from "../extensions.mjs"
import { createBridge } from "./stdio-client.mjs"
import fs from "node:fs"
import filesystem from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"

const requestFingerprint = (text) => createHash("sha256").update(JSON.stringify([
  "send", text, "local", model.id, "off", [],
])).digest("hex")

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
  },
  modelInput = model.input
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
    models: [{ ...model, input: modelInput }],
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

// Register through the public loader boundary, keeping the real Pi prompt,
// preflight callbacks, event objects and persistence in these regressions.
function addInputExtension(f, factory) {
  const create = f.service.sessions.create.bind(f.service.sessions)
  f.service.sessions.create = (...args) => {
    const options = args[5] ?? {}
    args[5] = { ...options, extensionFactories: [...(options.extensionFactories ?? []), factory] }
    return create(...args)
  }
}

async function addNativeSkill(f) {
  const folder = join(f.cwd, ".pi", "skills", "home-review")
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, "SKILL.md"),
    "---\nname: home-review\ndescription: Native Home regression skill\n---\nNATIVE_HOME_SKILL_BODY")
}

test("idle public Pi Skill expansion preserves raw invocation through live and cold history", async (t) => {
  const f = await fixture(t)
  await addNativeSkill(f)
  const original = "/skill:home-review 检查正文参数"
  const accepted = await f.send("native-skill-home", original)
  assert.equal(accepted.inputAccepted, true)
  const done = await f.settled()
  const user = done.messages.find((message) => message.role === "user")
  assert.equal(user.text, original)
  assert.equal(user.attachments?.length ?? 0, 0)
  const actual = f.requests[0].messages.find((message) => message.role === "user")
  assert.match(JSON.stringify(actual.content), /NATIVE_HOME_SKILL_BODY/u)
  assert.match(JSON.stringify(actual.content), /检查正文参数/u)
  const record = await f.store.get("session-test")
  const bytes = await readFile(record.sessionFile, "utf8")
  assert.match(bytes, /moon-materials/u)
  assert.match(bytes, /NATIVE_HOME_SKILL_BODY/u)
  await f.chats.close()
  const cold = new ConversationService(f.directory, f.service, f.service.sessions, f.store, f.workspaces)
  t.after(() => cold.close())
  assert.deepEqual((await cold.read("session-test")).messages, done.messages)
  assert.equal((await cold.readReceipt("session-test", "native-skill-home")).state, "accepted")
  assert.equal(await readFile(record.sessionFile, "utf8"), bytes)
})

test("unknown, inline, removed Skill and ordinary whitespace stay ordinary public Pi input", async (t) => {
  const f = await fixture(t)
  await addNativeSkill(f)
  const inputs = [
    "/skill:missing.name 原样参数",
    "句内 /skill:home-review 不强制加载",
    "已删除前缀，只保留原任务",
    "  原文\n\n@Override @README.md.backup",
  ]
  for (const [index, text] of inputs.entries()) {
    await f.send(`raw-home-${index}`, text)
    const done = await f.settled()
    assert.equal(done.messages.filter((message) => message.role === "user").at(-1).text, text)
    const actual = f.requests.at(-1).messages.filter((message) => message.role === "user").at(-1)
    const actualText = actual.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
    assert.equal(actualText, text)
    assert.doesNotMatch(actualText, /NATIVE_HOME_SKILL_BODY/u)
  }
})

test("idle Skill plus paths and image keeps leading native parsing and original material ownership", async (t) => {
  const f = await fixture(t, undefined, ["text", "image"])
  await addNativeSkill(f)
  const file = join(f.cwd, "引用 文件.md")
  const directory = join(f.cwd, "docs")
  const imagePath = join(f.cwd, "image.png")
  await writeFile(file, "FILE_BODY_NOT_AUTOMATICALLY_READ")
  await mkdir(directory)
  await writeFile(join(directory, "child.md"), "DIRECTORY_BODY_NOT_AUTOMATICALLY_READ")
  await writeFile(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==", "base64"))
  const materials = await f.service.materials.prepare("session-test", f.cwd, [file, directory, imagePath])
  assert.ok(materials.every((item) => item.status === "ready"), JSON.stringify(materials))
  const text = "/skill:home-review 使用本次材料"
  await f.service.dispatch("conversationSend", {
    sessionId: "session-test", workspaceId: "workspace-test", clientRequestId: "native-mixed-home",
    text, materials, connectionId: "local", modelId: model.id, thinking: "off",
  })
  const done = await f.settled()
  const user = done.messages.find((message) => message.role === "user")
  assert.equal(user.text, text)
  assert.deepEqual(user.attachments.map((item) => item.materialType), ["file", "directory", "image"])
  assert.deepEqual(user.attachments.map((item) => item.id), materials.map((item) => item.id))
  const messages = f.requests[0].messages
  const nativeUser = messages.find((message) => message.role === "user")
  assert.match(JSON.stringify(nativeUser.content), /NATIVE_HOME_SKILL_BODY/u)
  assert.ok(nativeUser.content.some((part) => part.type === "image_url"))
  const context = messages.find((message) => JSON.stringify(message.content).includes("Referenced paths (not read):"))
  assert.ok(context)
  assert.ok(messages.indexOf(context) > messages.indexOf(nativeUser))
  assert.match(JSON.stringify(context.content), /引用 文件\.md|docs/u)
  assert.doesNotMatch(JSON.stringify(context.content), /FILE_BODY_NOT_AUTOMATICALLY_READ|DIRECTORY_BODY_NOT_AUTOMATICALLY_READ/u)
  await f.chats.close()
  const cold = new ConversationService(f.directory, f.service, f.service.sessions, f.store, f.workspaces)
  t.after(() => cold.close())
  assert.deepEqual((await cold.read("session-test")).messages, done.messages)
})

test("public native commands and input hooks persist handled without fabricated user acceptance or replay", async (t) => {
  const f = await fixture(t)
  let commands = 0, inputs = 0
  addInputExtension(f, (pi) => {
    pi.registerCommand("claim-home", { handler: async () => { commands++ } })
    pi.on("input", (event) => {
      if (event.text !== "CLAIM_HOME_INPUT") return
      inputs++
      return { action: "handled" }
    })
  })
  const command = await f.send("native-command-home", "/claim-home 保留参数")
  assert.equal(command.inputAccepted, false)
  assert.equal(command.inputDisposition, "handled")
  assert.equal(command.notice.kind, "input-handled")
  assert.ok(Number.isFinite(Date.parse(command.notice.occurredAt)))
  assert.equal(command.notice.runId, command.runId)
  assert.equal(command.messages.length, 0)
  assert.equal((await f.chats.readReceipt("session-test", "native-command-home")).state, "handled")
  await f.send("native-command-home", "/claim-home 保留参数")
  assert.equal(commands, 1)
  const input = await f.send("native-hook-home", "CLAIM_HOME_INPUT")
  assert.equal(input.inputDisposition, "handled")
  assert.equal(input.inputAccepted, false)
  assert.equal(inputs, 1)
  assert.equal(f.requests.length, 0)
  await f.chats.close()
  const coldStore = new ConversationStore(f.directory)
  await coldStore.initialize()
  const cold = new ConversationService(f.directory, f.service, f.service.sessions, coldStore, f.workspaces)
  f.service.conversations = cold
  t.after(() => cold.close())
  const restored = await cold.read("session-test")
  assert.equal(restored.inputDisposition, "handled")
  assert.equal(restored.inputAccepted, false)
  assert.ok(Number.isFinite(Date.parse(restored.notice.occurredAt)))
  assert.equal((await cold.readReceipt("session-test", "native-command-home")).state, "handled")
  await f.send("native-hook-home", "CLAIM_HOME_INPUT")
  assert.equal(inputs, 1)
  await f.send("after-handled-home", "普通首条消息仍可发送")
  const done = await f.settled()
  assert.equal(done.inputDisposition, undefined)
  assert.equal(done.notice, undefined)
  assert.equal(done.messages.filter((message) => message.role === "user").length, 1)
  assert.equal(f.requests.length, 1)
})

test("handled ledger failure stays unknown after restart with readable earlier history and never replays", async (t) => {
  const f = await fixture(t)
  let claims = 0
  addInputExtension(f, (pi) => {
    pi.registerCommand("claim-fault", { handler: async () => { claims++ } })
  })
  await f.send("before-handled-fault", "真实已有历史")
  const prior = await f.settled()
  const update = f.store.update.bind(f.store)
  const fault = t.mock.method(f.store, "update", async (...args) => {
    if (args[3]?.outcome === "handled") throw Object.assign(new Error("ENOSPC: handled receipt"), { code: "ENOSPC" })
    return update(...args)
  })
  const unknown = await f.send("handled-fault", "/claim-fault 原副本")
  fault.mock.restore()
  assert.equal(unknown.inputAccepted, false)
  assert.equal(unknown.inputDisposition, undefined)
  assert.equal(unknown.issue.code, "result_unknown")
  assert.equal((await f.store.request("session-test", "handled-fault")).status, "started")
  assert.equal((await f.chats.readReceipt("session-test", "handled-fault")).state, "unknown")
  assert.equal(claims, 1)
  await f.chats.close()
  const coldStore = new ConversationStore(f.directory)
  await coldStore.initialize()
  const cold = new ConversationService(f.directory, f.service, f.service.sessions, coldStore, f.workspaces)
  f.service.conversations = cold
  t.after(() => cold.close())
  const record = await coldStore.get("session-test")
  const bytes = await readFile(record.sessionFile, "utf8")
  const index = await readFile(coldStore.file, "utf8")
  assert.deepEqual((await cold.read("session-test")).messages, prior.messages)
  assert.equal((await cold.readReceipt("session-test", "handled-fault")).state, "unknown")
  assert.equal(await readFile(record.sessionFile, "utf8"), bytes)
  assert.equal(await readFile(coldStore.file, "utf8"), index)
  await assert.rejects(f.send("handled-fault", "/claim-fault 原副本"), (error) => error.issue?.code === "result_unknown")
  assert.equal(claims, 1)
  assert.equal(f.requests.length, 1)
})

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
  await assert.rejects(
    f.send("must-not-pollute", "不能污染未决压缩边界"),
    /上次操作/
  )
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
  // This case checks real shell results, after explicit permission to execute.
  await f.service.dispatch("conversationPermissionSet", {
    sessionId: "session-test", mode: "full-access", revision: 0,
  })
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

test("official Pi length continuation is idempotent and preserves an already successful write", async (t) => {
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) response.end(chunk({ role: "assistant", tool_calls: [{
      index: 0, id: "write-once", type: "function",
      function: { name: "write", arguments: JSON.stringify({ path: "once.md", content: "WRITE_ONCE" }) },
    }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    else response.end(chunk({ role: "assistant", content: number === 2 ? "答案尚未写完" : "继续完成" }) +
      chunk({}, number === 2 ? "length" : "stop") + "data: [DONE]\n\n")
  })
  await f.service.sessions.apply("session-test", f.cwd, ["write"], "directory", 1)
  await f.send("length-write", "写入文件后给出答案")
  const truncated = await f.settled()
  assert.equal(truncated.phase, "completed")
  assert.equal(truncated.messages.at(-1).stopReason, "length")
  assert.equal(truncated.canContinue, true)
  const continuationRequest = {
    sessionId: "session-test", clientRequestId: "continue-length",
    connectionId: "local", modelId: model.id, thinking: "off",
  }
  await f.service.dispatch("conversationRetry", continuationRequest)
  const complete = await f.settled()
  const requests = f.requests.length
  await f.service.dispatch("conversationRetry", continuationRequest)
  assert.equal(f.requests.length, requests)
  assert.equal(complete.canContinue, false)
  assert.equal(complete.messages.flatMap((message) => message.tools || []).filter((tool) => tool.name === "write").length, 1)
  assert.equal(await readFile(join(f.cwd, "once.md"), "utf8"), "WRITE_ONCE")
  const record = await f.store.get("session-test")
  const source = await readFile(record.sessionFile, "utf8")
  const entries = source.trim().split("\n").map(JSON.parse)
  const continued = complete.messages.find((message) => message.text.includes("请继续完成上一条"))
  const branchIndex = f.chats.active.get("session-test").manager.getBranch().findIndex((entry) => entry.id === continued.entryId)
  assert.equal(continued.historyIndex, branchIndex)
  assert.equal(entries.filter((entry) => entry.customType === "moon-continuation").length, 1)
})

test("official Pi read image results project controlled media references and recover the same bytes", async (t) => {
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) response.end(chunk({ role: "assistant", tool_calls: [{
      index: 0, id: "read-image", type: "function", function: { name: "read", arguments: '{"path":"pixel.png"}' },
    }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    else response.end(chunk({ role: "assistant", content: "图片已读取" }) + chunk({}, "stop") + "data: [DONE]\n\n")
  })
  await writeFile(join(f.cwd, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgaPj/HwAEggJ/59habAAAAABJRU5ErkJggg==", "base64"))
  await f.service.sessions.apply("session-test", f.cwd, ["read"], "directory", 1)
  await f.send("image-result", "读取pixel.png")
  const complete = await f.settled()
  const tool = complete.messages.flatMap((message) => message.tools || [])[0]
  assert.equal(tool.images.length, 1)
  assert.equal(tool.images[0].status, "ready", tool.images[0].error)
  assert.equal(Object.hasOwn(tool.images[0], "data"), false)
  const preview = await f.service.materials.preview(f.cwd, tool.images[0].id)
  assert.equal(preview.mimeType, "image/png")
  assert.ok(preview.data.length > 0)
  const record = await f.store.get("session-test")
  const original = await readFile(record.sessionFile, "utf8")
  await f.chats.close()
  const restarted = new ConversationService(f.directory, f.service, f.service.sessions, f.store, f.workspaces)
  t.after(() => restarted.close())
  const recovered = await restarted.read("session-test")
  const recoveredTool = recovered.messages.flatMap((message) => message.tools || [])[0]
  assert.deepEqual(recoveredTool.images, tool.images)
  assert.equal((await f.service.materials.preview(f.cwd, recoveredTool.images[0].id)).data, preview.data)
  assert.equal(await readFile(record.sessionFile, "utf8"), original)
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
  // Keep the default fixture policy; grant execution only in this stop case.
  await f.service.dispatch("conversationPermissionSet", {
    sessionId: "session-test", mode: "full-access", revision: 0,
  })
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
  assert.equal(failed.issue.code, "model_request_invalid")
  assert.match(failed.issue.details, /400/)
  assert.equal(failed.issue.recovery, "settings")
  assert.equal(failed.messages.at(-1).text, "")
  assert.equal(failed.messages.at(-1).issue.code, "model_request_invalid")
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
  assert.equal((await f.chats.readReceipt("session-test", "preflight-1")).state, "rejected")
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
  await assert.rejects(retry(), Error)
  const refused = await f.chats.readReceipt("session-test", "invalid-continue")
  assert.equal(refused.state, "rejected")
  assert.equal(refused.clientRequestId, "invalid-continue")
  assert.equal(refused.issue.code, "operation_failed")
  const retained = await f.read()
  assert.equal(retained.inputAccepted, false)
  assert.equal(retained.clientRequestId, failedNext.clientRequestId)
  assert.equal(retained.runId, failedNext.runId)
  assert.deepEqual(retained.messages, failedNext.messages)
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
  assert.equal((await restored.readReceipt("session-test", "preflight-3")).state, "rejected")
  await assert.rejects(retry(), (error) =>
    error.issue?.code === "request_not_accepted" && error.issue.recovery === "none")
  const coldRefused = await restored.readReceipt("session-test", "invalid-continue")
  assert.equal(coldRefused.state, "rejected")
  assert.equal(coldRefused.clientRequestId, refused.clientRequestId)
  const coldRetained = await restored.read("session-test")
  assert.equal(coldRetained.inputAccepted, false)
  assert.equal(coldRetained.clientRequestId, failedNext.clientRequestId)
  assert.equal(coldRetained.runId, failedNext.runId)
  assert.deepEqual(coldRetained.messages, failedNext.messages)
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
        const temporaryAnchor = restored.active
          .get("session-test")
          .manager.getBranch()
          .find(
            (entry) =>
              entry.type === "message" && entry.message.role === "assistant"
          ).id
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
      const selected = migrated.messages.find(
        (message) => message.role === "assistant" && message.forkable
      )
      assert.ok(selected)
      const forked = await f.service.dispatch("conversationFork", {
        sessionId: "session-test",
        operationId: "legacy-fork-after-migration",
        entryId: selected.entryId,
      })
      assert.equal(forked.status, "completed")
      assert.equal(
        await readFile(record.sessionFile, "utf8"),
        after,
        "Fork must preserve the migrated source file byte-for-byte"
      )
      const branch = await f.service.dispatch("conversationRead", {
        sessionId: forked.targetSessionId,
      })
      assert.deepEqual(
        branch.messages,
        migrated.messages.slice(
          0,
          migrated.messages.findIndex((message) => message.id === selected.id) +
            1
        )
      )
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
      assert.equal(failed.issue.code, "storage_space")
      assert.equal(failed.issue.recovery, "reload")
      assert.match(failed.issue.details, /ENOSPC/)
      assert.match(failed.error, /历史未能保存.*存储空间不足/)
      assert.equal(
        failed.messages.filter((m) => m.role === "user").length,
        existing ? 1 : 0
      )
      assert.equal(
        f.requests.length,
        existing ? 1 : 0,
        "no inference on unsaved input"
      )
      await assert.rejects(f.send("disk-fault", "必须保留的草稿"), (error) =>
        error.issue?.code === "result_unknown" && error.issue.recovery === "check")
      assert.equal(f.requests.length, existing ? 1 : 0,
        "same request is not acknowledged or silently replayed after a persistence failure")
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
  // A cold queue can be edited without creating a generation session or HTTP request.
  snapshot = await restoredService.dispatch("conversationQueueEdit", {
    sessionId: running.id, itemId: snapshot.queue.items[0].id,
    text: "冷恢复修订后再发送", materials: [], revision: snapshot.queue.revision,
  })
  assert.equal(snapshot.queue.items[0].text, "冷恢复修订后再发送")
  assert.equal(restored.active.get(running.id).session, undefined)
  assert.equal(f.requests.length, 1)
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
      (item) => item.role === "user" && item.text === "冷恢复修订后再发送"
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

for (const storage of ["queue", "index"]) {
  test(`restored queue delivery identifies ${storage} commit failure without claiming Pi history permissions`, async (t) => {
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
    const running = await f.send("storage-source", "原始工作")
    await f.send("storage-pending", "PENDING_AFTER_RESTART")
    await f.service.dispatch("conversationStop", {
      sessionId: running.id,
      runId: running.runId,
    })
    await f.settled()
    await f.chats.close()
    release()
    const service = new ModelService(f.directory)
    await service.initialize()
    const restored = new ConversationService(
      f.directory,
      service,
      service.sessions,
      f.store,
      f.workspaces
    )
    service.conversations = restored
    t.after(async () => {
      await restored.close()
      await service.close()
    })
    const read = () =>
      service.dispatch("conversationRead", { sessionId: running.id })
    const original = await read()
    const rename = filesystem.rename
    let failures = 0
    const fault = t.mock.method(
      filesystem,
      "rename",
      async (source, destination) => {
        const destinationFile =
          storage === "queue"
            ? join(restored.queue.directory, `${running.id}.json`)
            : f.store.file
        if (String(destination) === destinationFile) {
          const candidate = JSON.parse(await readFile(source, "utf8"))
          const selected =
            storage === "queue"
              ? candidate.items.some(
                  (item) =>
                    item.clientRequestId === "storage-pending" &&
                    item.status === "dispatching"
                )
              : candidate.conversations.some(
                  (record) =>
                    record.id === running.id &&
                    record.lastRequestId === "storage-pending"
                )
          if (selected) {
            failures++
            throw Object.assign(
              new Error("EPERM rename PRIVATE_DIAGNOSTIC_PATH"),
              { code: "EPERM", syscall: "rename" }
            )
          }
        }
        return rename(source, destination)
      }
    )
    syncBuiltinESMExports()
    t.after(() => {
      fault.mock.restore()
      syncBuiltinESMExports()
    })
    await service.dispatch("conversationQueueDeliver", {
      sessionId: running.id,
      itemId: original.queue.items[0].id,
      revision: original.queue.revision,
    })
    let failed
    for (let i = 0; i < 200; i++) {
      failed = await read()
      if (failed.phase === "failed") break
      await delay(25)
    }
    assert.equal(failures, 1)
    assert.equal(failed.phase, "failed")
    assert.equal(failed.issue.code, "queue_storage")
    assert.match(failed.issue.details, /EPERM/)
    assert.match(failed.issue.details, /rename/)
    assert.match(failed.error, /消息已保留/)
    assert.ok(!failed.error.includes("PRIVATE_DIAGNOSTIC_PATH"))
    assert.ok(!failed.error.includes("会话文件权限不足"))
    assert.equal(failed.queue.items[0].status, "pending")
    assert.equal(failed.queue.paused, true)
    assert.equal(
      failed.messages.filter(
        (message) =>
          message.role === "user" && message.text === "PENDING_AFTER_RESTART"
      ).length,
      0
    )
    assert.equal(f.requests.length, 1)
    fault.mock.restore()
    syncBuiltinESMExports()
    await service.dispatch("conversationQueueDeliver", {
      sessionId: running.id,
      itemId: failed.queue.items[0].id,
      revision: failed.queue.revision,
    })
    let completed
    for (let i = 0; i < 200; i++) {
      completed = await read()
      if (completed.phase === "completed" && !completed.queue.items.length)
        break
      await delay(25)
    }
    assert.equal(completed.phase, "completed")
    assert.equal(completed.queue.items.length, 0)
    assert.equal(
      completed.messages.filter(
        (message) =>
          message.role === "user" && message.text === "PENDING_AFTER_RESTART"
      ).length,
      1
    )
    assert.equal(f.requests.length, 2)
  })
}

test("queue seed preparation owns the original item until Pi history commits", { timeout: 12000 }, async (t) => {
  let finishFirst
  const first = new Promise((resolve) => { finishFirst = resolve })
  const f = await fixture(t, async (_request, response, number) => {
    response.write(chunk({ role: "assistant", content: "working" }))
    if (number === 1) await first
    response.end(chunk({}, "stop") + "data: [DONE]\n\n")
  })
  t.after(() => finishFirst())
  const running = await f.send("seed-source", "source")
  await f.send("seed-item", "original queued requirement")
  await f.service.dispatch("conversationStop", { sessionId: running.id, runId: running.runId })
  await f.settled()
  await f.chats.close()
  finishFirst()
  const host = new ModelService(f.directory)
  await host.initialize()
  const chats = new ConversationService(f.directory, host, host.sessions, f.store, f.workspaces)
  host.conversations = chats
  t.after(async () => { await chats.close(); await host.close() })
  const cold = await host.dispatch("conversationRead", { sessionId: running.id })
  let entered, release
  const started = new Promise((resolve) => { entered = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  t.after(() => release())
  const resolveMaterials = host.materials.resolveForPrompt.bind(host.materials)
  host.materials.resolveForPrompt = async (input) => {
    const prepared = await resolveMaterials(input)
    if (input.text === "original queued requirement") { entered(); await gate }
    return prepared
  }
  const delivered = await host.dispatch("conversationQueueDeliver", { sessionId: running.id, itemId: cold.queue.items[0].id, revision: cold.queue.revision })
  await started
  const edit = host.dispatch("conversationQueueEdit", {
    sessionId: running.id, itemId: cold.queue.items[0].id, text: "must not replace frozen delivery", materials: [], revision: delivered.queue.revision,
  })
  // Attach the rejection observer before releasing the gate.
  const rejected = assert.rejects(edit, /队列已变化|已经交付/)
  await delay(30)
  assert.equal(chats.active.get(running.id).queue.items[0].text, "original queued requirement")
  release()
  await rejected
  let snapshot
  for (let index = 0; index < 200; index++) {
    snapshot = await host.dispatch("conversationRead", { sessionId: running.id })
    if (snapshot.phase === "completed" && !snapshot.queue.items.length) break
    await delay(25)
  }
  assert.equal(snapshot.phase, "completed")
  assert.equal(snapshot.messages.filter((message) => message.role === "user").at(-1).text, "original queued requirement")
  const sent = f.requests.at(-1).messages.filter((message) => message.role === "user")
  assert.ok(sent.some((message) => JSON.stringify(message.content).includes("original queued requirement")))
  assert.equal(JSON.stringify(sent).includes("must not replace"), false)
})

test("cancel after creating the first row leaves a durable rejected request without Pi acceptance", async (t) => {
  const f = await fixture(t)
  const controller = new AbortController()
  const create = f.store.create.bind(f.store)
  const createFault = t.mock.method(f.store, "create", async (...args) => {
    const record = await create(...args)
    controller.abort()
    return record
  })
  await assert.rejects(f.send("prepare-cancel", "saved original", controller.signal), { name: "AbortError" })
  createFault.mock.restore()
  const row = await f.store.get("session-test")
  assert.equal(row.status, "idle")
  assert.equal(row.lastRequestId, "")
  assert.equal(f.requests.length, 0)
  assert.equal((await f.service.dispatch("conversationReceiptRead", {
    sessionId: row.id, clientRequestId: "prepare-cancel",
  })).state, "rejected")

  await f.chats.close()
  const cold = new ConversationService(f.directory, f.service, f.service.sessions, f.store, f.workspaces)
  f.service.conversations = cold
  t.after(() => cold.close())
  const before = await readFile(f.store.file, "utf8")
  assert.equal((await cold.readReceipt(row.id, "prepare-cancel")).state, "rejected")
  assert.equal(await readFile(f.store.file, "utf8"), before)
  await assert.rejects(f.send("prepare-cancel", "saved original"), /原请求尚未接受/)
  assert.equal(f.requests.length, 0)
  const running = await f.send("prepare-new", "saved original")
  await cold.active.get(running.id).run
  assert.equal(f.requests.length, 1)
})

test("a new request preflight failure preserves the preceding accepted run and its Pi input", async (t) => {
  const f = await fixture(t)
  await f.send("previous-accepted", "previous input")
  const before = await f.settled()
  const record = await f.store.get(before.id)
  const history = await readFile(record.sessionFile, "utf8")
  await assert.rejects(f.service.dispatch("conversationSend", {
    sessionId: before.id, workspaceId: "workspace-test", clientRequestId: "new-preflight-failed",
    text: "new input", connectionId: "local", modelId: "missing-model", thinking: "off",
  }), /模型已移除/)
  const after = await f.read()
  assert.equal(after.runId, before.runId)
  assert.equal(after.clientRequestId, before.clientRequestId)
  assert.equal(after.phase, before.phase)
  assert.deepEqual(after.messages, before.messages)
  assert.equal(await readFile(record.sessionFile, "utf8"), history)
  assert.equal((await f.chats.readReceipt(before.id, "previous-accepted")).state, "accepted")
  assert.equal((await f.chats.readReceipt(before.id, "new-preflight-failed")).state, "rejected")
  assert.equal(f.requests.length, 1)
})

test("cold preparation receipts are readable before a row exists and never replay the original request", async (t) => {
  const f = await fixture(t)
  await f.store.beginRequest("session-test", "old-preparation", requestFingerprint("not started"), f.chats.epoch)
  assert.equal(await f.store.get("session-test"), null)
  await f.chats.close()
  const cold = new ConversationService(f.directory, f.service, f.service.sessions, f.store, f.workspaces)
  f.service.conversations = cold
  t.after(() => cold.close())
  const before = await readFile(f.store.file, "utf8")
  assert.equal((await cold.readReceipt("session-test", "old-preparation")).state, "rejected")
  assert.equal((await cold.readReceipt("session-test", "unobserved")).state, "unknown")
  assert.equal(await readFile(f.store.file, "utf8"), before)
  assert.equal(await f.store.get("session-test"), null)
  assert.equal(cold.active.size, 0)
  await assert.rejects(f.send("old-preparation", "different payload"), /不同内容/)
  await assert.rejects(f.send("old-preparation", "not started"), /原请求尚未接受/)
  assert.equal(f.requests.length, 0)
})

test("a failed rejection ledger write stays unknown without altering an already accepted run", async (t) => {
  const f = await fixture(t)
  await f.send("accepted-before-ledger-fault", "previous input")
  await f.settled()
  const before = await f.store.get("session-test")
  const fault = t.mock.method(f.store, "rejectRequest", async () => {
    throw Object.assign(new Error("unavailable"), { code: "ENOSPC" })
  })
  await assert.rejects(f.service.dispatch("conversationSend", {
    sessionId: "session-test", workspaceId: "workspace-test", clientRequestId: "ledger-fault",
    text: "unaccepted input", connectionId: "local", modelId: "missing-model", thinking: "off",
  }), (error) => error.issue?.code === "result_unknown")
  fault.mock.restore()
  assert.equal((await f.chats.readReceipt("session-test", "ledger-fault")).state, "unknown")
  assert.deepEqual(await f.store.get("session-test"), before)
  assert.equal((await f.chats.readReceipt("session-test", "accepted-before-ledger-fault")).state, "accepted")
  assert.equal(f.requests.length, 1)
})

test("started metadata without the first Pi file cannot prove input rejection or idempotent acceptance", async (t) => {
  const f = await fixture(t)
  const update = f.store.update.bind(f.store)
  const fault = t.mock.method(f.store, "update", async (...args) => {
    const record = await update(...args)
    if (args[3]) throw Object.assign(new Error("committed cleanup failed"), {
      name: "MoonOperationError",
      issue: { code: "result_unknown", summary: "请核对原请求。", recovery: "check", severity: "warning" },
    })
    return record
  })
  await assert.rejects(f.send("started-no-pi-input", "not yet appended"),
    (error) => error.issue?.code === "result_unknown")
  fault.mock.restore()
  assert.equal((await f.store.request("session-test", "started-no-pi-input")).status, "started")
  assert.equal((await f.chats.readReceipt("session-test", "started-no-pi-input")).state, "unknown")
  await assert.rejects(f.send("started-no-pi-input", "not yet appended"),
    (error) => error.issue?.code === "result_unknown")
  assert.equal(f.requests.length, 0)
})

test("acceptance proof survives an active Pi leaf change and reads never append input", async (t) => {
  const f = await fixture(t)
  await f.send("accepted-earlier-leaf", "first")
  await f.settled()
  const state = f.chats.active.get("session-test")
  const firstUser = state.manager.getEntries().find((entry) =>
    entry.type === "message" && entry.message.role === "user")
  const manager = state.manager
  manager.branch(firstUser.parentId)
  const before = await readFile(state.record.sessionFile, "utf8")
  assert.equal(manager.getBranch().some((entry) => entry.id === firstUser.id), false)
  assert.equal((await f.chats.readReceipt("session-test", "accepted-earlier-leaf")).state, "accepted")
  assert.equal(await readFile(state.record.sessionFile, "utf8"), before)
  assert.equal(f.requests.length, 1)
})

test("the installed Pi persists accepted user input before the first assistant response", async (t) => {
  let finish
  const gate = new Promise((resolve) => { finish = resolve })
  const f = await fixture(t, async (_request, response) => {
    await gate
    response.end(chunk({ role: "assistant", content: "finished" }) + chunk({}, "stop") + "data: [DONE]\n\n")
  })
  try {
    const running = await f.send("first-user-durable", "original before first response")
    assert.equal(running.inputAccepted, true)
    const record = await f.store.get(running.id)
    const before = await readFile(record.sessionFile, "utf8")
    const entries = before.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    assert.ok(entries.some((entry) => entry.type === "custom" &&
      entry.customType === "moon-request" && entry.data.clientRequestId === "first-user-durable"))
    assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "user" &&
      JSON.stringify(entry.message.content).includes("original before first response")))
    assert.equal(entries.some((entry) => entry.type === "message" && entry.message.role === "assistant"), false)
    assert.equal((await f.chats.readReceipt(running.id, "first-user-durable")).state, "accepted")
    assert.equal(await readFile(record.sessionFile, "utf8"), before)
  } finally { finish() }
  await f.settled()
})

test("a declared extension executes through Pi, preserves versioned presentation and module identity in read-only cold history", async (t) => {
  const name = extensionToolName("example-note", "note")
  const f = await fixture(t, (_request, response, number) => {
    if (number === 1) response.end(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "extension-result", type: "function", function: { name, arguments: '{"text":"正式Pi工具结果"}' } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n")
    else response.end(chunk({ role: "assistant", content: "记录已生成" }) + chunk({}, "stop") + "data: [DONE]\n\n")
  })
  await f.service.dispatch("extensionConfigure", { id: "example-note", revision: 0, enabled: true, configuration: '{"prefix":"验收"}', operationRequestId: "enable-extension" })
  await f.service.sessions.apply("session-test", f.cwd, [name], "directory", 1)
  await f.service.dispatch("conversationPermissionSet", {
    sessionId: "session-test", mode: "full-access", revision: 0,
  })
  await f.send("formal-extension-request", "生成短记录")
  const result = await f.settled()
  assert.equal(result.phase, "completed")
  const tool = result.messages.flatMap((message) => message.tools || []).find((tool) => tool.name === name)
  assert.ok(tool, JSON.stringify(f.sdkErrors))
  assert.equal(tool.status, "success")
  assert.equal(tool.source, "扩展 · 扩展接入示例")
  assert.deepEqual(tool.presentation, { kind: "moon.note", version: 1, payload: '{"title":"验收","text":"正式Pi工具结果"}' })
  assert.equal(f.requests.length, 2)
  assert.ok(f.requests[1].messages.some((message) => message.role === "tool" && message.content.includes("正式Pi工具结果")))
  const record = await f.store.get("session-test")
  const before = await readFile(record.sessionFile, "utf8")
  assert.ok(before.includes('"moonPresentation"'))
  assert.ok(before.includes('"moonExtension"'))
  await f.chats.close()
  await f.service.dispatch("extensionConfigure", { id: "example-note", revision: 1, enabled: false, configuration: '{"prefix":"验收"}' })
  f.service.extensions.loadedToolSources.clear()
  const restored = new ConversationService(f.directory, f.service, f.service.sessions, f.store, f.workspaces)
  t.after(() => restored.close())
  const cold = await restored.read("session-test")
  const oldTool = cold.messages.flatMap((message) => message.tools || []).find((tool) => tool.name === name)
  assert.deepEqual(oldTool.presentation, tool.presentation)
  assert.equal(oldTool.source, tool.source)
  assert.equal(cold.inputAccepted, true)
  assert.equal(await readFile(record.sessionFile, "utf8"), before)
  assert.equal(f.requests.length, 2)
})
