import { replaceJson } from "./atomic-file.mjs"
import { readFile, realpath } from "node:fs/promises"
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
      await replaceJson(join(this.directory, sessionId + ".json"), next, {
        signal,
      })
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
  pendingBySession() {
    const pending = new Map()
    const now = Date.now()
    for (const item of this.pending.values()) {
      if (item.deadline <= now || item.state.stopRequested) continue
      if (item.public.runId !== (item.state.record.runId || "")) continue
      const projection = pending.get(item.sessionId) ?? {
        runId: item.public.runId,
        counts: { approvals: 0, answers: 0 },
      }
      const { counts } = projection
      if (item.public.kind === "tool") counts.approvals++
      else counts.answers++
      pending.set(item.sessionId, projection)
    }
    return pending
  }
  ask(state, request, { signal, timeout = 300000 } = {}) {
    const sessionId = state.record.id,
      id = randomUUID()
    const deadline = Date.now() + timeout
    const publicRequest = {
      id,
      runId: state.record.runId || "",
      ...request,
      expiresAt: new Date(deadline).toISOString(),
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
      this.pending.set(id, {
        sessionId,
        state,
        public: publicRequest,
        deadline,
        finish,
      })
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
        item.public.runId === (item.state.record.runId || "") &&
        !item.state.stopRequested,
      "审批不属于当前运行。"
    )
    if (item.deadline <= Date.now()) {
      item.finish("cancel")
      throw new Error("审批已结束或已过期，请读取当前状态。")
    }
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
        const registered = pi.getAllTools().find((tool) => tool.name === name)
        const actual =
          this.conversations.models.plugins?.currentTool(
            registered,
            state.session?.getToolDefinition(name)
          ) ||
          (registered && registered.sourceInfo?.source !== "builtin"
            ? { external: true, origin: registered.sourceInfo?.path }
            : undefined)
        const contribution = actual
          ? {
              ...actual,
              available: !actual.entry || actual.entry.state === "active",
            }
          : undefined
        if (contribution) {
          if (!contribution.available)
            return { block: true, reason: "所属插件已停用。" }
          if (
            mode === "read-only" &&
            contribution.effect &&
            contribution.effect !== "read"
          )
            return { block: true, reason: "只读权限不允许此操作。" }
        }
        if (mode === "full-access") return
        if (
          (name === "tool_search" &&
            actual?.origin === "<inline:moon-mcp-tool-search>") ||
          (name === "codemode" &&
            actual?.origin === "<inline:moon-mcp-codemode>")
        )
          return // Nested owned MCP calls pass this same SDK hook.
        const fileTool =
            (["read", "write", "edit", "grep", "find", "ls"].includes(name) &&
              !actual) ||
            contribution?.resource === "file",
          mutation =
            (!actual && ["write", "edit"].includes(name)) ||
            (actual?.effect && actual.effect !== "read")
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
        const builtin = registered?.sourceInfo?.source === "builtin"
        const command = builtin && ["bash", "powershell"].includes(name)
        const sourceKind = builtin
          ? "builtin"
          : actual?.entry
            ? "plugin"
            : actual
              ? "extension"
              : "unknown"
        const knownTarget = target
          ? { kind: "path", value: target }
          : command && typeof event.input.command === "string"
            ? { kind: "command", value: event.input.command }
            : undefined
        const scopeNotice = command
          ? "宿主无法预先确认命令实际访问的文件、启动的程序或联网范围。"
          : !builtin
            ? "宿主无法预先确认此工具将访问的文件、服务或联网范围。"
            : !knownTarget
              ? "宿主未能识别此工具的访问目标。"
              : ["grep", "find", "ls"].includes(name)
                ? "实际读取的文件和子目录由工具执行时确定。"
                : undefined
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
            ...(typeof event.toolCallId === "string"
              ? { toolCallId: event.toolCallId }
              : {}),
            input: JSON.stringify(event.input, null, 2),
            details: {
              sourceKind,
              ...(actual?.entry?.manifest?.name && {
                sourceName: actual.entry.manifest.name,
              }),
              ...(knownTarget && { target: knownTarget }),
              ...(scopeNotice && { scopeNotice }),
            },
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
  ui(state, pluginId = "pi") {
    const ask = (kind, title, message, options, opts) =>
      this.ask(
        state,
        { kind, title, message, pluginId, ...(options ? { options } : {}) },
        opts
      )
    const unsupported = () => {
      throw new Error(
        "Moon 不支持终端组件交互，请使用 confirm/select/input/editor。"
      )
    }
    const update = (kind, key, value) => {
      state.pluginUi ||= {}
      const record = (state.pluginUi[pluginId] ||= {
        notices: [],
        statuses: {},
        widgets: {},
      })
      if (kind === "notices")
        record.notices = [...record.notices, value.slice(0, 4000)].slice(-20)
      else if (value === undefined) delete record[kind][key]
      else
        record[kind][key] = Array.isArray(value)
          ? value.map((line) => String(line).slice(0, 4000)).slice(0, 128)
          : String(value).slice(0, 4000)
      this.conversations.touch(state)
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
      notify: (message, type = "info") =>
        update(
          "notices",
          "",
          `${type === "error" ? "错误：" : type === "warning" ? "提醒：" : ""}${String(message)}`
        ),
      onTerminalInput: () => () => {},
      setStatus: (key, text) => update("statuses", key, text),
      setWorkingMessage: (text) => update("statuses", "working", text),
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, lines) => {
        if (lines !== undefined && !Array.isArray(lines)) return
        update("widgets", key, lines)
      },
      setFooter: unsupported,
      setHeader: unsupported,
      setTitle: (text) => update("statuses", "title", text),
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
