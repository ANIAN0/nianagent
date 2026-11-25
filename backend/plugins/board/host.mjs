import { join } from "node:path"
import { board } from "@vercel/board"
import { local } from "@vercel/board/backend-local"
import { redactSensitive } from "../../redact.mjs"
import {
  boardOperations,
  DESTRUCTIVE_TOOLS,
  int,
  object as contractObject,
  READ_ONLY_TOOLS,
  str,
} from "./contract.mjs"

const MAX_TEXT_CHARS = 128 * 1024

const object = (properties = {}, required = []) =>
  contractObject(properties, required)

export { READ_ONLY_TOOLS }

function normalizeName(raw, fallback) {
  const value = String(raw || "").trim()
  return value || fallback
}

function validateBoardName(raw) {
  const name = normalizeName(raw, "moon")
  if (
    name.length > 64 ||
    name === "." ||
    name === ".." ||
    /[\\/\0<>:"|?*]/.test(name) ||
    name.includes("..")
  ) {
    throw new Error(
      "看板名称包含非法字符或路径片段，请使用普通名称（如 moon）。"
    )
  }
  return name
}

function summarizeMessage(item) {
  if (!item || typeof item !== "object") return null
  return {
    id: String(item.id ?? ""),
    channel: String(item.channel ?? ""),
    threadId: item.re ? String(item.re) : null,
    text: String(item.text ?? ""),
    by: item.author?.handle
      ? String(item.author.handle)
      : item.by?.handle
        ? String(item.by.handle)
        : item.by?.actor
          ? String(item.by.actor)
          : item.by?.name
            ? String(item.by.name)
            : typeof item.by === "string"
              ? item.by
              : null,
    createdAt: item.at
      ? String(item.at)
      : item.createdAt
        ? String(item.createdAt)
        : null,
  }
}

function summarizeTask(item) {
  if (!item || typeof item !== "object") return null
  // SDK returns ThreadSummaryView ({ message, replies, last }) from tasks.list,
  // ClaimedTask ({ task: MessageView, ... }) from tasks.claim,
  // and MessageView directly from tasks.create / held().complete|fail|release.
  const msg =
    item.message && typeof item.message === "object"
      ? item.message
      : item.task && typeof item.task === "object" && "id" in item.task
        ? item.task
        : item
  const meta = msg.task && typeof msg.task === "object" ? msg.task : null
  return {
    id: String(msg.id ?? ""),
    channel: String(msg.channel ?? ""),
    text: String(msg.text ?? ""),
    status: String(meta?.state ?? msg.state ?? msg.status ?? "ready"),
    owner: meta?.claim?.actor
      ? String(meta.claim.actor)
      : meta?.claim?.by?.handle
        ? String(meta.claim.by.handle)
        : meta?.for
          ? String(meta.for)
          : msg.author?.handle
            ? String(msg.author.handle)
            : msg.by?.handle
              ? String(msg.by.handle)
              : null,
    createdAt: msg.at
      ? String(msg.at)
      : msg.createdAt
        ? String(msg.createdAt)
        : null,
  }
}

function formatToolResult(payload) {
  const raw = JSON.stringify(payload, null, 2)
  const sanitized = redactSensitive(raw)
  const truncated = sanitized.length > MAX_TEXT_CHARS
  const text = truncated
    ? `${sanitized.slice(0, MAX_TEXT_CHARS)}\n\n[结果超过 128 KiB 已截断，请缩小分页或过滤条件]`
    : sanitized
  let structured
  if (!truncated) {
    try {
      const parsed = JSON.parse(sanitized)
      structured =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : { value: parsed }
    } catch {
      structured = undefined
    }
  }
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  }
}

function formatToolError(error) {
  const message = redactSensitive(
    error instanceof Error ? error.message : String(error || "Board 调用失败。")
  )
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  }
}

export async function activate(host) {
  const storageDir = join(host.directory, "boards")
  const config = {
    boardName: validateBoardName(host.configuration?.boardName),
    defaultChannel: normalizeName(
      host.configuration?.defaultChannel,
      "general"
    ),
    defaultActor: normalizeName(host.configuration?.defaultActor, "moon"),
    readOnly: Boolean(host.configuration?.readOnly),
  }

  const backend = local({ dir: storageDir })
  const rootHandle = board({ backend, name: config.boardName })

  let closed = false
  let frozen = false
  const lifecycle = new AbortController()

  const actorHandle = (actor) => {
    const name = normalizeName(actor, config.defaultActor)
    return rootHandle.as(name)
  }

  const assertActive = (signal) => {
    signal?.throwIfAborted()
    if (closed) throw new Error("Board 插件已停用。")
    if (frozen) throw new Error("Board 插件正在更新配置或停用。")
  }

  const assertWritable = () => {
    if (config.readOnly)
      throw new Error("Board 当前处于只读模式，已拒绝写入操作。")
  }

  const listChannelsData = async () => {
    const result = await rootHandle.channels()
    const items = Array.isArray(result)
      ? result
      : Array.isArray(result?.channels)
        ? result.channels
        : []
    return items.map((ch) => ({
      name:
        typeof ch === "string"
          ? ch
          : String(ch?.path ?? ch?.name ?? ch?.channel ?? ""),
      messageCount:
        typeof ch?.messages === "number"
          ? ch.messages
          : typeof ch?.count === "number"
            ? ch.count
            : typeof ch?.messageCount === "number"
              ? ch.messageCount
              : null,
    }))
  }

  const readChannelData = async (channel, limit = 30) => {
    const targetChannel = normalizeName(channel, config.defaultChannel)
    const ch = rootHandle.channel(targetChannel)
    const res =
      typeof ch?.messages === "function"
        ? await ch.messages({ limit })
        : await ch
    const raw = Array.isArray(res)
      ? res
      : Array.isArray(res?.messages)
        ? res.messages
        : []
    return {
      channel: targetChannel,
      messages: raw.map(summarizeMessage).filter(Boolean),
    }
  }

  const listTasksData = async ({ channel, status, limit = 30 } = {}) => {
    const state = status ? String(status).trim() : ""
    const query = {
      ...(channel ? { channel: String(channel).trim() } : {}),
      ...(state ? { state } : {}),
      limit,
    }
    const res = await rootHandle.tasks.list(query)
    const raw = Array.isArray(res)
      ? res
      : Array.isArray(res?.tasks)
        ? res.tasks
        : []
    return {
      tasks: raw.map(summarizeTask).filter(Boolean),
    }
  }

  const postMessageData = async (input, action = "post_message") => {
    assertWritable()
    const text = String(input?.text || "").trim()
    if (!text) throw new Error("消息正文不能为空。")
    const channel = normalizeName(input?.channel, config.defaultChannel)
    const handle = actorHandle(input?.actor)
    const created = await handle.post(channel, {
      text,
      ...(input?.labels ? { labels: input.labels } : {}),
    })
    host.emit?.("board-changed", { action, channel })
    return { message: summarizeMessage(created) }
  }

  const createTaskData = async (input, action = "create_task") => {
    assertWritable()
    const text = String(input?.text || "").trim()
    if (!text) throw new Error("任务描述不能为空。")
    const channel = normalizeName(input?.channel, config.defaultChannel)
    const handle = actorHandle(input?.actor)
    const created = await handle.tasks.create(channel, {
      text,
      ...(input?.labels ? { labels: input.labels } : {}),
    })
    host.emit?.("board-changed", { action, channel })
    return { task: summarizeTask(created) }
  }

  const toolDefinitions = [
    {
      name: "list_channels",
      description: "列出本机 Board 消息板中的所有频道。",
      inputSchema: object(),
      run: async () => ({ channels: await listChannelsData() }),
    },
    {
      name: "read_channel",
      description: "读取指定频道中的最近消息。",
      inputSchema: object({
        channel: str("频道名称，默认使用插件配置的 defaultChannel。"),
        limit: int("最多返回条数（1-100），默认 30。", 1, 100),
      }),
      run: async (input) => readChannelData(input?.channel, input?.limit ?? 30),
    },
    {
      name: "read_thread",
      description: "按消息/线程 ID 读取完整线程及所有回复。",
      inputSchema: object(
        {
          threadId: str("线程或根消息 ID", { minLength: 1 }),
          limit: int("最多返回回复条数（1-100），默认 50。", 1, 100),
        },
        ["threadId"]
      ),
      run: async (input) => {
        const res = await rootHandle.thread(String(input.threadId), {
          limit: input?.limit ?? 50,
        })
        const rawReplies = Array.isArray(res?.replies)
          ? res.replies
          : Array.isArray(res?.messages)
            ? res.messages
            : []
        return {
          root: summarizeMessage(res?.message ?? res?.root ?? res),
          messages: rawReplies.map(summarizeMessage).filter(Boolean),
        }
      },
    },
    {
      name: "list_tasks",
      description: "列出本机 Board 中的异步协作任务。",
      inputSchema: object({
        channel: str("可选，按频道过滤。"),
        status: str(
          "可选，按状态过滤（ready/claimed/completed/failed/blocked）。"
        ),
        limit: int("最多返回条数（1-100），默认 30。", 1, 100),
      }),
      run: async (input) =>
        listTasksData({
          channel: input?.channel,
          status: input?.status,
          limit: input?.limit ?? 30,
        }),
    },
    {
      name: "post_message",
      description: "在指定频道发布一条新消息。",
      inputSchema: object(
        {
          channel: str("频道名称，默认使用 defaultChannel。"),
          text: str("消息正文", { minLength: 1, maxLength: 32768 }),
          actor: str("可选，发帖身份标识（例如 claude、codex）。"),
          labels: {
            type: "object",
            description: "可选标签键值对。",
            additionalProperties: { type: "string" },
          },
        },
        ["text"]
      ),
      run: (input) => postMessageData(input, "post_message"),
    },
    {
      name: "reply_thread",
      description: "在已有线程下发表回复。",
      inputSchema: object(
        {
          threadId: str("线程根消息 ID", { minLength: 1 }),
          text: str("回复正文", { minLength: 1, maxLength: 32768 }),
          actor: str("可选，回复身份标识。"),
        },
        ["threadId", "text"]
      ),
      run: async (input) => {
        assertWritable()
        const handle = actorHandle(input?.actor)
        const created = await handle.reply(
          String(input.threadId),
          String(input.text)
        )
        host.emit?.("board-changed", {
          action: "reply_thread",
          threadId: String(input.threadId),
        })
        return { message: summarizeMessage(created) }
      },
    },
    {
      name: "create_task",
      description: "在指定频道创建一条可被 Agent 租约认领的异步任务。",
      inputSchema: object(
        {
          channel: str("频道名称，默认使用 defaultChannel。"),
          text: str("任务描述", { minLength: 1, maxLength: 32768 }),
          actor: str("可选，创建者身份标识。"),
          labels: {
            type: "object",
            description: "可选标签键值对。",
            additionalProperties: { type: "string" },
          },
        },
        ["text"]
      ),
      run: (input) => createTaskData(input, "create_task"),
    },
    {
      name: "claim_task",
      description:
        "认领指定任务 ID 或频道中最老的就绪任务，返回任务详情与租约凭据（epoch/token）。",
      inputSchema: object({
        taskId: str("可选，指定认领的任务 ID；不传则按 channel 认领就绪任务。"),
        channel: str("按频道认领时使用的频道名称，默认 defaultChannel。"),
        leaseSeconds: int("租约时长（秒），可选。", 5, 3600),
        actor: str("可选，认领者身份标识。"),
      }),
      run: async (input) => {
        assertWritable()
        const handle = actorHandle(input?.actor)
        const lease = input?.leaseSeconds
        const claimed = input?.taskId
          ? await handle.tasks.claim(
              String(input.taskId),
              lease ? { lease } : undefined
            )
          : await handle.tasks.claim({
              channel: normalizeName(input?.channel, config.defaultChannel),
              ...(lease ? { lease } : {}),
            })
        if (!claimed) return { claimed: false, task: null, lease: null }
        host.emit?.("board-changed", {
          action: "claim_task",
          taskId: claimed.task.id,
        })
        return {
          claimed: true,
          task: summarizeTask(claimed.task),
          lease: {
            id: claimed.task.id,
            epoch: claimed.epoch,
            token: claimed.token,
            until: claimed.until,
          },
        }
      },
    },
    {
      name: "complete_task",
      description: "凭租约凭据（id/epoch/token）将已认领任务标记为完成。",
      inputSchema: object(
        {
          id: str("任务 ID", { minLength: 1 }),
          epoch: int("租约 epoch", 0),
          token: str("租约 token", { minLength: 1 }),
          result: str("可选，完成结果说明。"),
          actor: str("可选，执行者身份标识。"),
        },
        ["id", "epoch", "token"]
      ),
      run: async (input) => {
        assertWritable()
        const handle = actorHandle(input?.actor)
        const res = await handle.tasks
          .held(String(input.id), {
            epoch: Number(input.epoch),
            token: String(input.token),
          })
          .complete(input?.result ? String(input.result) : undefined)
        host.emit?.("board-changed", {
          action: "complete_task",
          taskId: String(input.id),
        })
        return { task: summarizeTask(res) }
      },
    },
    {
      name: "fail_task",
      description: "凭租约凭据（id/epoch/token）将已认领任务标记为失败。",
      inputSchema: object(
        {
          id: str("任务 ID", { minLength: 1 }),
          epoch: int("租约 epoch", 0),
          token: str("租约 token", { minLength: 1 }),
          reason: str("失败原因", { minLength: 1 }),
          actor: str("可选，执行者身份标识。"),
        },
        ["id", "epoch", "token", "reason"]
      ),
      run: async (input) => {
        assertWritable()
        const handle = actorHandle(input?.actor)
        const res = await handle.tasks
          .held(String(input.id), {
            epoch: Number(input.epoch),
            token: String(input.token),
          })
          .fail(String(input.reason))
        host.emit?.("board-changed", {
          action: "fail_task",
          taskId: String(input.id),
        })
        return { task: summarizeTask(res) }
      },
    },
    {
      name: "release_task",
      description:
        "凭租约凭据（id/epoch/token）提前释放任务，使其回到就绪队列。",
      inputSchema: object(
        {
          id: str("任务 ID", { minLength: 1 }),
          epoch: int("租约 epoch", 0),
          token: str("租约 token", { minLength: 1 }),
          actor: str("可选，执行者身份标识。"),
        },
        ["id", "epoch", "token"]
      ),
      run: async (input) => {
        assertWritable()
        const handle = actorHandle(input?.actor)
        const res = await handle.tasks
          .held(String(input.id), {
            epoch: Number(input.epoch),
            token: String(input.token),
          })
          .release()
        host.emit?.("board-changed", {
          action: "release_task",
          taskId: String(input.id),
        })
        return { task: summarizeTask(res) }
      },
    },
  ]

  const buildToolsSummary = () =>
    toolDefinitions.map((tool) => {
      const readOnlyTool = READ_ONLY_TOOLS.has(tool.name)
      return {
        name: tool.name,
        description: tool.description,
        effect: readOnlyTool ? "read" : "write",
        destructive: DESTRUCTIVE_TOOLS.has(tool.name),
        enabled: readOnlyTool || !config.readOnly,
      }
    })

  const buildStatus = async () => {
    const [channels, tasksRes] = await Promise.all([
      listChannelsData(),
      listTasksData({ limit: 100 }),
    ])
    return {
      boardName: config.boardName,
      defaultChannel: config.defaultChannel,
      defaultActor: config.defaultActor,
      storageDir,
      readOnly: config.readOnly,
      channelCount: channels.length,
      taskCount: tasksRes.tasks.length,
      tools: buildToolsSummary(),
    }
  }

  const sharedTools = toolDefinitions.map((tool) => {
    const readOnly = READ_ONLY_TOOLS.has(tool.name)
    const destructive = DESTRUCTIVE_TOOLS.has(tool.name)
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      shareable: true,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        idempotentHint: readOnly,
        openWorldHint: false,
      },
      async execute(input, _context, signal) {
        try {
          const active = AbortSignal.any(
            signal ? [signal, lifecycle.signal] : [lifecycle.signal]
          )
          assertActive(active)
          const result = await tool.run(input || {})
          return formatToolResult(result)
        } catch (error) {
          return formatToolError(error)
        }
      },
    }
  })

  const operation = (name, handler) => ({
    ...boardOperations[name],
    async execute(input, context) {
      const signal = context?.signal
      assertActive(signal)
      return { value: await handler(input || {}) }
    },
  })

  return {
    sharedTools,
    operations: {
      status: operation("status", buildStatus),
      listChannels: operation("listChannels", async () => ({
        channels: await listChannelsData(),
      })),
      readChannel: operation("readChannel", async (input) =>
        readChannelData(input?.channel, input?.limit ?? 30)
      ),
      postMessage: operation("postMessage", (input) =>
        postMessageData(input, "postMessage")
      ),
      listTasks: operation("listTasks", async (input) =>
        listTasksData({
          channel: input?.channel,
          status: input?.status,
          limit: input?.limit ?? 30,
        })
      ),
      createTask: operation("createTask", (input) =>
        createTaskData(input, "createTask")
      ),
    },
    status() {
      return config.readOnly ? "read-only" : "ready"
    },
    quiesce() {
      frozen = true
    },
    resume() {
      frozen = false
    },
    async close() {
      closed = true
      frozen = true
      lifecycle.abort()
      await backend.close()
    },
  }
}
