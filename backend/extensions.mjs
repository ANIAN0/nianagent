import { replaceJson, withAcquiredLock } from "./atomic-file.mjs"
import { compactWriteReceipts } from "./write-receipt-archive.mjs"
import { mkdir, readdir, readFile, lstat, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import lockfile from "proper-lockfile"
import { validateToolArguments } from "@earendil-works/pi-ai"
import { operationError } from "./operation-issue.mjs"
import { recordedWrite, validateWriteReceipts } from "./write-receipts.mjs"

const json = (value) => JSON.stringify(value)
const hash = (value) => createHash("sha256").update(json(value)).digest("hex")
const check = (value, message) => {
  if (!value) throw new Error(message)
}
const validId = (value) =>
  typeof value === "string" &&
  /^[a-z][a-z0-9-]{0,23}$/.test(value) &&
  !["constructor", "prototype"].includes(value)
export const extensionToolName = (id, toolId) =>
  `moon_ext__${id.replaceAll("-", "_")}__${toolId.replaceAll("-", "_")}`
const issue = (code, summary, recovery = "settings") => ({
  code,
  summary,
  recovery,
  severity: "error",
})
function validateValue(schema, value, label) {
  check(
    schema?.type === "object" && schema.additionalProperties === false,
    `${label}须声明严格对象schema。`
  )
  const validated = validateToolArguments(
    { name: label, parameters: schema },
    { id: "validation", name: label, arguments: value }
  )
  // Settings/result contracts do not silently coerce strings, null or numbers.
  check(json(validated) === json(value), `${label}字段类型不符合声明。`)
  return value
}
function immutable(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable)
    Object.freeze(value)
  }
  return value
}
function awaitWithSignal(promise, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort)
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
    if (signal.aborted) abort()
  })
}
function validateManifest(manifest, directoryId) {
  check(
    manifest?.apiVersion === 1 &&
      validId(manifest.id) &&
      manifest.id === directoryId,
    "模块标识或宿主API版本无效。"
  )
  check(
    typeof manifest.name === "string" &&
      manifest.name.length > 0 &&
      manifest.name.length <= 100 &&
      typeof manifest.description === "string",
    "模块说明无效。"
  )
  check(
    /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version),
    "模块版本无效。"
  )
  check(
    manifest.configurationVersion === undefined ||
      (Number.isSafeInteger(manifest.configurationVersion) &&
        manifest.configurationVersion > 0),
    "配置协议版本无效。"
  )
  validateValue(
    manifest.configurationSchema,
    manifest.defaultConfiguration,
    "模块默认配置"
  )
  check(
    Array.isArray(manifest.tools) &&
      manifest.tools.length <= 32 &&
      Array.isArray(manifest.resultKinds) &&
      manifest.resultKinds.length <= 32,
    "能力声明过多或结构无效。"
  )
  const toolIds = new Set()
  for (const tool of manifest.tools) {
    const name = extensionToolName(manifest.id, tool.id)
    check(
      validId(tool.id) &&
        name.length <= 64 &&
        !toolIds.has(name) &&
        typeof tool.execute === "function" &&
        typeof tool.label === "string" &&
        typeof tool.description === "string" &&
        tool.parameters?.type === "object" &&
        tool.parameters.additionalProperties === false,
      "工具声明无效或标识冲突。"
    )
    check(
      !tool.executionMode ||
        ["parallel", "sequential"].includes(tool.executionMode),
      "工具执行模式无效。"
    )
    toolIds.add(name)
  }
  const resultIds = new Set()
  for (const result of manifest.resultKinds) {
    const key = `${result.kind}/${result.version}`
    check(
      typeof result.kind === "string" &&
        result.kind.startsWith("moon.") &&
        /^[A-Za-z0-9_.-]{1,100}$/.test(result.kind) &&
        Number.isSafeInteger(result.version) &&
        result.version > 0 &&
        !resultIds.has(key) &&
        result.schema?.type === "object" &&
        result.schema.additionalProperties === false,
      "结果声明无效或冲突。"
    )
    resultIds.add(key)
  }
  check(
    !manifest.createSession || typeof manifest.createSession === "function",
    "资源入口无效。"
  )
}
const moduleRoot = fileURLToPath(
  new URL("./extensions/modules/", import.meta.url)
)

// The host loads only its distributed trusted modules. Modules receive tool
// context/configuration, not Pi, SessionManager, credentials or a send API.
export class ExtensionService {
  constructor(directory, options = {}) {
    this.directory = join(directory, "extensions")
    this.file = join(this.directory, "configuration.json")
    this.moduleRoot = options.moduleRoot || moduleRoot
    this.modules = undefined
    this.contexts = new Set()
    this.loadedToolSources = new Map()
    this.runtimeIssues = new Map()
    this.closing = new Set()
    this.resourceClosers = new Set()
    this.closed = false
  }
  async discover() {
    this.modules ??= this.loadModules().catch((error) => {
      this.modules = undefined
      throw error
    })
    return this.modules
  }
  async loadModules() {
    const modules = new Map()
    let directories
    try {
      directories = await readdir(this.moduleRoot, { withFileTypes: true })
    } catch (error) {
      if (error.code !== "ENOENT")
        modules.set("host-extensions", {
          issue: issue(
            "extension_discovery",
            "扩展目录无法读取，其他内置能力仍可使用。",
            "restart"
          ),
        })
      return modules
    }
    const root = resolve(this.moduleRoot)
    try {
      check(
        !(await lstat(root)).isSymbolicLink() &&
          resolve(await realpath(root)).toLowerCase() === root.toLowerCase(),
        "扩展正式目录不能是外部链接。"
      )
    } catch {
      modules.set("host-extensions", {
        issue: issue(
          "extension_discovery",
          "扩展正式目录无效，内置能力仍可使用。",
          "restart"
        ),
      })
      return modules
    }
    const normalized = new Set()
    const resultKinds = new Set()
    for (const entry of directories.sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (!validId(entry.name)) continue
      try {
        const directory = join(root, entry.name)
        const file = join(directory, "manifest.mjs")
        check(
          entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !(await lstat(file)).isSymbolicLink() &&
            resolve(await realpath(directory)).toLowerCase() ===
              directory.toLowerCase() &&
            resolve(await realpath(file)).toLowerCase() === file.toLowerCase(),
          "模块路径不能超出正式目录。"
        )
        const { default: manifest } = await import(pathToFileURL(file).href)
        validateManifest(manifest, entry.name)
        const namespace = manifest.id.replaceAll("-", "_")
        check(!normalized.has(namespace), "模块工具命名空间重复。")
        for (const kind of manifest.resultKinds)
          check(
            !resultKinds.has(`${kind.kind}/${kind.version}`),
            "结果种类及版本重复。"
          )
        normalized.add(namespace)
        for (const kind of manifest.resultKinds)
          resultKinds.add(`${kind.kind}/${kind.version}`)
        modules.set(manifest.id, { manifest })
        for (const tool of manifest.tools)
          this.loadedToolSources.set(
            extensionToolName(manifest.id, tool.id),
            `扩展 · ${manifest.name}`
          )
      } catch {
        modules.set(entry.name, {
          issue: issue(
            "extension_invalid",
            "模块声明无法加载，请修正声明并重启 Moon。",
            "restart"
          ),
        })
      }
    }
    return modules
  }
  async document() {
    let document
    try {
      document = JSON.parse(await readFile(this.file, "utf8"))
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, modules: {} }
      throw new Error("扩展配置文件损坏或无法读取；原文件未覆盖。", {
        cause: error,
      })
    }
    check(
      document?.version === 1 &&
        document.modules &&
        typeof document.modules === "object" &&
        !Array.isArray(document.modules),
      "扩展配置结构损坏；原文件未覆盖。"
    )
    for (const [id, record] of Object.entries(document.modules))
      check(
        validId(id) &&
          record &&
          Number.isSafeInteger(record.revision) &&
          record.revision > 0 &&
          typeof record.enabled === "boolean" &&
          Number.isSafeInteger(record.configurationVersion) &&
          record.configurationVersion > 0 &&
          record.configuration &&
          typeof record.configuration === "object" &&
          !Array.isArray(record.configuration),
        "扩展配置记录损坏；原文件未覆盖。"
      )
    validateWriteReceipts(document.writeReceipts)
    return document
  }
  async mutate(change, signal) {
    check(!this.closed, "扩展服务已关闭。")
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const unlock = await lockfile.lock(this.directory, {
      realpath: false,
      retries: { retries: 30, minTimeout: 30, maxTimeout: 300 },
    })
    return withAcquiredLock(unlock, async (committed) => {
      signal?.throwIfAborted()
      const document = await this.document()
      await compactWriteReceipts(this, document, signal)
      const result = await change(document)
      check(!this.closed, "扩展服务已关闭。")
      await replaceJson(this.file, document, { signal })
      committed()
      return result
    })
  }
  receiptStore() {
    return {
      file: this.file,
      read: () => this.document(),
      update: (change, signal) => this.mutate(change, signal),
    }
  }
  descriptor(id, entry, document) {
    const manifest = entry.manifest
    const saved = document.modules[id]
    const configuration =
      saved?.configuration ?? manifest?.defaultConfiguration ?? {}
    let problem = entry.issue || this.runtimeIssues.get(id)
    if (manifest) {
      try {
        check(
          !saved ||
            saved.configurationVersion === (manifest.configurationVersion || 1),
          "配置协议需要升级。"
        )
        validateValue(manifest.configurationSchema, configuration, "模块配置")
      } catch {
        problem = issue(
          "extension_configuration",
          "保存的扩展配置与当前声明不兼容，请核对后重新保存。"
        )
      }
    }
    return {
      id,
      name: manifest?.name || id,
      description: manifest?.description || "声明未加载，其他模块仍可使用。",
      apiVersion: 1,
      version: manifest?.version || "0.0.0",
      revision: saved?.revision || 0,
      enabled: saved?.enabled || false,
      configuration: json(configuration),
      configurationSchema: json(
        manifest?.configurationSchema || {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        }
      ),
      tools: (manifest?.tools || []).map((tool) => ({
        id: extensionToolName(id, tool.id),
        name: tool.label,
        description: tool.description,
        group: `扩展 · ${manifest.name}`,
        detail: `${tool.description}\n\n参数\n${json(tool.parameters)}`,
        available: !!saved?.enabled && !problem,
        unavailableReason:
          problem?.summary || (!saved?.enabled ? "扩展已停用。" : ""),
      })),
      resultKinds: (manifest?.resultKinds || []).map((kind) => ({
        kind: kind.kind,
        version: kind.version,
        schema: json(kind.schema),
      })),
      state: problem ? "failed" : "ready",
      ...(problem ? { issue: problem } : {}),
      activeSessions: [...this.contexts].filter(
        (context) => context.id === id && !context.disposed
      ).length,
    }
  }
  async list(signal) {
    check(!this.closed, "扩展服务已关闭。")
    signal?.throwIfAborted()
    const modules = await this.discover()
    let document
    let storageIssue
    try {
      document = await this.document()
    } catch {
      document = { modules: {} }
      storageIssue = issue(
        "extension_storage",
        "扩展配置无法读取，原文件保留；内置能力仍可使用。",
        "reload"
      )
    }
    signal?.throwIfAborted()
    return [...modules].map(([id, entry]) =>
      this.descriptor(
        id,
        storageIssue ? { ...entry, issue: storageIssue } : entry,
        document
      )
    )
  }
  async configure(
    id,
    revision,
    enabled,
    configuration,
    signal,
    operationRequestId
  ) {
    return recordedWrite({
      store: this.receiptStore(),
      operation: "extensionConfigure",
      targetId: id,
      input: { id, revision, enabled, configuration },
      requestId: operationRequestId,
      signal,
      replay: async () =>
        (await this.list(signal)).find((entry) => entry.id === id),
      action: async (commit) => {
        const entry = (await this.discover()).get(id)
        check(entry?.manifest, "扩展声明失效，请修正后重启 Moon。")
        let value
        try {
          value = JSON.parse(configuration)
          validateValue(entry.manifest.configurationSchema, value, "扩展配置")
        } catch {
          throw operationError(
            "extension_configuration",
            "配置字段不符合扩展声明，请核对类型、必填项和取值范围。",
            "settings"
          )
        }
        await this.mutate((document) => {
          if ((document.modules[id]?.revision || 0) !== revision)
            throw operationError(
              "extension_revision_conflict",
              "扩展配置已更新，请重新读取后保存。",
              "reload"
            )
          document.modules[id] = {
            revision: revision + 1,
            enabled,
            configuration: value,
            configurationVersion: entry.manifest.configurationVersion || 1,
          }
          commit?.(document, revision + 1)
        }, signal)
        return (await this.list(signal)).find((entry) => entry.id === id)
      },
    })
  }
  async sessionSnapshot(toolIds) {
    const descriptors = await this.list()
    const modules = await this.discover()
    const selected = new Set(toolIds)
    const entries = descriptors
      .filter(
        (descriptor) => descriptor.enabled && descriptor.state === "ready"
      )
      .map((descriptor) => ({
        descriptor,
        manifest: modules.get(descriptor.id).manifest,
        configuration: immutable(JSON.parse(descriptor.configuration)),
        toolIds: descriptor.tools
          .filter((tool) => !toolIds || selected.has(tool.id))
          .map((tool) => tool.id),
      }))
    return {
      entries,
      descriptors,
      fingerprint: hash(
        descriptors.map(({ id, enabled, revision, configuration, state }) => ({
          id,
          enabled,
          revision,
          configuration,
          state,
        }))
      ),
    }
  }
  toolSource(name, result) {
    // Discovery is completed before constructing sessions/projections.
    if (!name.startsWith("moon_ext__")) return undefined
    const metadata = result?.details?.moonExtension
    if (
      metadata?.apiVersion === 1 &&
      validId(metadata.id) &&
      validId(metadata.toolId) &&
      extensionToolName(metadata.id, metadata.toolId) === name &&
      typeof metadata.name === "string" &&
      metadata.name.length <= 100
    )
      return `扩展 · ${metadata.name}`
    return this.loadedToolSources?.get(name) || "Moon 扩展"
  }
  factories(snapshot, cwd, persistent, owner) {
    this.loadedToolSources ??= new Map()
    return snapshot.entries.map(
      ({ descriptor, manifest, configuration, toolIds }) => {
        for (const tool of descriptor.tools)
          this.loadedToolSources.set(tool.id, tool.group)
        return {
          name: `moon-ext-${manifest.id}`,
          factory: (pi) => {
            const controller = new AbortController()
            const context = {
              id: manifest.id,
              disposed: false,
              controller,
              opening: undefined,
              initializations: new Set(),
              closing: undefined,
            }
            if (persistent && toolIds.length) this.contexts.add(context)
            const release = (initialization) =>
              (initialization.releasing ??= (async () => {
                try {
                  if (initialization.resource?.dispose)
                    await initialization.resource.dispose()
                } catch {
                  this.runtimeIssues.set(
                    manifest.id,
                    issue(
                      "extension_release_failed",
                      "扩展资源未能完整释放，请重启 Moon 后再启用。",
                      "restart"
                    )
                  )
                }
              })())
            const close = () =>
              (context.closing ??= (async () => {
                context.disposed = true
                controller.abort(
                  new DOMException("Extension session closed", "AbortError")
                )
                this.contexts.delete(context)
                const initializations = [...context.initializations]
                for (const initialization of initializations)
                  initialization.controller.abort(controller.signal.reason)
                try {
                  await Promise.allSettled(
                    initializations.map(
                      (initialization) => initialization.promise
                    )
                  )
                  await Promise.allSettled(initializations.map(release))
                } finally {
                  owner.delete(close)
                  this.resourceClosers.delete(close)
                }
              })())
            owner.add(close)
            this.resourceClosers.add(close)
            pi.on("session_shutdown", close)
            const abandon = (initialization) => {
              if (initialization.abandoned) return
              initialization.abandoned = true
              initialization.controller.abort(
                new DOMException(
                  "Extension initialization has no remaining callers",
                  "AbortError"
                )
              )
              const cleanup = initialization.promise
                .catch(() => undefined)
                .then(() => release(initialization))
                .finally(() => {
                  if (context.opening === initialization)
                    context.opening = undefined
                  context.initializations.delete(initialization)
                })
              initialization.cleanup = cleanup
              this.ownClosing(cleanup)
            }
            const resources = async (signal) => {
              // A cancelled caller leaves immediately. A shared initialization is
              // aborted only when its last waiter leaves before anyone acquired it.
              // Do not open a second resource until an abandoned predecessor closes.
              while (context.opening?.abandoned)
                await awaitWithSignal(context.opening.cleanup, signal)
              signal.throwIfAborted()
              check(
                !this.runtimeIssues.has(manifest.id),
                "扩展资源释放失败，不能重新创建。"
              )
              if (!context.opening) {
                const initialization = {
                  controller: new AbortController(),
                  waiters: new Set(),
                  acquired: false,
                  abandoned: false,
                }
                const initializationSignal = AbortSignal.any([
                  controller.signal,
                  initialization.controller.signal,
                ])
                initialization.promise = Promise.resolve()
                  .then(() => {
                    initializationSignal.throwIfAborted()
                    return manifest.createSession?.({
                      cwd,
                      configuration,
                      signal: initializationSignal,
                    })
                  })
                  .then(async (resource) => {
                    check(
                      !resource || typeof resource === "object",
                      "扩展资源入口未返回有效资源。"
                    )
                    check(
                      !resource?.dispose ||
                        typeof resource.dispose === "function",
                      "扩展资源须提供有效的释放函数。"
                    )
                    initialization.resource = resource
                    if (initializationSignal.aborted) {
                      await release(initialization)
                      throw initializationSignal.reason
                    }
                    return resource
                  })
                context.opening = initialization
                context.initializations.add(initialization)
              }
              const initialization = context.opening
              const waiter = Symbol()
              initialization.waiters.add(waiter)
              try {
                const value = await awaitWithSignal(
                  initialization.promise,
                  signal
                )
                signal.throwIfAborted()
                initialization.acquired = true
                return value
              } finally {
                initialization.waiters.delete(waiter)
                if (
                  signal.aborted &&
                  !initialization.acquired &&
                  !initialization.waiters.size
                )
                  abandon(initialization)
              }
            }
            for (const tool of manifest.tools)
              pi.registerTool({
                name: extensionToolName(manifest.id, tool.id),
                label: tool.label,
                description: tool.description,
                parameters: tool.parameters,
                ...(tool.outputSchema
                  ? { outputSchema: tool.outputSchema }
                  : {}),
                ...(tool.executionMode
                  ? { executionMode: tool.executionMode }
                  : {}),
                defaultActive: false,
                execute: async (toolCallId, args, signal, onUpdate) => {
                  const ownedSignal = signal
                    ? AbortSignal.any([signal, controller.signal])
                    : controller.signal
                  try {
                    check(
                      persistent &&
                        !this.closed &&
                        !context.disposed &&
                        !this.runtimeIssues.has(manifest.id),
                      "扩展工具不在正式活动会话中。"
                    )
                    ownedSignal.throwIfAborted()
                    const resource = await resources(ownedSignal)
                    ownedSignal.throwIfAborted()
                    const result = await tool.execute({
                      toolCallId,
                      arguments: args,
                      cwd,
                      configuration,
                      signal: ownedSignal,
                      resources: resource,
                      onUpdate,
                    })
                    ownedSignal.throwIfAborted()
                    return this.result(manifest, tool, result)
                  } catch {
                    if (ownedSignal.aborted) throw ownedSignal.reason
                    throw operationError(
                      "extension_tool_failed",
                      "扩展工具未完成，请检查原始参数及扩展配置。",
                      "settings"
                    )
                  }
                },
              })
          },
        }
      }
    )
  }
  result(manifest, tool, result) {
    check(
      result &&
        Array.isArray(result.content) &&
        result.content.length > 0 &&
        result.content.length <= 32,
      "扩展工具结果无效。"
    )
    check(
      result.content.every((part) =>
        part?.type === "text"
          ? typeof part.text === "string" && part.text.length <= 100000
          : part?.type === "image" &&
            typeof part.data === "string" &&
            part.data.length <= 12 * 1024 * 1024 &&
            typeof part.mimeType === "string"
      ),
      "扩展结果正文无效。"
    )
    if (tool.outputSchema)
      validateValue(
        tool.outputSchema,
        result.structuredContent,
        "扩展工具结构结果"
      )
    const piResult = { content: result.content }
    if (result.structuredContent !== undefined)
      piResult.structuredContent = result.structuredContent
    if (result.details !== undefined) {
      check(
        result.details &&
          typeof result.details === "object" &&
          !Array.isArray(result.details),
        "扩展结果details须是JSON对象。"
      )
      check(
        !Object.hasOwn(result.details, "moonPresentation") &&
          !Object.hasOwn(result.details, "moonExtension"),
        "moonPresentation与moonExtension为宿主保留字段，模块须使用已声明的presentation。"
      )
      const details = json(result.details)
      check(
        details && Buffer.byteLength(details) <= 65536,
        "扩展结果details无效或过大。"
      )
      piResult.details = JSON.parse(details)
    }
    const presentation = result.presentation
    if (presentation) {
      const kind = manifest.resultKinds.find(
        (entry) =>
          entry.kind === presentation.kind &&
          entry.version === presentation.version
      )
      check(kind, "扩展未声明此结果类型。")
      validateValue(kind.schema, presentation.data, "扩展展示结果")
      const payload = json(presentation.data)
      check(Buffer.byteLength(payload) <= 65536, "扩展展示结果过大。")
      piResult.details = {
        ...(piResult.details || {}),
        moonPresentation: { kind: kind.kind, version: kind.version, payload },
      }
    }
    piResult.details = {
      ...(piResult.details || {}),
      moonExtension: {
        apiVersion: 1,
        id: manifest.id,
        name: manifest.name,
        toolId: tool.id,
        version: manifest.version,
      },
    }
    return piResult
  }
  presentation(result, toolName) {
    if (
      typeof toolName !== "string" ||
      toolName.length > 64 ||
      !/^moon_ext__[a-z][a-z0-9_]{0,23}__[a-z][a-z0-9_]{0,23}$/.test(toolName)
    )
      return undefined
    const value = result?.details?.moonPresentation
    if (
      !value ||
      typeof value.kind !== "string" ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(value.kind) ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1 ||
      typeof value.payload !== "string" ||
      Buffer.byteLength(value.payload) > 65536
    )
      return undefined
    // It remains readable with a disabled/missing renderer. Current declaration
    // validates writes; historical envelopes never execute module code.
    try {
      const data = JSON.parse(value.payload)
      if (!data || typeof data !== "object" || Array.isArray(data))
        return undefined
    } catch {
      return undefined
    }
    return { kind: value.kind, version: value.version, payload: value.payload }
  }
  ownClosing(promise) {
    this.closing.add(promise)
    void promise.then(
      () => this.closing.delete(promise),
      () => this.closing.delete(promise)
    )
    return promise
  }
  async close() {
    this.closed = true
    await Promise.allSettled([...this.resourceClosers].map((close) => close()))
    await Promise.allSettled([...this.closing])
    this.contexts.clear()
  }
}
