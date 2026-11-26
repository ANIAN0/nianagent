// @ts-check
import { loadPiSdk } from "./pi-sdk.mjs"
import { closePiResources, bindPiResourceScope } from "./pi-resource-scope.mjs"

import { join } from "node:path"

import { randomUUID } from "node:crypto"

import {
  createMcpTransport,
  recordNestedMcpResult,
  safeMcpError,
} from "./mcp.mjs"
import { check } from "./session-core.mjs"

/** @param {import("./extensions.mjs").ExtensionService | undefined} extensions
 * @param {() => Awaited<ReturnType<import("./extensions.mjs").ExtensionService["sessionSnapshot"]>>} snapshot
 * @param {string} cwd
 * @param {boolean} persistent
 * @param {Set<() => Promise<void>>} closers
 * @returns {import("@earendil-works/pi-coding-agent").InlineExtension[]}
 */
function moduleFactories(extensions, snapshot, cwd, persistent, closers) {
  if (!extensions) return []
  return snapshot().entries.map(({ descriptor }) => ({
    name: `moon-ext-${descriptor.id}`,
    factory: (pi) => {
      const entry = snapshot().entries.find(
        (candidate) => candidate.descriptor.id === descriptor.id
      )
      if (entry)
        for (const factory of extensions.factories(
          { entries: [entry] },
          cwd,
          persistent,
          closers
        ))
          factory.factory(pi)
    },
  }))
}

/** Collect factory-registered Pi tool definitions with runtime precedence.
 * Lifecycle registrations belong to bound sessions.
 * @param {Pick<import("./sessions.mjs").SessionService, "agentDir" | "models" | "measure">} ports
 * @param {Awaited<ReturnType<typeof loadPiSdk>>} sdk
 * @param {string} cwd
 * @param {AbortSignal} [signal]
 */
export async function readPiToolDefinitions(ports, sdk, cwd, signal) {
  const { extensions, plugins } = ports.models
  const snapshot = await ports.measure("catalog.extensions", async () =>
    extensions
      ? await extensions.sessionSnapshot()
      : { entries: [], descriptors: [], fingerprint: "" }
  )
  signal?.throwIfAborted()
  const additionalExtensionPaths = (await plugins?.extensionPaths()) || []
  const pluginFactories = (await plugins?.factories(cwd, {})) || []
  signal?.throwIfAborted()
  const resources = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: ports.agentDir,
    settingsManager: sdk.SettingsManager.inMemory({ cacheWarming: "off" }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths,
    extensionFactories: [
      ...pluginFactories,
      ...moduleFactories(extensions, () => snapshot, cwd, false, new Set()),
    ],
  })
  await ports.measure("catalog.resources", () => resources.reload())
  signal?.throwIfAborted()
  const loaded = resources.getExtensions()
  plugins?.prepareNative(loaded)

  const builtinDefinitions = [
    sdk.createReadToolDefinition(cwd),
    sdk.createBashToolDefinition(cwd),
    sdk.createPowerShellToolDefinition(cwd),
    sdk.createEditToolDefinition(cwd),
    sdk.createWriteToolDefinition(cwd),
    sdk.createGrepToolDefinition(cwd),
    sdk.createFindToolDefinition(cwd),
    sdk.createLsToolDefinition(cwd),
  ]
  /** @type {Map<string, {
   *   definition: import("@earendil-works/pi-coding-agent").ToolDefinition,
   *   tool: { name: string, description: string, sourceInfo: { source: string, path?: string }, exposure: string }
   * }>} */
  const registered = new Map(
    builtinDefinitions.map((definition) => [
      definition.name,
      {
        definition,
        tool: {
          name: definition.name,
          description: definition.description,
          sourceInfo: { source: "builtin" },
          exposure: definition.exposure ?? "direct",
        },
      },
    ])
  )
  const names = new Set()
  // Pi takes the first extension declaration, overriding a built-in of that name.
  for (const extension of loaded.extensions)
    for (const { definition, sourceInfo } of extension.tools.values()) {
      if (names.has(definition.name)) continue
      names.add(definition.name)
      registered.set(definition.name, {
        definition,
        tool: {
          name: definition.name,
          description: definition.description,
          sourceInfo,
          exposure: definition.exposure ?? "direct",
        },
      })
    }
  return { registered: [...registered.values()], snapshot }
}

/** SDK 构建、绑定和恢复只在此边界处理，不承担配置 CAS。 */
/** @param {Pick<import("./sessions.mjs").SessionService, "ensureOpen" | "models" | "agentDir" | "closed" | "runtimePrompt" | "closing" | "availability" | "resources" | "measure">} ports
 * @param {string} cwd
 * @param {Array<{path:string,content:string}>} instructions
 * @param {string[] | undefined} toolIds
 * @param {AbortSignal} [signal]
 * @param {boolean} [recover]
 * @param {Partial<import("@earendil-works/pi-coding-agent").CreateAgentSessionOptions> & {pluginScope?: any, extensionFactories?: import("@earendil-works/pi-coding-agent").InlineExtension[], uiContext?: import("@earendil-works/pi-coding-agent").ExtensionUIContext, thinking?: NonNullable<import("@earendil-works/pi-coding-agent").CreateAgentSessionOptions>["thinkingLevel"]}} [options]
 */
export async function createPiSession(
  ports,
  cwd,
  instructions,
  toolIds,
  signal,
  recover = false,
  options = {}
) {
  ports.ensureOpen()
  signal?.throwIfAborted()
  const {
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
    SettingsManager,
    createCodemodeExtension,
    createToolSearchExtension,
    createMcpExtension,
  } = await ports.measure("adapter.importPi", () => loadPiSdk())
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" })
  const mcpEnabled = !!options.sessionManager
  const mcp = ports.models.mcp
  const mcpSdk = mcpEnabled
    ? await ports.measure(
        "create.importMcp",
        () => import("@earendil-works/pi-mcp")
      )
    : undefined
  const mcpCredentials = mcpEnabled
    ? await mcp?.runtimeCredentials()
    : undefined
  signal?.throwIfAborted()
  const mcpSnapshot = mcp
    ? await ports.measure("create.mcpSessionEntries", () =>
        mcp.sessionEntries(toolIds, cwd)
      )
    : { servers: [], errors: [] }
  const mcpTools = mcp
    ? await ports.measure("create.mcpCatalog", () => mcp.catalog(cwd))
    : []
  const extensionSnapshot = ports.models.extensions
    ? await ports.measure("create.extensions", () =>
        ports.models.extensions.sessionSnapshot(toolIds)
      )
    : { entries: [], descriptors: [], fingerprint: "" }
  const instructionState = {
    cwd,
    files: instructions,
    toolIds: toolIds ? [...toolIds] : undefined,
    mcpSnapshot,
    mcpEnabled,
    mcpStatuses: new Map(),
    mcpAvailable: new Set(
      mcpTools.filter((tool) => tool.available).map((tool) => tool.id)
    ),
    extensionSnapshot,
    extensionClosers: new Set(),
    transports: new Set(),
    disposed: false,
    generation: 0,
    pluginFingerprint: "",
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
  const loadResources = async () =>
    new DefaultResourceLoader({
      cwd,
      agentDir: ports.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: false,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths:
        (await ports.models.plugins?.extensionPaths()) || [],
      extensionFactories: [
        gates,
        ...(options.extensionFactories || []),
        ...((await ports.models.plugins?.factories(
          cwd,
          options.pluginScope || {}
        )) || []),
        ...moduleFactories(
          ports.models.extensions,
          () => instructionState.extensionSnapshot,
          cwd,
          mcpEnabled,
          instructionState.extensionClosers
        ),
        ...(mcpEnabled
          ? [
              {
                name: "moon-mcp-codemode",
                factory: createCodemodeExtension({ mode: "on" }),
              },
              {
                name: "moon-mcp-tool-search",
                factory: createToolSearchExtension(),
              },
              (pi) => {
                const generation = instructionState.generation
                return createMcpExtension({
                  loadConfig: () => instructionState.mcpSnapshot,
                  credentials: mcpCredentials,
                  logPath: join(ports.agentDir, "mcp.log"),
                  createTransport: (entry, sessionCwd, authProvider) => {
                    check(
                      !instructionState.disposed &&
                        !ports.closed &&
                        generation === instructionState.generation,
                      "会话已关闭，不再启动 MCP 服务。"
                    )
                    instructionState.mcpStatuses.set(
                      entry.scope === "project"
                        ? JSON.stringify([entry.source, entry.name])
                        : entry.name,
                      {
                        state: "connecting",
                        error: "",
                      }
                    )
                    let transport
                    try {
                      transport = createMcpTransport(
                        mcpSdk,
                        entry,
                        sessionCwd,
                        entry.scope === "project" ? undefined : authProvider,
                        (status) => {
                          if (
                            generation === instructionState.generation &&
                            !instructionState.disposed
                          )
                            instructionState.mcpStatuses.set(
                              entry.scope === "project"
                                ? JSON.stringify([entry.source, entry.name])
                                : entry.name,
                              status
                            )
                        }
                      )
                    } catch (error) {
                      instructionState.mcpStatuses.set(
                        entry.scope === "project"
                          ? JSON.stringify([entry.source, entry.name])
                          : entry.name,
                        {
                          state: "failed",
                          error: safeMcpError(
                            error,
                            entry.config,
                            mcpSdk?.McpAuthRequiredError
                          ),
                        }
                      )
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
      appendSystemPrompt: [ports.runtimePrompt(cwd)],
      agentsFilesOverride: () => ({
        agentsFiles: instructionState.files.map(({ path, content }) => ({
          path,
          content,
        })),
      }),
    })
  /** @type {import("@earendil-works/pi-coding-agent").DefaultResourceLoader | undefined} */
  let loadedResources
  // Pi 1.1 exposes cache invalidation through a previously loaded loader's
  // reload(). An empty loader performs that step without invoking old sources.
  const cacheResetLoader = new DefaultResourceLoader({
    cwd,
    agentDir: ports.agentDir,
    settingsManager: SettingsManager.inMemory({ packages: [] }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  // Pi retains this public ResourceLoader interface across session.reload().
  // Rebuild the concrete loader from current explicit sources on every reload.
  const resourceLoader = new Proxy(
    /** @type {import("@earendil-works/pi-coding-agent").DefaultResourceLoader} */ ({}),
    {
      get(_target, key) {
        if (key === "reload")
          return async (reloadOptions) => {
            await cacheResetLoader.reload()
            loadedResources = await loadResources()
            await loadedResources.reload(reloadOptions)
            ports.models.plugins?.prepareNative(
              loadedResources.getExtensions(),
              options.pluginScope
            )
            instructionState.pluginFingerprint =
              ports.models.plugins?.fingerprint() || ""
          }
        const value = Reflect.get(loadedResources, key)
        return typeof value === "function" ? value.bind(loadedResources) : value
      },
    }
  )
  let session
  try {
    await ports.measure("create.resources", () => resourceLoader.reload())
    signal?.throwIfAborted()
    const modelRuntime =
      options.modelRuntime ||
      (await ports.measure("create.modelRuntime", () => ports.models.runtime()))
    signal?.throwIfAborted()
    ;({ session } = await ports.measure("create.createSession", () =>
      createAgentSession({
        cwd,
        agentDir: ports.agentDir,
        settingsManager,
        resourceLoader,
        sessionManager: options.sessionManager || SessionManager.inMemory(cwd),
        modelRuntime,
        ...(options.model ? { model: options.model } : {}),
        ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
      })
    ))
  } catch (error) {
    instructionState.disposed = true
    await closePiResources(instructionState)
    throw error
  }
  bindPiResourceScope(session, instructionState, {
    isClosed: () => ports.closed,
    unregister: () => mcp?.runtime.delete(owner),
    ownClosing: (closing) => {
      ports.models.extensions?.ownClosing(closing)
      ports.closing.add(closing)
      void closing.finally(() => ports.closing.delete(closing))
    },
  })
  try {
    ports.ensureOpen()
    signal?.throwIfAborted()
    if (mcpEnabled) mcp?.runtime.set(owner, instructionState.mcpStatuses)
    await ports.measure("create.bindExtensions", () =>
      session.bindExtensions({
        ...(options.uiContext
          ? { uiContext: options.uiContext, mode: "rpc" }
          : {}),
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
    )
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
            : available.has(name)) && !ports.availability(name, session)
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
          .filter((name) => !ports.availability(name, session))
      )
    ports.resources.set(session, instructionState)
    return session
  } catch (error) {
    try {
      session.dispose()
    } catch {
      // 释放失败不掩盖创建/绑定首因（T20 首因语义）；disposed 已置位，不重复释放
    }
    // closing 由 dispose 的 finally 置位且 closePiResources 以 allSettled 收敛，不会 reject
    await instructionState.closing
    throw error
  }
}
