// @ts-check
import { closePiResources, bindPiResourceScope } from "./pi-resource-scope.mjs"

import { join } from "node:path"

import { randomUUID } from "node:crypto"

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createCodemodeExtension,
  createToolSearchExtension,
  createMcpExtension,
} from "@earendil-works/pi-coding-agent"

import {
  createMcpTransport,
  recordNestedMcpResult,
  safeMcpError,
} from "./mcp.mjs"
import { check } from "./session-core.mjs"

/** SDK 构建、绑定和恢复只在此边界处理，不承担配置 CAS。 */
/** @param {Pick<import("./sessions.mjs").SessionService, "ensureOpen" | "models" | "agentDir" | "closed" | "runtimePrompt" | "closing" | "availability" | "resources">} ports
 * @param {string} cwd
 * @param {Array<{path:string,content:string}>} instructions
 * @param {string[] | undefined} toolIds
 * @param {AbortSignal} [signal]
 * @param {boolean} [recover]
 * @param {Partial<Parameters<typeof createAgentSession>[0]> & {extensionFactories?: import("@earendil-works/pi-coding-agent").InlineExtension[], uiContext?: import("@earendil-works/pi-coding-agent").ExtensionUIContext, thinking?: NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"]}} [options]
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
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" })
  const mcpEnabled = !!options.sessionManager
  const mcp = ports.models.mcp
  const mcpSnapshot = mcp
    ? await mcp.sessionEntries(toolIds)
    : { servers: [], errors: [] }
  const mcpTools = mcp ? await mcp.catalog() : []
  const extensionSnapshot = ports.models.extensions
    ? await ports.models.extensions.sessionSnapshot(toolIds)
    : { entries: [], descriptors: [], fingerprint: "" }
  const instructionState = {
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
    agentDir: ports.agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: false,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      gates,
      ...(options.extensionFactories || []),
      ...extensionSnapshot.descriptors.map((descriptor) => ({
        name: `moon-ext-${descriptor.id}`,
        factory: (pi) => {
          const entry = instructionState.extensionSnapshot.entries.find(
            (candidate) => candidate.descriptor.id === descriptor.id
          )
          if (entry)
            for (const factory of ports.models.extensions.factories(
              { entries: [entry] },
              cwd,
              mcpEnabled,
              instructionState.extensionClosers
            ))
              factory.factory(pi)
        },
      })),
      ...(mcpEnabled
        ? [
            createCodemodeExtension({ mode: "on" }),
            createToolSearchExtension(),
            (pi) => {
              const generation = instructionState.generation
              return createMcpExtension({
                loadConfig: () => instructionState.mcpSnapshot,
                credentials: mcp?.credentials,
                logPath: join(ports.agentDir, "mcp.log"),
                createTransport: (entry, sessionCwd, authProvider) => {
                  check(
                    !instructionState.disposed &&
                      !ports.closed &&
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
    appendSystemPrompt: [ports.runtimePrompt(cwd)],
    agentsFilesOverride: () => ({
      agentsFiles: instructionState.files.map(({ path, content }) => ({
        path,
        content,
      })),
    }),
  })
  let session
  try {
    await resourceLoader.reload()
    signal?.throwIfAborted()
    ;({ session } = await createAgentSession({
      cwd,
      agentDir: ports.agentDir,
      settingsManager,
      resourceLoader,
      sessionManager: options.sessionManager || SessionManager.inMemory(cwd),
      modelRuntime: options.modelRuntime || (await ports.models.runtime()),
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
    }))
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
    await session.bindExtensions({
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
            : available.has(name)) && !ports.availability(name)
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
        session.getActiveToolNames().filter((name) => !ports.availability(name))
      )
    ports.resources.set(session, instructionState)
    return session
  } catch (error) {
    session.dispose()
    await instructionState.closing
    throw error
  }
}
