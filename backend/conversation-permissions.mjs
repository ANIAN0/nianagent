import {
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  unlink,
} from "node:fs/promises"
import { resolve, relative, isAbsolute, dirname, join, sep } from "node:path"
import { homedir } from "node:os"
import { randomUUID } from "node:crypto"
import { assertSchema, schemas } from "./schema.mjs"
const check = (condition, message) => {
  if (!condition) throw new Error(message)
}
const within = (root, target) => {
  const path = relative(root, target)
  return (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
  )
}
async function canonical(target) {
  try {
    return await realpath(target)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    const parent = dirname(target)
    if (parent === target) throw error
    return join(
      await canonical(parent),
      target.slice(parent.length).replace(/^[/\\]/, "")
    )
  }
}
export class ConversationPermissions {
  constructor(directory, conversations) {
    this.directory = join(directory, "conversation-permissions")
    this.conversations = conversations
    this.pending = new Map()
    this.answers = new Map()
  }
  async read(sessionId, signal) {
    this.conversations.sessions.identity(sessionId)
    signal?.throwIfAborted()
    let record
    try {
      record = JSON.parse(
        await readFile(join(this.directory, `${sessionId}.json`), "utf8")
      )
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("会话权限无法读取，原文件保留。", { cause: error })
      record = { sessionId, mode: "workspace", revision: 0 }
    }
    assertSchema(schemas.ConversationPermission, record, "会话权限")
    check(record.sessionId === sessionId, "权限记录身份不一致。")
    signal?.throwIfAborted()
    return record
  }
  async set(sessionId, mode, revision, signal) {
    return this.conversations.sessions.exclusive(sessionId, async () => {
      const state = this.conversations.active.get(sessionId)
      check(
        !state?.entry.busy &&
          !state?.controlBusy &&
          !this.pendingFor(sessionId).length,
        "当前工作或审批结束后才能修改权限。"
      )
      const previous = await this.read(sessionId, signal)
      if (previous.mode === mode) return previous
      check(previous.revision === revision, "权限配置已变化，请重新读取。")
      const next = { sessionId, mode, revision: revision + 1 }
      assertSchema(schemas.ConversationPermission, next)
      await mkdir(this.directory, { recursive: true })
      const target = join(this.directory, `${sessionId}.json`),
        temporary = `${target}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
        signal?.throwIfAborted()
        await rename(temporary, target)
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error
        })
      }
      if (state) {
        state.permission = next
        this.conversations.touch(state)
      }
      return next
    })
  }
  pendingFor(sessionId) {
    return [...this.pending.values()]
      .filter((item) => item.sessionId === sessionId)
      .map((item) => item.public)
  }
  ask(state, request, { signal, timeout = 300000 } = {}) {
    const sessionId = state.record.id,
      id = randomUUID()
    const publicRequest = {
      id,
      runId: state.record.runId || "",
      ...request,
      expiresAt: new Date(Date.now() + timeout).toISOString(),
    }
    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        this.pending.delete(id)
        resolve(value)
        this.conversations.touch(state)
      }
      const abort = () => finish("cancel")
      const timer = setTimeout(abort, timeout)
      this.pending.set(id, { sessionId, state, public: publicRequest, finish })
      signal?.addEventListener("abort", abort, { once: true })
      this.conversations.touch(state)
      if (signal?.aborted || state.stopRequested || this.conversations.closed)
        abort()
    })
  }
  reply(sessionId, approvalId, runId, value) {
    const item = this.pending.get(approvalId),
      key = JSON.stringify([sessionId, approvalId, runId])
    if (!item) {
      check(
        this.answers.get(key) === value,
        "审批已结束或已过期，请读取当前状态。"
      )
      return null
    }
    check(
      item.sessionId === sessionId &&
        item.public.runId === runId &&
        !item.state.stopRequested,
      "审批不属于当前运行。"
    )
    const kind = item.public.kind
    check(
      value === "cancel" ||
        kind === "input" ||
        (kind === "select"
          ? item.public.options.includes(value)
          : ["allow", "deny"].includes(value)),
      "审批回答无效。"
    )
    this.answers.set(key, value)
    while (this.answers.size > 256)
      this.answers.delete(this.answers.keys().next().value)
    item.finish(value)
    return null
  }
  cancel(state) {
    for (const item of [...this.pending.values()])
      if (item.state === state) item.finish("cancel")
  }
  factory(state) {
    return (pi) =>
      pi.on("tool_call", async (event, ctx) => {
        const mode = state.permission?.mode || "workspace",
          name = event.toolName
        if (mode === "full-access") return
        if (name === "tool_search" || name === "codemode") return // Nested tool calls pass this same SDK hook.
        const fileTool = [
            "read",
            "write",
            "edit",
            "grep",
            "find",
            "ls",
          ].includes(name),
          mutation = ["write", "edit"].includes(name)
        if (mode === "read-only" && (!fileTool || mutation))
          return {
            block: true,
            reason: "只读权限不允许此操作。请等待结束后调整权限。",
          }
        let target
        if (fileTool) {
          const input = event.input.path ?? state.record.cwd
          check(typeof input === "string", "文件路径无效。")
          const expanded =
            input === "~"
              ? homedir()
              : input.startsWith("~/") || input.startsWith("~\\")
                ? join(homedir(), input.slice(2))
                : input
          target = await canonical(resolve(state.record.cwd, expanded))
          if (within(await realpath(state.record.cwd), target)) return
          if (mode === "read-only")
            return { block: true, reason: "只读权限仅允许访问工作区内文件。" }
        }
        const value = await this.ask(
          state,
          {
            kind: "tool",
            title: fileTool
              ? "访问工作区外文件"
              : ["bash", "powershell"].includes(name)
                ? "执行命令"
                : "运行扩展工具",
            toolName: name,
            ...(typeof event.toolCallId === "string" ? { toolCallId: event.toolCallId } : {}),
            input: JSON.stringify(event.input, null, 2),
            message: target
              ? `允许此工具本次访问：${target}`
              : "此操作可访问本机文件与网络。请确认具体内容，允许仅对这一次生效。",
          },
          { signal: ctx.signal }
        )
        if (value !== "allow" || state.stopRequested)
          return { block: true, reason: "用户拒绝或取消了本次操作。" }
      })
  }
  ui(state) {
    const ask = (kind, title, message, options, opts) =>
      this.ask(
        state,
        { kind, title, message, ...(options ? { options } : {}) },
        opts
      )
    const unsupported = () => {
      throw new Error(
        "Moon 不支持终端组件交互，请使用 confirm/select/input/editor。"
      )
    }
    return {
      confirm: async (title, message, opts) =>
        (await ask("confirm", title, message, undefined, opts)) === "allow",
      select: async (title, options, opts) => {
        const answer = await ask("select", title, "请选择一项", options, opts)
        return answer === "cancel" ? undefined : answer
      },
      input: async (title, placeholder, opts) => {
        const answer = await ask(
          "input",
          title,
          placeholder || "请输入",
          undefined,
          opts
        )
        return answer === "cancel" ? undefined : answer
      },
      editor: async (title, prefill) => {
        const answer = await ask("input", title, prefill || "请输入", undefined)
        return answer === "cancel" ? undefined : answer
      },
      notify: (message, type = "info") => {
        state.extensionNotifications ||= []
        state.extensionNotifications.push({
          id: randomUUID(),
          message: String(message).slice(0, 4000),
          severity: type,
        })
        state.extensionNotifications = state.extensionNotifications.slice(-5)
        this.conversations.touch(state)
      },
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: unsupported,
      setFooter: unsupported,
      setHeader: unsupported,
      setTitle: () => {},
      custom: unsupported,
      pasteToEditor: unsupported,
      setEditorText: unsupported,
      getEditorText: () => "",
      addAutocompleteProvider: unsupported,
      setEditorComponent: unsupported,
      getEditorComponent: () => undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "请使用 Moon 主题设置。" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    }
  }
}
