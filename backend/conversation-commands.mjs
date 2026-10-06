import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises"
import { join } from "node:path"
import { publicFailure } from "./operation-issue.mjs"
const check = (value, message) => {
  if (!value) throw new Error(message)
}
export class ConversationCommands {
  constructor(directory, conversations) {
    this.directory = join(directory, "conversation-commands")
    this.conversations = conversations
    this.active = new Map()
  }
  catalog(sessionId) {
    const owner = this.conversations,
      state = owner.active.get(sessionId)
    const runner =
      state?.session?.extensionRunner ||
      owner.sessions.active.get(sessionId)?.session?.extensionRunner
    const available = !!state && !state.entry.busy && !state.controlBusy
    const reason = !state ? "发送首条消息后可执行" : "当前工作结束后可执行"
    return [
      {
        name: "compact",
        description: "打开上下文压缩面板",
        kind: "host",
        available,
        ...(!available ? { reason } : {}),
      },
      ...(runner?.getRegisteredCommands() || [])
        .filter(
          (command) =>
            command.invocationName !== "compact" &&
            !command.invocationName.startsWith("skill:")
        )
        .map((command) => ({
          name: command.invocationName,
          description: command.description || "执行扩展命令",
          kind: "extension",
          available,
          ...(!available ? { reason } : {}),
        })),
    ]
  }
  path(sessionId, id) {
    this.conversations.sessions.identity(sessionId)
    this.conversations.sessions.identity(id)
    return join(this.directory, sessionId, `${id}.json`)
  }
  async saved(sessionId, id) {
    try {
      return JSON.parse(await readFile(this.path(sessionId, id), "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return undefined
      throw new Error("命令回执无法读取，原文件保留。", { cause: error })
    }
  }
  async save(value) {
    const target = this.path(value.sessionId, value.id),
      temporary = `${target}.tmp`
    await mkdir(join(this.directory, value.sessionId), { recursive: true })
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error
      })
    }
  }
  public(value) {
    const { arguments: _arguments, ...receipt } = value
    return receipt
  }
  async read(sessionId, id, signal) {
    signal?.throwIfAborted()
    const receipt = await this.saved(sessionId, id)
    if (!receipt) return { id, sessionId, name: "", status: "unknown" }
    if (receipt.status === "started" && !this.active.has(`${sessionId}:${id}`))
      return { ...this.public(receipt), status: "unknown" }
    return this.public(receipt)
  }
  async run(sessionId, id, name, args, signal) {
    const owner = this.conversations
    return owner.sessions.exclusive(sessionId, async () => {
      owner.ensureOpen()
      const saved = await this.saved(sessionId, id)
      if (saved) {
        check(
          saved.name === name && saved.arguments === args,
          "命令ID已用于不同内容。"
        )
        return this.read(sessionId, id, signal)
      }
      const record = await owner.store.get(sessionId, signal)
      check(record, "发送首条消息后可执行扩展命令。")
      const state = await owner.restore(record, undefined, signal)
      check(
        !state.entry.busy && !state.controlBusy,
        "当前工作结束后可执行命令。"
      )
      if (!state.session) {
        const slash = record.modelId.indexOf("/")
        await owner.activate(
          state,
          await owner.selection(
            record.modelId.slice(0, slash),
            record.modelId.slice(slash + 1),
            record.thinking || "off",
            signal
          ),
          signal
        )
      }
      const runner = state.session.extensionRunner,
        command = runner.getCommand(name)
      check(
        command && name !== "compact" && !name.startsWith("skill:"),
        "此命令未注册，请从候选中选择。"
      )
      state.permission = await owner.permissions.read(sessionId, signal)
      const receipt = {
        id,
        sessionId,
        name,
        arguments: args,
        status: "started",
      }
      signal?.throwIfAborted()
      await this.save(receipt) // A lost reply never repeats an extension side effect.
      const previousPhase = state.phase
      state.command = this.public(receipt)
      state.commandRunning = true
      state.entry.busy = true
      state.stopRequested = false
      state.phase = "running"
      owner.touch(state)
      const context = runner.createCommandContext()
      const unsupported = () => {
        throw new Error("请使用 Moon 的新建会话、分支和压缩入口。")
      }
      const execute = async () => {
        try {
          await command.handler(args, {
            ...context,
            newSession: unsupported,
            switchSession: unsupported,
            fork: unsupported,
            navigateTree: unsupported,
          })
          await context.waitForIdle()
          receipt.status = "completed"
        } catch (error) {
          receipt.status = "failed"
          receipt.issue = publicFailure(error, "conversationCommandRun").issue
        }
        try {
          await this.save(receipt)
        } catch {
          receipt.status = "unknown"
        }
        state.command = this.public(receipt)
        state.commandRunning = false
        state.entry.busy = false
        state.phase = state.stopRequested ? "interrupted" : previousPhase
        owner.permissions.cancel(state)
        owner.touch(state)
        this.active.delete(`${sessionId}:${id}`)
      }
      this.active.set(`${sessionId}:${id}`, execute())
      return this.public(receipt)
    })
  }
  async close() {
    await Promise.allSettled(this.active.values())
  }
}
