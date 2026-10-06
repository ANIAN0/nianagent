import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { createServer } from "node:http"
import { setTimeout as delay } from "node:timers/promises"
import { ModelService } from "../models.mjs"
import { ConversationLive } from "../conversation-live.mjs"
import { ConversationPermissions } from "../conversation-permissions.mjs"
import {
  conversationStatistics,
  runStatisticsEvent,
} from "../conversation-statistics.mjs"

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "moon-live-flow-")),
    cwd = join(root, "project")
  await mkdir(cwd)
  t.after(async () => {
    const absolute = resolve(root)
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep))
    assert.equal((await lstat(absolute)).isSymbolicLink(), false)
    await rm(absolute, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  })
  return { root, cwd }
}
const until = async (read, condition) => {
  for (let index = 0; index < 200; index++) {
    const value = await read()
    if (condition(value)) return value
    await delay(20)
  }
  throw new Error("目标状态未出现")
}
const chunk = (delta, finish_reason = null, usage) =>
  `data: ${JSON.stringify({ id: "test-reply", object: "chat.completion.chunk", created: 1, model: "live-test", choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`
async function fixture(t, respond) {
  const { root, cwd } = await workspace(t),
    directory = join(root, "data"),
    requests = []
  const server = createServer(async (request, response) => {
    let text = ""
    for await (const part of request) text += part
    const body = JSON.parse(text)
    requests.push(body)
    response.setHeader("Content-Type", "text/event-stream")
    try {
      await respond(body, response, requests.length)
    } catch {
      response.destroy()
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const service = new ModelService(directory)
  await service.initialize()
  const create = service.sessions.create.bind(service.sessions)
  service.sessions.create = (
    cwd,
    instructions,
    tools,
    signal,
    recover,
    options = {}
  ) =>
    create(cwd, instructions, tools, signal, recover, {
      ...options,
      extensionFactories: [
        ...(options.extensionFactories || []),
        (pi) =>
          pi.registerCommand("ask-name", {
            description: "询问名称",
            handler: async (_args, ctx) => {
              const name = await ctx.ui.input("名称", "输入名称")
              ctx.ui.notify(`名称：${name ?? "取消"}`)
            },
          }),
      ],
    })
  await service.save({
    id: "local",
    name: "本地协议验收",
    kind: "api",
    endpoint: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: "openai-completions",
    credential: "none",
    keySaved: false,
    apiKey: "",
    environmentVariable: "",
    headers: "{}",
    models: [
      {
        id: "live-test",
        name: "Live Test",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        contextWindow: 8192,
        maxTokens: 512,
      },
    ],
  })
  const selectedWorkspace = await service.workspaces.add(cwd)
  await service.sessions.apply("session", cwd, ["read", "write"], "none")
  t.after(async () => {
    await service.close()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })
  const call = (operation, input = {}, signal) =>
    service.dispatch(operation, { sessionId: "session", ...input }, signal)
  const send = (id, text, delivery) =>
    call("conversationSend", {
      workspaceId: selectedWorkspace.id,
      clientRequestId: id,
      text,
      connectionId: "local",
      modelId: "live-test",
      thinking: "off",
      ...(delivery ? { delivery } : {}),
    })
  const read = () => call("conversationRead")
  const settled = () =>
    until(read, (snapshot) => !["running", "stopping"].includes(snapshot.phase))
  return { root, cwd, service, call, send, read, settled, requests }
}
test("Pi流式变化使用版本增量，订阅取消不停止运行，最终统计可冷恢复", async (t) => {
  const app = await fixture(t, async (_body, response) => {
    response.write(chunk({ role: "assistant", content: "第一段" }))
    await delay(120)
    response.write(chunk({ content: "第二段" }))
    await delay(120)
    response.end(
      chunk({}, "stop", {
        prompt_tokens: 50,
        completion_tokens: 10,
        total_tokens: 60,
      }) + "data: [DONE]\n\n"
    )
  })
  const first = await app.send("original", "回答两段文字")
  assert.equal(first.inputAccepted, true)
  let base = first,
    updates = 0
  while (base.phase === "running") {
    const frame = await app.call("conversationFollow", {
      epoch: base.epoch,
      afterVersion: base.version,
    })
    if (frame.kind === "update") {
      assert.equal(frame.baseVersion, base.version)
      updates++
      assert.ok(frame.upserts.length <= frame.order.length)
      const messages = new Map(base.messages.map((item) => [item.id, item]))
      frame.upserts.forEach((item) => messages.set(item.id, item))
      base = {
        ...frame.metadata,
        messages: frame.order.map((id) => messages.get(id)),
      }
    } else if (frame.snapshot) base = frame.snapshot
  }
  assert.ok(updates > 0)
  assert.equal(base.messages.at(-1).text, "第一段第二段")
  assert.equal(base.statistics.output, 10)
  assert.ok(base.statistics.modelDurationMs > 0)
  assert.ok(base.statistics.tokensPerSecond > 0)
  const controller = new AbortController()
  const waiting = app.call(
    "conversationFollow",
    { epoch: base.epoch, afterVersion: base.version },
    controller.signal
  )
  controller.abort()
  await assert.rejects(waiting)
  assert.equal((await app.read()).phase, "completed")
  const frame = await app.call("conversationFollow", {
    epoch: "previous-host",
    afterVersion: base.version,
  })
  assert.equal(frame.kind, "snapshot")
  app.service.conversations.active.get("session").session.dispose()
  app.service.conversations.active.delete("session")
  const restored = await app.read()
  assert.equal(restored.statistics.restored, true)
  assert.equal(restored.statistics.output, 10)
})
test("只读阻止真实Pi写工具，工作区模式允许真实写入；命令扩展提示独立于用户消息", async (t) => {
  const app = await fixture(t, async (body, response) => {
    const lastUser = body.messages.findLastIndex((item) => item.role === "user")
    const result = body.messages
      .slice(lastUser + 1)
      .findLast((item) => item.role === "tool")
    if (result)
      response.end(
        chunk({ role: "assistant", content: "工具已结束" }) +
          chunk({}, "stop") +
          "data: [DONE]\n\n"
      )
    else
      response.end(
        chunk({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "write-test",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  path: "result.txt",
                  content: "允许后写入",
                }),
              },
            },
          ],
        }) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n"
      )
  })
  await app.call("conversationPermissionSet", {
    mode: "read-only",
    revision: 0,
  })
  await app.send("read-only-input", "写入文件")
  let snapshot = await app.settled()
  await assert.rejects(readFile(join(app.cwd, "result.txt")), {
    code: "ENOENT",
  })
  assert.match(
    snapshot.messages
      .flatMap((item) => item.tools || [])
      .map((item) => item.result)
      .join(""),
    /只读/
  )
  await app.call("conversationPermissionSet", {
    mode: "workspace",
    revision: 1,
  })
  await app.send("workspace-input", "现在写入工作区文件")
  snapshot = await app.settled()
  assert.equal(
    await readFile(join(app.cwd, "result.txt"), "utf8"),
    "允许后写入"
  )
  // New user request: discard provider's earlier tool message only for this test response.
  app.requests.length = 0
  const oldRespond = app.service.conversations.active.get("session").session
  assert.ok(oldRespond)
  const before = snapshot.messages.length
  const started = await app.call("conversationCommandRun", {
    commandRequestId: "ask-command",
    name: "ask-name",
    arguments: "",
  })
  assert.equal(started.status, "started")
  snapshot = await until(app.read, (value) => value.approvals?.length)
  const prompt = snapshot.approvals[0]
  assert.equal(prompt.kind, "input")
  await app.call("conversationApprovalReply", {
    approvalId: prompt.id,
    runId: prompt.runId,
    value: "Moon",
  })
  const receipt = await until(
    () =>
      app.call("conversationCommandRead", { commandRequestId: "ask-command" }),
    (value) => value.status === "completed"
  )
  assert.equal(receipt.name, "ask-name")
  snapshot = await app.read()
  assert.equal(snapshot.messages.length, before)
  assert.match(snapshot.extensionNotifications.at(-1).message, /Moon/)
  const repeated = await app.call("conversationCommandRun", {
    commandRequestId: "ask-command",
    name: "ask-name",
    arguments: "",
  })
  assert.equal(repeated.status, "completed")
  assert.equal((await app.read()).approvals.length, 0)
})
test("完全访问通过公开权限配置允许真实Pi写到cwd外，且无需审批并可冷恢复", async (t) => {
  let outsidePath
  const content = "FULL_ACCESS_OUTSIDE_CWD"
  const text = "写入隔离夹具根目录中的文件"
  const app = await fixture(t, async (body, response) => {
    const lastUser = body.messages.findLastIndex((item) => item.role === "user")
    const result = body.messages
      .slice(lastUser + 1)
      .findLast((item) => item.role === "tool")
    response.end(
      result
        ? chunk({ role: "assistant", content: "工具已结束" }) +
            chunk({}, "stop") +
            "data: [DONE]\n\n"
        : chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "full-access-outside-write",
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ path: outsidePath, content }),
                },
              },
            ],
          }) +
            chunk({}, "tool_calls") +
            "data: [DONE]\n\n"
    )
  })
  outsidePath = join(app.root, "full-access-outside.txt")
  assert.ok(resolve(outsidePath).startsWith(resolve(app.root) + sep))
  assert.equal(resolve(outsidePath).startsWith(resolve(app.cwd) + sep), false)
  await assert.rejects(readFile(outsidePath), { code: "ENOENT" })
  const permission = await app.call("conversationPermissionSet", {
    mode: "full-access",
    revision: 0,
  })
  assert.equal(permission.mode, "full-access")
  assert.equal(permission.revision, 1)
  const accepted = await app.send("full-access-input", text)
  assert.equal(accepted.inputAccepted, true)
  assert.equal(accepted.approvals.length, 0)
  const snapshot = await until(
    async () => {
      const current = await app.read()
      assert.equal(current.approvals.length, 0)
      return current
    },
    (current) => !["running", "stopping"].includes(current.phase)
  )
  assert.equal(snapshot.phase, "completed")
  assert.equal(await readFile(outsidePath, "utf8"), content)
  assert.equal(
    snapshot.messages.filter((item) => item.role === "user").length,
    1
  )
  assert.equal(
    snapshot.messages.find((item) => item.role === "user").text,
    text
  )
  const state = app.service.conversations.active.get("session")
  const toolResults = state.manager
    .getBranch()
    .filter(
      (entry) => entry.type === "message" && entry.message.role === "toolResult"
    )
  assert.equal(toolResults.length, 1)
  assert.equal(toolResults[0].message.toolName, "write")
  assert.equal(toolResults[0].message.isError, false)
  state.session.dispose()
  app.service.conversations.active.delete("session")
  const restored = await app.read()
  assert.equal(restored.permission.mode, "full-access")
  assert.equal(restored.approvals.length, 0)
  assert.equal(
    restored.messages.filter((item) => item.role === "user").length,
    1
  )
})
test("运行中补充与排队分别进入Pi steer/followUp，输入只记录一次", async (t) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const app = await fixture(t, async (_body, response, count) => {
    if (count === 1) {
      response.write(chunk({ role: "assistant", content: "开始" }))
      await gate
    }
    response.end(
      chunk({ role: "assistant", content: `回复${count}` }) +
        chunk({}, "stop") +
        "data: [DONE]\n\n"
    )
  })
  t.after(() => release())
  await app.send("initial", "原任务")
  await until(
    () => app.requests,
    (items) => items.length === 1
  )
  const steer = await app.send("steering", "补充要求", "steer")
  assert.equal(
    steer.queue.items.find((item) => item.clientRequestId === "steering")
      .delivery,
    "steer"
  )
  const session = app.service.conversations.active.get("session").session
  await until(
    () => session.getSteeringMessages(),
    (items) => items.length === 1
  )
  const follow = await app.send("following", "下一项任务", "followUp")
  assert.equal(
    follow.queue.items.find((item) => item.clientRequestId === "following")
      .delivery,
    "followUp"
  )
  release()
  const snapshot = await until(
    app.read,
    (value) => value.phase === "completed" && value.queue.items.length === 0
  )
  for (const text of ["原任务", "补充要求", "下一项任务"])
    assert.equal(
      snapshot.messages.filter(
        (item) => item.role === "user" && item.text === text
      ).length,
      1
    )
  assert.equal(app.requests.length, 3)
})
test("权限规范化路径、外部访问审批、停止取消、精确身份与答案幂等", async (t) => {
  const { root, cwd } = await workspace(t)
  const owner = {
    active: new Map(),
    closed: false,
    touch(state) {
      state.version++
    },
    sessions: {
      identity(value) {
        assert.match(value, /^[a-zA-Z0-9_-]+$/)
      },
      exclusive: (_id, action) => action(),
    },
  }
  const permissions = new ConversationPermissions(join(root, "data"), owner)
  const state = {
    record: { id: "session", runId: "run", cwd },
    version: 0,
    permission: { mode: "workspace" },
    entry: { busy: false },
  }
  owner.active.set("session", state)
  let handler
  permissions.factory(state)({
    on: (_type, callback) => {
      handler = callback
    },
  })
  assert.equal(
    await handler({ toolName: "write", input: { path: "inside/new.txt" } }, {}),
    undefined
  )
  const outside = handler(
    {
      toolName: "write",
      toolCallId: "outside-call",
      input: { path: "../outside.txt" },
    },
    {}
  )
  await until(
    () => permissions.pendingFor("session"),
    (items) => items.length
  )
  const approval = permissions.pendingFor("session")[0]
  assert.equal(approval.toolCallId, "outside-call")
  assert.equal(approval.runId, "run")
  assert.throws(() =>
    permissions.reply("session", approval.id, "wrong", "allow")
  )
  permissions.reply("session", approval.id, "run", "deny")
  assert.equal((await outside).block, true)
  permissions.reply("session", approval.id, "run", "deny")
  assert.throws(() => permissions.reply("session", approval.id, "run", "allow"))
  const command = handler(
    { toolName: "powershell", input: { command: "Write-Output test" } },
    {}
  )
  await until(
    () => permissions.pendingFor("session"),
    (items) => items.length
  )
  permissions.cancel(state)
  assert.equal((await command).block, true)
  assert.equal(permissions.pendingFor("session").length, 0)
  state.permission.mode = "read-only"
  assert.equal(
    (await handler({ toolName: "write", input: { path: "inside.txt" } }, {}))
      .block,
    true
  )
  assert.equal(
    (await handler({ toolName: "read", input: { path: "../outside.txt" } }, {}))
      .block,
    true
  )
  state.entry.busy = true
  await assert.rejects(permissions.set("session", "full-access", 0), /结束/)
})
test("增量缓存失效回到快照，消息删除与重排不重复拼接", async () => {
  const state = { version: 1 },
    owner = {
      epoch: "host",
      active: new Map([["session", state]]),
      ensureOpen() {},
      prepareMedia() {},
      snapshot: (state) =>
        live.remember(state, {
          version: state.version,
          epoch: "host",
          messages: state.messages,
        }),
    }
  const live = new ConversationLive(owner)
  state.messages = [
    { id: "a", text: "初始" },
    { id: "b", text: "旧分支" },
  ]
  owner.snapshot(state)
  state.version = 2
  state.messages = [{ id: "a", text: "更新" }]
  const frame = await live.follow("session", "host", 1)
  assert.deepEqual(frame.order, ["a"])
  assert.deepEqual(frame.upserts, [{ id: "a", text: "更新" }])
  for (let index = 3; index < 40; index++) {
    state.version = index
    owner.snapshot(state)
  }
  assert.equal((await live.follow("session", "host", 1)).kind, "snapshot")
})
test("模型速度剔除工具等待，不将缺费率当免费", () => {
  const state = {
    runMetrics: {
      startedAt: performance.now() - 10000,
      modelDurationMs: 1000,
      outputTokens: 10,
      hasUsage: true,
    },
    manager: {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            content: [],
            usage: {
              input: 30,
              output: 10,
              cacheRead: 100,
              cacheWrite: 20,
              cost: { total: 0 },
            },
          },
        },
      ],
    },
  }
  const stats = conversationStatistics(state)
  assert.equal(stats.tokensPerSecond, 10)
  assert.ok(stats.durationMs >= 10000)
  assert.equal(stats.totalTokens, 160)
  assert.equal(stats.cost, undefined)
  runStatisticsEvent(state, { type: "agent_end" })
  assert.equal(conversationStatistics(state).outputTokens, 10)
})
