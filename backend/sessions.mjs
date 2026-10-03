import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
  realpath,
} from "node:fs/promises"
import { join, dirname, isAbsolute, resolve, delimiter } from "node:path"
import { existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"
import {
  createAgentSession,
  DefaultResourceLoader,
  loadProjectContextFiles,
  SessionManager,
  SettingsManager,
  getAgentDir,
  getShellConfig,
  getPowerShellConfig,
  createCodemodeExtension,
  createToolSearchExtension,
  createMcpExtension,
} from "@earendil-works/pi-coding-agent"
import { assertSchema, schemas } from "./schema.mjs"
import {
  createMcpTransport,
  recordNestedMcpResult,
  safeMcpError,
} from "./mcp.mjs"

const names = {
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  bash: "Bash 命令",
  powershell: "PowerShell 命令",
  grep: "搜索文件内容",
  find: "查找文件",
  ls: "列出目录",
}
const descriptions = {
  read: "读取文本、图片和指定行范围的文件内容",
  write: "创建文件或写入完整文件内容",
  edit: "按精确文本匹配修改文件中的内容",
  bash: "在工作目录中执行 Bash 命令",
  powershell: "在工作目录中执行 PowerShell 命令",
  grep: "按正则表达式搜索文件内容",
  find: "按文件名或匹配模式查找文件",
  ls: "查看目录中的文件与子目录",
}
const check = (condition, message) => {
  if (!condition) throw new Error(message)
}

// Pi owns tool registration and context construction; Moon owns only its selected
// configuration, atomic commit and lifetime. No inference is performed here.
export class SessionService {
  constructor(directory, models) {
    this.directory = join(directory, "session-config")
    this.agentDir = join(directory, "agent")
    this.file = join(this.directory, "sessions.json")
    this.models = models
    this.active = new Map()
    this.closed = false
    this.gates = new Map()
    this.resources = new WeakMap()
    this.closing = new Set()
  }
  async exclusive(sessionId, action) {
    const previous = this.gates.get(sessionId) || Promise.resolve()
    let release
    const gate = new Promise((done) => {
      release = done
    })
    this.gates.set(sessionId, gate)
    await previous
    try {
      this.ensureOpen()
      return await action()
    } finally {
      release()
      if (this.gates.get(sessionId) === gate) this.gates.delete(sessionId)
    }
  }
  ensureOpen() {
    check(!this.closed, "会话配置服务已关闭，请重新打开 Moon。")
  }
  identity(value) {
    check(
      /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
        !["__proto__", "constructor", "prototype"].includes(value),
      "会话标识无效。"
    )
  }
  async cwd(value) {
    check(!value || isAbsolute(value), "工作目录必须使用绝对路径。")
    try {
      const path = await realpath(value || process.cwd())
      check((await stat(path)).isDirectory(), "工作目录不是目录。")
      return path
    } catch {
      throw new Error("工作目录不存在或不可访问，请重新选择。")
    }
  }
  async document() {
    let value
    try {
      value = JSON.parse(await readFile(this.file, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, sessions: {} }
      throw new Error("会话配置文件损坏或无法读取；原文件未覆盖。", {
        cause: error,
      })
    }
    check(
      value?.version === 1 &&
        value.sessions &&
        typeof value.sessions === "object" &&
        !Array.isArray(value.sessions),
      "会话配置文件结构损坏；原文件未覆盖。"
    )
    for (const [id, record] of Object.entries(value.sessions)) {
      // Read-only derived field was added after v1; accept previous records.
      record.unavailableToolIds ??= []
      assertSchema(schemas.SessionConfiguration, record, "已保存会话配置")
      check(record.sessionId === id, "会话配置标识损坏；原文件未覆盖。")
    }
    return value
  }
  async instructions(cwd) {
    // Pi deliberately logs and skips unreadable context files. Fail explicitly in
    // Moon instead of presenting a partial instruction set as successfully loaded.
    const dirs = new Set([this.agentDir])
    for (let path = cwd; ; path = dirname(path)) {
      dirs.add(path)
      if (dirname(path) === path) break
    }
    for (const dir of dirs) {
      for (const name of [
        "AGENTS.override.md",
        "AGENTS.md",
        "AGENTS.MD",
        "CLAUDE.md",
        "CLAUDE.MD",
      ]) {
        const path = join(dir, name)
        try {
          if ((await stat(path)).isFile()) {
            await readFile(path, "utf8")
            break
          }
        } catch (error) {
          if (error.code !== "ENOENT")
            throw new Error("项目指令文件无法读取，请检查文件权限。", {
              cause: error,
            })
        }
      }
    }
    return loadProjectContextFiles({ cwd, agentDir: this.agentDir }).map(
      (file) => ({
        ...file,
        source:
          resolve(dirname(file.path)).toLowerCase() ===
          resolve(this.agentDir).toLowerCase()
            ? "global"
            : "directory",
      })
    )
  }
  availability(name) {
    if (name === "bash" || name === "powershell") {
      try {
        ;(name === "bash" ? getShellConfig : getPowerShellConfig)()
        return ""
      } catch {
        return name === "bash"
          ? "未找到 Pi 可用的 Bash，请安装 Git Bash 或配置 PATH。"
          : "当前环境没有 Pi 支持的 PowerShell。"
      }
    }
    if (name === "grep" || name === "find") {
      const binaries = name === "grep" ? ["rg"] : ["fd", "fdfind"]
      const extension = process.platform === "win32" ? ".exe" : ""
      const dirs = [
        join(getAgentDir(), "bin"),
        ...(process.env.PATH || "").split(delimiter).filter(Boolean),
      ]
      if (
        !binaries.some((binary) =>
          dirs.some((dir) => existsSync(join(dir, binary + extension)))
        )
      )
        return `缺少本地 ${binaries[0]}；请安装依赖后重新读取，本次不会自动下载。`
    }
    return ""
  }
  runtimePrompt(cwd) {
    const lines = [
      "## Moon host runtime",
      `Host operating system: ${process.platform === "win32" ? "Windows (win32)" : process.platform}.`,
      `Native working directory: ${JSON.stringify(cwd)}.`,
      "File tools (read, write, edit, ls, grep, find) run in the native host filesystem. Prefer paths relative to this working directory; use native absolute paths only when necessary.",
    ]
    if (process.platform === "win32") {
      try {
        lines.push(
          `Bash executable resolved by Pi: ${JSON.stringify(getShellConfig().shell)}.`
        )
      } catch {
        lines.push(
          "Pi has no available Bash executable in this host environment."
        )
      }
      try {
        lines.push(
          `PowerShell executable resolved by Pi: ${JSON.stringify(getPowerShellConfig().shell)}.`
        )
      } catch {
        lines.push(
          "Pi has no available PowerShell executable in this host environment."
        )
      }
      lines.push(
        "Windows Bash may use Git Bash/MSYS/Cygwin path mappings. Paths printed by pwd, including /tmp and /c, are shell paths, not native Windows absolute paths; never pass them unchanged to file tools.",
        'If a native absolute path is required and cygpath is available in that shell, obtain it with cygpath -w "$PWD" (or convert the specific quoted shell path). Otherwise use the native working directory above and relative file paths. Never guess drive letters or shell mount mappings.',
        "Quote paths containing spaces or non-ASCII characters in shell commands. PowerShell uses native Windows paths."
      )
    }
    return lines.join("\n")
  }
  async create(
    cwd,
    instructions,
    toolIds,
    signal,
    recover = false,
    options = {}
  ) {
    this.ensureOpen()
    signal?.throwIfAborted()
    const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" })
    const mcpEnabled = !!options.sessionManager
    const mcp = this.models.mcp
    const mcpSnapshot = mcp
      ? await mcp.sessionEntries(toolIds)
      : { servers: [], errors: [] }
    const mcpTools = mcp ? await mcp.catalog() : []
    const instructionState = {
      files: instructions,
      toolIds: toolIds ? [...toolIds] : undefined,
      mcpSnapshot,
      mcpEnabled,
      mcpStatuses: new Map(),
      mcpAvailable: new Set(
        mcpTools.filter((tool) => tool.available).map((tool) => tool.id)
      ),
      transports: new Set(),
      disposed: false,
      generation: 0,
    }
    const owner = randomUUID()
    const gates = (pi) => {
      pi.on("tool_call", (event) => {
        const selected = instructionState.toolIds
        if (!selected) return
        const indirect = ["codemode", "tool_search"].includes(event.toolName)
        if (indirect && selected.some((id) => id.startsWith("mcp__"))) return
        if (!selected.includes(event.toolName))
          return { block: true, reason: "此工具未在当前会话中启用。" }
      })
      pi.on("session_shutdown", () => instructionState.mcpStatuses.clear())
      pi.on("tool_result", (event, ctx) =>
        recordNestedMcpResult(
          pi,
          event,
          ctx,
          mcp?.toolSource(event.toolName) || "MCP"
        )
      )
    }
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: this.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: false,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        gates,
        ...(options.extensionFactories || []),
        ...(mcpEnabled
          ? [
              createCodemodeExtension({ mode: "on" }),
              createToolSearchExtension(),
              (pi) => {
                const generation = instructionState.generation
                return createMcpExtension({
                  loadConfig: () => instructionState.mcpSnapshot,
                  credentials: mcp?.credentials,
                  logPath: join(this.agentDir, "mcp.log"),
                  createTransport: (entry, sessionCwd, authProvider) => {
                    check(
                      !instructionState.disposed &&
                        !this.closed &&
                        generation === instructionState.generation,
                      "会话已关闭，不再启动 MCP 服务。"
                    )
                    instructionState.mcpStatuses.set(entry.name, {
                      state: "connecting",
                      error: "",
                    })
                    let transport
                    try {
                      transport = createMcpTransport(
                        entry,
                        sessionCwd,
                        authProvider,
                        (status) => {
                          if (
                            generation === instructionState.generation &&
                            !instructionState.disposed
                          )
                            instructionState.mcpStatuses.set(entry.name, status)
                        }
                      )
                    } catch (error) {
                      instructionState.mcpStatuses.set(entry.name, {
                        state: "failed",
                        error: safeMcpError(error, entry.config),
                      })
                      throw error
                    }
                    instructionState.transports.add(transport)
                    transport.onClose(() =>
                      instructionState.transports.delete(transport)
                    )
                    return transport
                  },
                  // SDK slash commands must not silently edit Moon's revisioned file.
                  updateConfig: () => {
                    throw new Error("请在 Moon 的 MCP 服务设置中修改配置。")
                  },
                })(pi)
              },
            ]
          : []),
      ],
      systemPrompt: "",
      systemPromptOverride: () => undefined,
      appendSystemPrompt: [this.runtimePrompt(cwd)],
      agentsFilesOverride: () => ({
        agentsFiles: instructionState.files.map(({ path, content }) => ({
          path,
          content,
        })),
      }),
    })
    await resourceLoader.reload()
    signal?.throwIfAborted()
    const { session } = await createAgentSession({
      cwd,
      agentDir: this.agentDir,
      settingsManager,
      resourceLoader,
      sessionManager: options.sessionManager || SessionManager.inMemory(cwd),
      modelRuntime: options.modelRuntime || (await this.models.runtime()),
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
    })
    const dispose = session.dispose.bind(session)
    session.dispose = () => {
      instructionState.disposed = true
      mcp?.runtime.delete(owner)
      dispose()
      const closing = Promise.allSettled(
        [...instructionState.transports].map((transport) => transport.close())
      )
      instructionState.closing = closing
      this.closing.add(closing)
      void closing.finally(() => this.closing.delete(closing))
    }
    const reload = session.reload.bind(session)
    session.reload = async (options) => {
      check(
        !instructionState.disposed && !this.closed,
        "会话已关闭，不能重载资源。"
      )
      // Pi only owns fully initialized clients. Moon also owns transports whose
      // initialize/tools/list is still pending, and must close them before reload.
      instructionState.generation++
      await Promise.all(
        [...instructionState.transports].map((transport) => transport.close())
      )
      check(
        !instructionState.disposed && !this.closed,
        "会话已关闭，不能重载资源。"
      )
      await reload(options)
    }
    try {
      this.ensureOpen()
      signal?.throwIfAborted()
      if (mcpEnabled) mcp?.runtime.set(owner, instructionState.mcpStatuses)
      await session.bindExtensions({
        onError: (error) => {
          // This is a real host binding: Pi reuses it after reload and therefore
          // emits session_start itself exactly once. Retain a safe, inspectable
          // diagnostic in the authoritative Pi history, never the raw SDK error.
          const diagnostic = {
            source: /^<inline:[A-Za-z0-9_-]+>$/.test(error.extensionPath)
              ? error.extensionPath
              : "Pi extension",
            event: new Set([
              "session_start",
              "session_shutdown",
              "tool_call",
              "tool_result",
              "turn_end",
              "agent_before_settle",
              "before_agent_start",
              "resources_discover",
              "prepare_loadout",
            ]).has(error.event)
              ? error.event
              : "extension",
            message: "会话扩展未完成操作，请核对会话配置和待处理消息状态。",
            occurredAt: new Date().toISOString(),
          }
          instructionState.extensionError = diagnostic
          session.sessionManager.appendCustomEntry(
            "moon-extension-error",
            diagnostic
          )
        },
      })
      if (toolIds) {
        const available = new Set([
          ...session.getAllTools().map((tool) => tool.name),
          ...mcpTools.filter((tool) => tool.available).map((tool) => tool.id),
        ])
        check(new Set(toolIds).size === toolIds.length, "工具选择不能重复。")
        const selected = toolIds.filter(
          (name) =>
            (name.startsWith("mcp__")
              ? instructionState.mcpAvailable.has(name)
              : available.has(name)) && !this.availability(name)
        )
        check(
          recover || selected.length === toolIds.length,
          "所选工具已不可用，请重新读取工具目录。"
        )
        session.setActiveToolsByName(
          selected.filter((name) => !name.startsWith("mcp__"))
        )
        if (mcpEnabled && selected.some((name) => name.startsWith("mcp__")))
          session.setActiveToolsByName([
            ...session.getActiveToolNames(),
            "codemode",
            "tool_search",
          ])
        const effective = session.getActiveToolNames()
        check(
          selected
            .filter((name) => !name.startsWith("mcp__"))
            .every((name) => effective.includes(name)),
          "部分工具未能启用，请重新读取工具目录。"
        )
      }
      if (!toolIds)
        session.setActiveToolsByName(
          session
            .getActiveToolNames()
            .filter((name) => !this.availability(name))
        )
      this.resources.set(session, instructionState)
      return session
    } catch (error) {
      session.dispose()
      await instructionState.closing
      throw error
    }
  }
  async catalog(cwd, signal) {
    this.ensureOpen()
    cwd = await this.cwd(cwd)
    const instructions = await this.instructions(cwd)
    const session = await this.create(cwd, instructions, undefined, signal)
    try {
      signal?.throwIfAborted()
      return {
        cwd,
        tools: [
          ...session.getAllTools().map((tool) => ({
            id: tool.name,
            name: names[tool.name] || tool.name,
            description: descriptions[tool.name] || tool.description,
            group: "Pi 内置工具",
            detail: tool.description,
            available: !this.availability(tool.name),
            unavailableReason: this.availability(tool.name),
          })),
          ...(this.models.mcp ? await this.models.mcp.catalog() : []),
        ],
        instructions,
        defaults: {
          toolIds: session.getActiveToolNames(),
          instructionScope: "all",
        },
      }
    } finally {
      session.dispose()
    }
  }
  async skillResources(cwd, sessionId, signal) {
    cwd = await this.cwd(cwd)
    signal?.throwIfAborted()
    // Discovery does not start a model/session or executable extensions. Merge
    // resources already registered on a live session (e.g. package Skills).
    const live = this.active
      .get(sessionId)
      ?.session?.resourceLoader?.getSkills()
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: this.agentDir,
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
      noExtensions: true,
      noSkills: false,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: (live?.skills ?? [])
        .filter((skill) => skill.sourceInfo?.origin === "package")
        .map((skill) => skill.filePath),
    })
    await loader.reload()
    signal?.throwIfAborted()
    const found = loader.getSkills()
    return found
  }
  snapshot(record, session) {
    const registered = new Set(session.getAllTools().map((tool) => tool.name))
    const resource = this.resources.get(session)
    const configured = resource?.mcpAvailable || new Set()
    const available = record.toolIds.filter(
      (name) =>
        (name.startsWith("mcp__")
          ? configured.has(name)
          : registered.has(name)) && !this.availability(name)
    )
    if (session.isIdle) {
      const active = session.getActiveToolNames()
      const next = [
        ...available.filter((name) => !name.startsWith("mcp__")),
        // Preserve Pi's current direct/promoted MCP loadout. Reading a snapshot
        // must not promote every deferred or codemode tool into active tools.
        ...active.filter(
          (name) => name.startsWith("mcp__") && available.includes(name)
        ),
        ...(resource?.mcpEnabled &&
        available.some((name) => name.startsWith("mcp__"))
          ? ["codemode", "tool_search"].filter((name) => registered.has(name))
          : []),
      ]
      if (
        active.length !== next.length ||
        active.some((name) => !next.includes(name))
      )
        session.setActiveToolsByName(next)
    }
    return {
      ...record,
      effectiveToolIds: session.getActiveToolNames(),
      unavailableToolIds: record.toolIds.filter(
        (name) => !available.includes(name)
      ),
    }
  }
  async read(sessionId, signal) {
    return this.exclusive(sessionId, () =>
      this.readExclusive(sessionId, signal)
    )
  }
  async readExclusive(sessionId, signal) {
    this.ensureOpen()
    this.identity(sessionId)
    signal?.throwIfAborted()
    const data = await this.document()
    const record = Object.hasOwn(data.sessions, sessionId)
      ? data.sessions[sessionId]
      : undefined
    if (!record) return null
    const cwd = await this.cwd(record.cwd)
    this.ensureOpen()
    signal?.throwIfAborted()
    const existing = this.active.get(sessionId)
    if (existing?.revision === record.revision)
      return this.snapshot(record, existing.session)
    const session = await this.create(
      cwd,
      record.instructions,
      record.toolIds,
      signal,
      true
    )
    if (this.closed) {
      session.dispose()
      this.ensureOpen()
    }
    // No await in this compare/install section: never replace a newer concurrent
    // apply's runtime with the snapshot whose construction just completed.
    const current = this.active.get(sessionId)
    if (!current || current.revision < record.revision) {
      current?.session.dispose()
      this.active.set(sessionId, { revision: record.revision, session })
      return this.snapshot(record, session)
    }
    session.dispose()
    if (current.revision > record.revision)
      return this.readExclusive(sessionId, signal)
    return this.snapshot(record, current.session)
  }
  async apply(sessionId, cwd, toolIds, instructionScope, revision, signal) {
    return this.exclusive(sessionId, () =>
      this.applyExclusive(
        sessionId,
        cwd,
        toolIds,
        instructionScope,
        revision,
        signal
      )
    )
  }
  // Fork owns a new identity but inherits the exact saved instruction snapshot;
  // re-discovering files here would silently change the confirmed configuration.
  async copyConfiguration(sessionId, source) {
    return this.exclusive(sessionId, async () => {
      this.identity(sessionId)
      assertSchema(schemas.SessionConfiguration, source, "来源配置")
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const unlock = await lockfile.lock(this.directory, {
        realpath: false,
        retries: { retries: 30, minTimeout: 30, maxTimeout: 300 },
      })
      const temporary = join(this.directory, `.sessions-${randomUUID()}.tmp`)
      try {
        const data = await this.document()
        if (Object.hasOwn(data.sessions, sessionId))
          return data.sessions[sessionId]
        const record = { ...structuredClone(source), sessionId, revision: 1 }
        assertSchema(schemas.SessionConfiguration, record)
        data.sessions[sessionId] = record
        await writeFile(temporary, JSON.stringify(data, null, 2), {
          flag: "wx",
          mode: 0o600,
        })
        await rename(temporary, this.file)
        return record
      } finally {
        try {
          await rm(temporary, { force: true })
        } finally {
          await unlock()
        }
      }
    })
  }
  async applyExclusive(
    sessionId,
    cwd,
    toolIds,
    instructionScope,
    revision,
    signal
  ) {
    this.ensureOpen()
    this.identity(sessionId)
    cwd = await this.cwd(cwd)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const unlock = await lockfile.lock(this.directory, {
      realpath: false,
      retries: { retries: 30, minTimeout: 30, maxTimeout: 300 },
    })
    const temporary = join(this.directory, `.sessions-${randomUUID()}.tmp`)
    let candidate
    let committed = false
    let live
    let oldInstructions
    let oldTools
    let oldSelection
    let oldMcp
    let oldAvailable
    try {
      this.ensureOpen()
      signal?.throwIfAborted()
      const data = await this.document()
      const previous = Object.hasOwn(data.sessions, sessionId)
        ? data.sessions[sessionId]
        : undefined
      check(
        previous ? revision === previous.revision : revision === undefined,
        "会话配置版本已变化，请重新读取后再应用。"
      )
      check(
        !previous || previous.cwd === cwd,
        "已有会话不能更换工作目录，请新建会话。"
      )
      live = this.active.get(sessionId)
      check(
        !live?.busy && (!live || live.session.isIdle),
        "会话正在执行，请结束后再调整配置。"
      )
      const all =
        instructionScope === "none" ? [] : await this.instructions(cwd)
      const instructions =
        instructionScope === "directory"
          ? all.filter((file) => file.source === "directory")
          : all
      candidate = await this.create(cwd, instructions, toolIds, signal)
      this.ensureOpen()
      const record = {
        sessionId,
        cwd,
        revision: (previous?.revision || 0) + 1,
        toolIds: [...toolIds],
        instructionScope,
        instructions,
        effectiveToolIds: candidate.getActiveToolNames(),
        unavailableToolIds: [],
      }
      assertSchema(schemas.SessionConfiguration, record)
      data.sessions[sessionId] = record
      signal?.throwIfAborted()
      await writeFile(temporary, JSON.stringify(data, null, 2), {
        flag: "wx",
        mode: 0o600,
      })
      signal?.throwIfAborted()
      this.ensureOpen()
      if (live?.persistent) {
        const resource = this.resources.get(live.session)
        check(resource, "会话资源不可用，请重新打开会话。")
        oldInstructions = resource.files
        oldTools = live.session.getActiveToolNames()
        oldSelection = resource.toolIds
        oldMcp = resource.mcpSnapshot
        oldAvailable = resource.mcpAvailable
        resource.toolIds = [...toolIds]
        resource.mcpSnapshot = await this.models.mcp.sessionEntries(toolIds)
        resource.mcpAvailable = new Set(
          (await this.models.mcp.catalog())
            .filter((tool) => tool.available)
            .map((tool) => tool.id)
        )
        resource.files = instructions
        await live.session.reload()
        live.session.setActiveToolsByName([
          ...toolIds.filter((name) => !name.startsWith("mcp__")),
          ...(toolIds.some((name) => name.startsWith("mcp__"))
            ? ["codemode", "tool_search"]
            : []),
        ])
        signal?.throwIfAborted()
        this.ensureOpen()
      }
      await rename(temporary, this.file)
      committed = true
      if (live?.persistent) {
        live.revision = record.revision
        candidate.dispose()
      } else if (this.closed) candidate.dispose()
      else {
        this.active.get(sessionId)?.session.dispose()
        this.active.set(sessionId, {
          revision: record.revision,
          session: candidate,
        })
      }
      return record
    } finally {
      if (candidate && !committed) candidate.dispose()
      try {
        if (!committed && live?.persistent && oldInstructions) {
          this.resources.get(live.session).files = oldInstructions
          this.resources.get(live.session).toolIds = oldSelection
          this.resources.get(live.session).mcpSnapshot = oldMcp
          this.resources.get(live.session).mcpAvailable = oldAvailable
          await live.session.reload()
          live.session.setActiveToolsByName(oldTools)
        }
      } finally {
        try {
          await rm(temporary, { force: true })
        } finally {
          await unlock()
        }
      }
    }
  }
  async refreshForRunExclusive(sessionId, signal) {
    const live = this.active.get(sessionId)
    if (!live?.persistent || !this.models.mcp) return
    check(
      !live.busy && live.session.isIdle,
      "会话正在执行，不能重载 MCP 配置。"
    )
    signal?.throwIfAborted()
    const resource = this.resources.get(live.session)
    const snapshot = await this.models.mcp.sessionEntries(resource.toolIds)
    const available = new Set(
      (await this.models.mcp.catalog())
        .filter((tool) => tool.available)
        .map((tool) => tool.id)
    )
    const unavailable = (resource.toolIds || []).filter(
      (id) => id.startsWith("mcp__") && !available.has(id)
    )
    if (snapshot.fingerprint !== resource.mcpSnapshot.fingerprint) {
      const previous = resource.mcpSnapshot
      const oldAvailable = resource.mcpAvailable
      const oldTools = live.session.getActiveToolNames()
      resource.mcpSnapshot = snapshot
      resource.mcpAvailable = available
      try {
        // Reload first: deleted/disabled services must close even when their old
        // selection now blocks sending. The user selection remains unchanged.
        await live.session.reload()
        signal?.throwIfAborted()
        live.session.setActiveToolsByName([
          ...(resource.toolIds || []).filter(
            (name) => !name.startsWith("mcp__")
          ),
          ...((resource.toolIds || []).some(
            (name) => name.startsWith("mcp__") && available.has(name)
          )
            ? ["codemode", "tool_search"]
            : []),
        ])
      } catch (error) {
        resource.mcpSnapshot = previous
        resource.mcpAvailable = oldAvailable
        await live.session.reload()
        live.session.setActiveToolsByName(oldTools)
        throw error
      }
    }
    check(
      !unavailable.length,
      "已选择的 MCP 工具已停用、删除或失效，请在会话配置中取消后重试。"
    )
  }
  async close() {
    this.closed = true
    const entries = [...this.active.values()]
    for (const { session } of entries) session.dispose()
    await Promise.allSettled(
      entries.map(({ session }) => this.resources.get(session)?.closing)
    )
    await Promise.allSettled([...this.closing])
    this.active.clear()
  }
}
