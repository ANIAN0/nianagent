import { loadPiSdk } from "./pi-sdk.mjs"
import { currentTraceId } from "./request-context.mjs"
import { settleResources } from "./close-resources.mjs"
import { withAcquiredLock, withCleanup, stageJson } from "./atomic-file.mjs"
import {
  createPiSession,
  readPiToolDefinitions,
} from "./pi-session-adapter.mjs"
import {
  names,
  descriptions,
  check,
  extensionSnapshotTools,
} from "./session-core.mjs"
import { mkdir, readFile, stat, realpath } from "node:fs/promises"
import { join, dirname, isAbsolute, resolve, delimiter } from "node:path"
import { existsSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"

import lockfile from "proper-lockfile"
import { assertSchema, schemas } from "./schema.mjs"
import { operationError } from "./operation-issue.mjs"

// Pi owns tool registration and context construction; Moon owns only its selected
// configuration, atomic commit and lifetime. No inference is performed here.
export class SessionService {
  constructor(directory, models, diagnostics) {
    this.diagnostics = diagnostics
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
  /** 活动快照端口（G01）：外部（装配/维护）只读摘要，不查看内部 Map 字段。 */
  hasBusyWork() {
    for (const entry of this.active.values())
      if (entry.busy || !entry.session.isIdle) return true
    return false
  }
  commandRunner(sessionId) {
    return this.active.get(sessionId)?.session?.extensionRunner
  }
  adoptRuntime(sessionId, entry) {
    this.ensureOpen()
    this.identity(sessionId)
    this.active.get(sessionId)?.session.dispose()
    this.active.set(sessionId, entry)
  }
  detachRuntime(sessionId, expectedEntry) {
    // 迟到的失败收尾不能移除同sessionId的新运行实例。
    if (this.active.get(sessionId) !== expectedEntry) return false
    return this.active.delete(sessionId)
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
  async measure(phase, action) {
    const start = performance.now()
    let outcome = "unknown"
    try {
      const value = await action()
      outcome = "committed"
      return value
    } finally {
      const durationMs = Math.round(performance.now() - start)
      this.diagnostics?.append({
        module: "session-setup",
        event: `session.${phase}`,
        level: outcome !== "committed" || durationMs >= 1000 ? "warn" : "info",
        traceId: currentTraceId(),
        durationMs,
        outcome,
      })
    }
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
    const { loadProjectContextFiles } = await this.sdk("instructions.importPi")
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
  availability(name, session) {
    const tool = session
      ?.getAllTools()
      .find((candidate) => candidate.name === name)
    return this.toolAvailability(name, tool, session?.getToolDefinition(name))
  }
  toolAvailability(name, tool, definition) {
    if (tool && tool.sourceInfo?.source !== "builtin") {
      const actual = this.models.plugins?.currentTool(tool, definition)
      return actual?.entry && actual.entry.state !== "active"
        ? "所属插件已停用或加载失败。"
        : ""
    }
    const { getShellConfig, getPowerShellConfig, getAgentDir } = this.pi
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
      const { getShellConfig, getPowerShellConfig } = this.pi
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
  async sdk(phase) {
    return (this.pi ??= await this.measure(phase, loadPiSdk))
  }
  async create(...args) {
    await this.sdk("create.importPi")
    const service = this
    return this.measure("create", () =>
      createPiSession(
        {
          measure: this.measure.bind(this),
          ensureOpen: this.ensureOpen.bind(this),
          models: this.models,
          agentDir: this.agentDir,
          get closed() {
            return service.closed
          },
          runtimePrompt: this.runtimePrompt.bind(this),
          closing: this.closing,
          availability: this.availability.bind(this),
          resources: this.resources,
        },
        ...args
      )
    )
  }
  async catalog(cwd, signal, sessionId) {
    this.ensureOpen()
    if (sessionId !== undefined) this.identity(sessionId)
    cwd = await this.measure("catalog.cwd", () => this.cwd(cwd))
    signal?.throwIfAborted()
    const [instructions, mcpTools] = await Promise.all([
      this.measure("catalog.instructions", () => this.instructions(cwd)),
      this.measure(
        "catalog.mcpCatalog",
        async () => this.models.mcp?.catalog(cwd) ?? []
      ),
    ])
    signal?.throwIfAborted()
    const sdk = await this.sdk("catalog.importPi")
    const declarations = await readPiToolDefinitions(this, sdk, cwd, signal)
    this.ensureOpen()
    signal?.throwIfAborted()
    const live = this.active.get(sessionId)
    const dynamic =
      live?.persistent && live.session.sessionManager.getCwd() === cwd
        ? this.livePluginTools(live.session)
        : []
    return this.projectCatalog(
      cwd,
      instructions,
      mcpTools,
      declarations,
      dynamic
    )
  }
  livePluginTools(session) {
    return session.getAllTools().flatMap((tool) => {
      if (
        tool.sourceInfo?.source === "builtin" ||
        tool.exposure === "hidden" ||
        tool.name.startsWith("mcp__") ||
        tool.name.startsWith("moon_ext__") ||
        ["codemode", "tool_search"].includes(tool.name)
      )
        return []
      const definition = session.getToolDefinition(tool.name)
      const actual = this.models.plugins?.currentTool(tool, definition)
      return actual?.entry ? [{ tool, definition }] : []
    })
  }
  projectCatalog(
    cwd,
    instructions,
    mcpTools,
    { registered, snapshot },
    dynamic
  ) {
    const toolIds = []
    const titles = new Map(
      snapshot.descriptors.flatMap(({ tools }) =>
        tools.map(({ id, name }) => [id, name])
      )
    )
    const loadedIds = new Set(registered.map(({ tool }) => tool.name))
    const definitions = [
      ...registered,
      ...dynamic.filter(({ tool }) => !loadedIds.has(tool.name)),
    ]
    const tools = definitions.map(({ tool, definition }) => {
      const actual = this.models.plugins?.currentTool(tool, definition)
      const unavailableReason = this.toolAvailability(
        tool.name,
        tool,
        definition
      )
      if (
        loadedIds.has(tool.name) &&
        tool.exposure !== "hidden" &&
        !unavailableReason
      )
        toolIds.push(tool.name)
      return {
        id: tool.name,
        name:
          (actual ? actual.definition?.label : names[tool.name]) ||
          titles.get(tool.name) ||
          tool.name,
        description: actual
          ? tool.description
          : descriptions[tool.name] || tool.description,
        group:
          actual?.source ||
          this.models.extensions?.toolSource(tool.name) ||
          "Pi 内置工具",
        detail: tool.description,
        available: !unavailableReason,
        unavailableReason,
      }
    })
    toolIds.push(
      ...mcpTools.filter((tool) => tool.available).map((tool) => tool.id)
    )
    return {
      cwd,
      tools: [
        ...tools,
        ...mcpTools,
        ...extensionSnapshotTools(
          snapshot,
          definitions.map(({ tool }) => tool)
        ),
      ],
      instructions,
      defaults: { toolIds, instructionScope: "all" },
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
    const { DefaultResourceLoader, SettingsManager } = await loadPiSdk()
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
          : registered.has(name)) && !this.availability(name, session)
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
  async canApplyLiveTools(live, resource, toolIds, instructions) {
    // Reloading Pi discards tools registered by callbacks that have already run.
    // Keep the existing registry when only the direct tool selection changes.
    if (
      !resource ||
      !isDeepStrictEqual(resource.files, instructions) ||
      (this.models.plugins?.fingerprint() || "") !== resource.pluginFingerprint
    )
      return false
    const pluginIds = new Set(
      this.livePluginTools(live.session).map(({ tool }) => tool.name)
    )
    const tools = new Map(
      live.session.getAllTools().map((tool) => [tool.name, tool])
    )
    const extensions = await this.models.extensions?.sessionSnapshot(toolIds)
    if (
      extensions &&
      (extensions.fingerprint !== resource.extensionSnapshot.fingerprint ||
        !isDeepStrictEqual(
          extensions.entries.map((entry) => entry.toolIds),
          resource.extensionSnapshot.entries.map((entry) => entry.toolIds)
        ))
    )
      return false
    const mcp = await this.models.mcp?.sessionEntries(toolIds, resource.cwd)
    if (mcp?.fingerprint !== resource.mcpSnapshot.fingerprint) return false
    const mcpTools = await this.models.mcp?.catalog(resource.cwd)
    const mcpIds = new Set(
      mcpTools?.filter((tool) => tool.available).map((tool) => tool.id)
    )
    if (!isDeepStrictEqual(mcpIds, resource.mcpAvailable)) return false
    return toolIds.every((id) => {
      if (id.startsWith("mcp__")) return mcpIds.has(id)
      const tool = tools.get(id)
      return (
        tool &&
        tool.exposure !== "hidden" &&
        (tool.sourceInfo?.source === "builtin" ||
          pluginIds.has(id) ||
          id.startsWith("moon_ext__")) &&
        !this.toolAvailability(id, tool, live.session.getToolDefinition(id))
      )
    })
  }
  // Fork owns a new identity but inherits the exact saved instruction snapshot;
  // re-discovering files here would silently change the confirmed configuration.
  async copyConfiguration(sessionId, source) {
    return this.exclusive(sessionId, () =>
      this.copyConfigurationExclusive(sessionId, source)
    )
  }
  // Caller already owns the target's session gate.
  async copyConfigurationExclusive(sessionId, source) {
    this.identity(sessionId)
    assertSchema(schemas.SessionConfiguration, source, "来源配置")
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const unlock = await lockfile.lock(this.directory, {
      realpath: false,
      retries: { retries: 30, minTimeout: 30, maxTimeout: 300 },
    })
    return withAcquiredLock(unlock, async (committed) => {
      const data = await this.document()
      if (Object.hasOwn(data.sessions, sessionId))
        return data.sessions[sessionId]
      const record = { ...structuredClone(source), sessionId, revision: 1 }
      assertSchema(schemas.SessionConfiguration, record)
      data.sessions[sessionId] = record
      const staged = await stageJson(this.file, data, { pretty: true })
      return withCleanup(
        async () => {
          await staged.commit()
          committed()
          return record
        },
        () => staged.discard()
      )
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
    return withAcquiredLock(unlock, async (markCommitted) => {
      let staged
      let candidate
      let committed = false
      let live
      let oldInstructions
      let oldTools
      let oldSelection
      let oldMcp
      let oldAvailable
      let oldExtensions
      let useLiveTools = false

      return withCleanup(
        async () => {
          this.ensureOpen()
          signal?.throwIfAborted()
          const data = await this.document()
          const previous = Object.hasOwn(data.sessions, sessionId)
            ? data.sessions[sessionId]
            : undefined
          if (
            !(previous
              ? revision === previous.revision
              : revision === undefined)
          )
            throw operationError(
              "session_revision_conflict",
              "会话配置版本已变化，请读取当前会话的已保存配置后再应用。",
              "reload"
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
          const resource = live?.persistent && this.resources.get(live.session)
          useLiveTools =
            !!resource &&
            (await this.canApplyLiveTools(
              live,
              resource,
              toolIds,
              instructions
            ))
          if (!useLiveTools)
            candidate = await this.create(cwd, instructions, toolIds, signal)
          this.ensureOpen()
          const record = {
            sessionId,
            cwd,
            revision: (previous?.revision || 0) + 1,
            toolIds: [...toolIds],
            instructionScope,
            instructions,
            effectiveToolIds: candidate?.getActiveToolNames() ?? [],
            unavailableToolIds: [],
          }
          if (useLiveTools) {
            check(
              new Set(toolIds).size === toolIds.length,
              "工具选择不能重复。"
            )
            signal?.throwIfAborted()
            oldTools = live.session.getActiveToolNames()
            Object.assign(record, this.snapshot(record, live.session))
            check(
              toolIds.every(
                (id) =>
                  id.startsWith("mcp__") || record.effectiveToolIds.includes(id)
              ),
              "部分工具未能启用，请重新读取工具目录。"
            )
          }
          assertSchema(schemas.SessionConfiguration, record)
          data.sessions[sessionId] = record
          signal?.throwIfAborted()
          staged = await stageJson(this.file, data, {
            signal: typeof signal === "undefined" ? undefined : signal,
            pretty: true,
          })
          signal?.throwIfAborted()
          this.ensureOpen()
          if (live?.persistent && !useLiveTools) {
            check(resource, "会话资源不可用，请重新打开会话。")
            oldInstructions = resource.files
            oldTools = live.session.getActiveToolNames()
            oldSelection = resource.toolIds
            oldMcp = resource.mcpSnapshot
            oldAvailable = resource.mcpAvailable
            oldExtensions = resource.extensionSnapshot
            resource.toolIds = [...toolIds]
            resource.mcpSnapshot = await this.models.mcp.sessionEntries(
              toolIds,
              resource.cwd
            )
            resource.mcpAvailable = new Set(
              (await this.models.mcp.catalog(resource.cwd))
                .filter((tool) => tool.available)
                .map((tool) => tool.id)
            )
            resource.files = instructions
            if (this.models.extensions)
              resource.extensionSnapshot =
                await this.models.extensions.sessionSnapshot(toolIds)
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
          await staged.commit()
          committed = true
          markCommitted()
          if (live?.persistent) {
            live.revision = record.revision
            if (useLiveTools) resource.toolIds = [...toolIds]
            else candidate.dispose()
          } else if (this.closed) candidate.dispose()
          else {
            this.active.get(sessionId)?.session.dispose()
            this.active.set(sessionId, {
              revision: record.revision,
              session: candidate,
            })
          }
          return record
        },
        async () =>
          withCleanup(
            async () => {
              await withCleanup(
                async () => {
                  if (candidate && !committed) candidate.dispose()
                },
                async () => {
                  if (!committed && useLiveTools && oldTools)
                    live.session.setActiveToolsByName(oldTools)
                  if (!committed && live?.persistent && oldInstructions) {
                    this.resources.get(live.session).files = oldInstructions
                    this.resources.get(live.session).toolIds = oldSelection
                    this.resources.get(live.session).mcpSnapshot = oldMcp
                    this.resources.get(live.session).mcpAvailable = oldAvailable
                    this.resources.get(live.session).extensionSnapshot =
                      oldExtensions
                    await live.session.reload()
                    live.session.setActiveToolsByName(oldTools)
                  }
                }
              )
            },
            async () => staged?.discard()
          )
      )
    })
  }
  async refreshForRunExclusive(sessionId, signal) {
    const live = this.active.get(sessionId)
    if (!live?.persistent) return
    check(!live.busy && live.session.isIdle, "会话正在执行，不能重载能力配置。")
    signal?.throwIfAborted()
    const resource = this.resources.get(live.session)
    const snapshot = this.models.mcp
      ? await this.models.mcp.sessionEntries(resource.toolIds, resource.cwd)
      : { servers: [], errors: [], fingerprint: "" }
    const available = new Set(
      (this.models.mcp ? await this.models.mcp.catalog(resource.cwd) : [])
        .filter((tool) => tool.available)
        .map((tool) => tool.id)
    )
    const extensions = this.models.extensions
      ? await this.models.extensions.sessionSnapshot(resource.toolIds)
      : resource.extensionSnapshot
    const extensionAvailable = new Set(
      (extensions?.descriptors || []).flatMap((descriptor) =>
        descriptor.tools.filter((tool) => tool.available).map((tool) => tool.id)
      )
    )
    const unavailableTools = () => {
      const registered = new Set(
        live.session.getAllTools().map((tool) => tool.name)
      )
      return (resource.toolIds || []).filter((id) =>
        id.startsWith("mcp__")
          ? !available.has(id)
          : !registered.has(id) || !!this.availability(id, live.session)
      )
    }
    if (
      snapshot.fingerprint !== resource.mcpSnapshot.fingerprint ||
      extensions?.fingerprint !== resource.extensionSnapshot?.fingerprint ||
      this.models.plugins?.fingerprint() !== resource.pluginFingerprint
    ) {
      const previous = resource.mcpSnapshot
      const oldAvailable = resource.mcpAvailable
      const oldTools = live.session.getActiveToolNames()
      const previousExtensions = resource.extensionSnapshot
      resource.mcpSnapshot = snapshot
      resource.mcpAvailable = available
      resource.extensionSnapshot = extensions
      try {
        // Reload first: deleted/disabled services must close even when their old
        // selection now blocks sending. The user selection remains unchanged.
        await live.session.reload()
        signal?.throwIfAborted()
        const unavailable = unavailableTools()
        live.session.setActiveToolsByName([
          ...(resource.toolIds || []).filter(
            (name) =>
              !name.startsWith("mcp__") &&
              !unavailable.includes(name) &&
              (!name.startsWith("moon_ext__") || extensionAvailable.has(name))
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
        resource.extensionSnapshot = previousExtensions
        await live.session.reload()
        live.session.setActiveToolsByName(oldTools)
        throw error
      }
    }
    check(
      !unavailableTools().length,
      "已选择的 MCP 或扩展工具已停用、删除或失效，请在会话配置中取消后重试。"
    )
  }
  async close({ strict = false } = {}) {
    this.closed = true
    const entries = [...this.active.values()]
    for (const { session } of entries) session.dispose()
    await settleResources(
      entries.map(({ session }) => this.resources.get(session)?.closing),
      strict
    )
    await settleResources([...this.closing], strict)
    this.active.clear()
  }
}
