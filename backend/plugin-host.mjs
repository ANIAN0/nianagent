import { mkdir, readFile, readdir, stat } from "node:fs/promises"
import { join, resolve, isAbsolute } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { validateToolArguments } from "@earendil-works/pi-ai"
import { replaceJson, withAcquiredLock } from "./atomic-file.mjs"
import lockfile from "proper-lockfile"
import {
  requestContext,
  registerRemoteContextResolver,
} from "./request-context.mjs"

const root = fileURLToPath(new URL("./plugins/", import.meta.url))
// This process's module cache outlives an import record. Removing a record must
// not erase the fact that Node has already executed that same physical source.
const executedSources = new Set()
const identifier = /^[a-z][a-z0-9-]{0,63}$/
const check = (value, message) => {
  if (!value) throw new Error(message)
}
const safeError = (error) =>
  /[\u4e00-\u9fff]/u.test(error?.message || "")
    ? error.message
    : "插件操作失败，请核对来源并重新读取。"
export function validatePluginValue(schema, value) {
  check(
    schema?.type === "object" && schema.additionalProperties === false,
    "插件操作须声明严格对象schema。"
  )
  validateToolArguments(
    { name: "plugin", parameters: schema },
    { id: "validation", name: "plugin", arguments: structuredClone(value) }
  )
  return value
}
const bounded = async (promise) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("插件资源释放超时，请重启Moon。")),
          15000
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Generic app/Pi/web assembly. Tool definitions belong to native Pi modules. */
export class PluginHost {
  constructor(directory, ports, pluginRoot = root) {
    this.directory = join(directory, "plugins")
    this.file = join(this.directory, "configuration.json")
    this.root = pluginRoot
    this.ports = ports
    this.entries = new Map()
    this.toolOwners = new Map()
    this.closed = false
    this.frozen = false
    this.changing = false
  }
  async document() {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8"))
      check(
        value.version === 1 &&
          value.entries &&
          typeof value.entries === "object" &&
          !Array.isArray(value.entries),
        "插件配置损坏，原文件保留；内置能力仍可使用。"
      )
      value.imports ??= []
      check(
        Array.isArray(value.imports) &&
          value.imports.every(
            (item) =>
              identifier.test(item.id) &&
              typeof item.source === "string" &&
              ["local", "npm", "git"].includes(item.sourceKind)
          ),
        "已导入插件记录损坏，原文件保留。"
      )
      return value
    } catch (error) {
      if (error.code === "ENOENT")
        return { version: 1, entries: {}, imports: [] }
      throw error
    }
  }
  async discover() {
    this.discovery ??= this.load().catch((error) => {
      this.discovery = undefined
      throw error
    })
    await this.discovery
  }
  entry(id, source, sourceKind) {
    return {
      id,
      source,
      sourceKind,
      installed: sourceKind === "bundled" || sourceKind === "local",
      enabled: false,
      revision: 0,
      generation: 0,
      state: "disabled",
      error: "",
      configuration: "{}",
      leases: new Set(),
      tools: new Map(),
    }
  }
  async load() {
    let configuration
    try {
      configuration = await this.document()
    } catch (error) {
      this.storageError = safeError(error)
      configuration = { entries: {}, imports: [] }
    }
    const directories = await readdir(this.root, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === "ENOENT") return []
        throw error
      }
    )
    for (const directory of directories.filter(
      (item) => item.isDirectory() && identifier.test(item.name)
    )) {
      const entry = this.entry(
        directory.name,
        join(this.root, directory.name),
        "bundled"
      )
      this.entries.set(entry.id, entry)
      try {
        const manifest = JSON.parse(
          await readFile(join(entry.source, "manifest.json"), "utf8")
        )
        check(
          manifest.id === entry.id &&
            manifest.sdkVersion === "1.1.0" &&
            manifest.apiVersion === 2 &&
            typeof manifest.name === "string" &&
            typeof manifest.version === "string",
          "插件身份或SDK版本无效。"
        )
        check(
          manifest.entries &&
            Object.entries(manifest.entries).every(
              ([kind, path]) =>
                ["app", "pi", "web"].includes(kind) &&
                typeof path === "string" &&
                !isAbsolute(path) &&
                !path.split(/[\\/]/).includes("..")
            ),
          "插件入口无效。"
        )
        check(
          !manifest.tools,
          "工具应由Pi原生factory注册，清单不重复声明工具。"
        )
        entry.manifest = manifest
        const saved = configuration.entries[entry.id]
        entry.enabled = this.storageError
          ? false
          : (saved?.enabled ?? manifest.defaultEnabled ?? false)
        entry.revision = saved?.revision ?? 0
        entry.configuration =
          saved?.configuration ??
          JSON.stringify(manifest.defaultConfiguration ?? {})
        validatePluginValue(
          manifest.configurationSchema,
          JSON.parse(entry.configuration)
        )
        check(
          typeof entry.enabled === "boolean" &&
            Number.isSafeInteger(entry.revision),
          "插件保存配置无效。"
        )
        if (this.storageError) {
          entry.state = "failed"
          entry.error = this.storageError
        }
      } catch (error) {
        entry.state = "failed"
        entry.error = safeError(error)
      }
    }
    for (const imported of configuration.imports) {
      const entry = this.entry(
        imported.id,
        imported.source,
        imported.sourceKind
      )
      Object.assign(entry, configuration.entries[entry.id] || {})
      entry.manifest = {
        name: imported.name || imported.source,
        description: "显式导入的Pi原生扩展",
        version: "未提供",
        entries: {},
        configurationSchema: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      }
      this.entries.set(entry.id, entry)
      await this.resolveImport(entry).catch((error) => {
        entry.state = "failed"
        entry.error = safeError(error)
      })
    }
  }
  manager(sources = []) {
    return new DefaultPackageManager({
      cwd: this.directory,
      agentDir: join(this.directory, "pi"),
      settingsManager: SettingsManager.inMemory({ packages: sources }),
    })
  }
  async resolveImport(entry) {
    const manager = this.manager()
    const path =
      entry.sourceKind === "local"
        ? entry.source
        : await manager.getInstalledPath(entry.source, "user")
    // resolveExtensionSources installs missing packages by default. Never use it
    // before verifying explicit installation; listing/enabling is not install.
    check(
      path &&
        (await stat(path).then(
          () => true,
          () => false
        )),
      "插件来源不存在或尚未安装，请明确安装后再启用。"
    )
    const resolved = await manager.resolveExtensionSources([path], {
      temporary: true,
    })
    entry.paths = resolved.extensions
      .filter((item) => item.enabled)
      .map((item) => item.path)
    check(entry.paths.length > 0, "该来源没有可加载的Pi扩展入口。")
    if (
      !entry.loadedSignature &&
      entry.paths.some((path) => executedSources.has(path))
    )
      entry.restartRequired = true
    entry.sourceSignature = JSON.stringify(
      await Promise.all(
        entry.paths.map(async (path) => {
          const metadata = await stat(path)
          return [path, metadata.size, metadata.mtimeMs]
        })
      )
    )
    if (
      entry.loadedSignature &&
      entry.loadedSignature !== entry.sourceSignature &&
      entry.paths.some((path) => /\.(?:m?js|cjs)$/i.test(path))
    )
      entry.restartRequired = true
    entry.installed = true
    const manifestPath = (await stat(path)).isDirectory()
      ? join(path, "package.json")
      : join(resolve(path, ".."), "package.json")
    try {
      const metadata = JSON.parse(await readFile(manifestPath, "utf8"))
      entry.manifest.version = metadata.version || "未提供"
    } catch {
      /* Single-file imports need not have package metadata. */
    }
  }
  async initialize() {
    await this.discover()
    await Promise.allSettled(
      [...this.entries.values()]
        .filter((entry) => entry.enabled && entry.manifest)
        .map((entry) => this.start(entry))
    )
  }
  async start(entry) {
    if (entry.starting) return entry.starting
    if (
      entry.state !== "disabled" ||
      entry.application ||
      entry.closing ||
      entry.stopping ||
      !entry.enabled ||
      this.closed ||
      this.frozen
    )
      return
    entry.state = "loading"
    entry.generation++
    const generation = entry.generation
    const configuration = entry.configuration
    const current = () =>
      entry.generation === generation &&
      entry.state === "loading" &&
      entry.enabled &&
      entry.configuration === configuration &&
      !this.closed &&
      !this.frozen
    const inactive = () => {
      if (current()) return false
      if (entry.generation === generation && entry.state === "loading")
        entry.state = "disabled"
      return true
    }
    const starting = (async () => {
      let application
      try {
        if (entry.sourceKind !== "bundled") await this.resolveImport(entry)
        check(
          !entry.restartRequired,
          "来源已更新，但Pi当前进程可能仍缓存旧JavaScript模块；请重启Moon后启用，当前未应用新代码。"
        )
        if (inactive()) return
        const app = entry.manifest.entries.app
        if (app) {
          const module = await import(
            pathToFileURL(join(entry.source, app)).href
          )
          const directory = join(this.directory, entry.id)
          await mkdir(directory, { recursive: true })
          if (inactive()) return
          application = await module.activate({
            directory,
            configuration: JSON.parse(configuration),
            generation,
            dispatch: this.ports.dispatch,
            services: this.ports.services,
            registerRemoteContextResolver,
            isActive: () =>
              entry.generation === generation &&
              entry.enabled &&
              entry.state === "active" &&
              !this.closed &&
              !this.frozen,
            lease: (action) => this.lease(entry, action),
          })
          check(
            application && typeof application.close === "function",
            "应用入口须声明实际资源释放方法。"
          )
        }
        if (!current()) {
          await application?.close()
          application = undefined
          if (entry.generation === generation) entry.state = "disabled"
          return
        }
        entry.application = application
        entry.applicationGeneration = generation
        entry.state = "active"
        entry.error = ""
      } catch (error) {
        let failure = error
        try {
          await application?.close()
          application = undefined
        } catch (cleanup) {
          // Keep the actual late instance reachable for the next close attempt.
          entry.application = application
          entry.applicationGeneration = generation
          failure = new AggregateError(
            [error, cleanup],
            "插件启动后的资源释放未确认，请重启Moon。",
            { cause: cleanup }
          )
        }
        if (entry.generation !== generation && !application) return
        entry.state = "failed"
        entry.error = safeError(failure)
        if (application) throw failure
      }
    })()
    entry.starting = starting
    try {
      await starting
    } finally {
      if (entry.starting === starting) entry.starting = undefined
    }
  }
  descriptor(entry) {
    return {
      id: entry.id,
      name: entry.manifest?.name || entry.id,
      description: entry.manifest?.description || "插件清单无法读取",
      version: entry.manifest?.version || "未提供",
      source: entry.source,
      sourceKind: entry.sourceKind,
      installed: entry.installed,
      enabled: entry.enabled,
      revision: entry.revision,
      generation: entry.generation,
      state: entry.state,
      businessState: entry.application?.status?.() || "",
      error: entry.error,
      configuration: entry.configuration,
      configurationSchema: JSON.stringify(
        entry.manifest?.configurationSchema || {
          type: "object",
          properties: {},
          additionalProperties: false,
        }
      ),
      contributions: entry.manifest?.contributions || [],
      tools: [...entry.tools.values()].map((tool) => ({
        id: tool.name,
        name: tool.label || tool.name,
        description: tool.description || "",
        detail: tool.description || "",
        group: entry.manifest.name,
        available: entry.state === "active" && !entry.conflicts?.has(tool.name),
        unavailableReason: entry.conflicts?.has(tool.name)
          ? "同名工具由Pi更早注册的来源提供，此实现未生效。"
          : entry.state === "active"
            ? ""
            : "所属插件未启用或加载失败。",
      })),
    }
  }
  async list(signal) {
    signal?.throwIfAborted()
    await this.initialize()
    const legacy = await this.ports.services().extensions.list(signal)
    return [...this.entries.values()]
      .map((entry) => this.descriptor(entry))
      .concat(
        legacy.map((item) => ({
          id: `legacy-${item.id}`,
          name: item.name,
          description: item.description,
          version: item.version,
          source: item.id,
          sourceKind: "legacy",
          installed: true,
          enabled: item.enabled,
          revision: item.revision,
          generation: 0,
          state:
            item.state === "ready"
              ? item.enabled
                ? "active"
                : "disabled"
              : "failed",
          businessState: "API 1 兼容扩展",
          error: item.issue?.message || "",
          configuration: item.configuration,
          configurationSchema: item.configurationSchema,
          contributions: [],
          tools: item.tools,
        }))
      )
  }
  assertRunAllowed() {
    check(
      !this.changing && !this.frozen && !this.closed,
      "插件正在变更或维护，请完成后再开始执行。"
    )
  }
  captureRequestContext(context, sessionId) {
    if (!sessionId) return context
    return {
      ...context,
      targets: Object.fromEntries(
        [...this.entries.values()]
          .filter(
            (entry) =>
              entry.state === "active" && entry.application?.captureTarget
          )
          .map((entry) => [
            entry.id,
            entry.application.captureTarget(context, sessionId),
          ])
      ),
    }
  }
  async mutate(action, signal, idle = true) {
    check(
      requestContext().source === "local",
      "forbidden：插件管理仅本机可用。"
    )
    check(
      !this.changing && !this.closed && !this.frozen,
      "插件正在变更，请重新读取。"
    )
    if (idle) this.ports.assertIdle()
    this.changing = true
    try {
      signal?.throwIfAborted()
      await mkdir(this.directory, { recursive: true })
      const unlock = await lockfile.lock(this.file, {
        realpath: false,
        retries: 5,
      })
      return await withAcquiredLock(unlock, async (committed) => {
        const document = await this.document()
        const result = await action(document)
        await replaceJson(this.file, document, { signal })
        committed()
        return result
      })
    } finally {
      this.changing = false
    }
  }
  async configure(id, revision, enabled, configuration, signal) {
    await this.discover()
    if (id.startsWith("legacy-")) {
      check(
        requestContext().source === "local",
        "forbidden：插件管理仅本机可用。"
      )
      check(
        !this.changing && !this.frozen && !this.closed,
        "插件正在变更或维护。"
      )
      this.ports.assertIdle()
      this.changing = true
      try {
        await this.ports
          .services()
          .extensions.configure(
            id.slice(7),
            revision,
            enabled,
            configuration,
            signal
          )
      } finally {
        this.changing = false
      }
      return (await this.list(signal)).find((item) => item.id === id)
    }
    const entry = this.entries.get(id)
    check(entry?.manifest, "插件清单无效。")
    // A failed plugin can be disabled without rewriting its damaged saved
    // configuration. New configuration and every enable still validate fully.
    if (enabled || configuration !== entry.configuration)
      validatePluginValue(
        entry.manifest.configurationSchema,
        JSON.parse(configuration)
      )
    await this.mutate(
      async (document) => {
        check(
          (document.entries[id]?.revision || 0) === revision,
          "插件配置已变化，请重新读取。"
        )
        if (enabled && entry.sourceKind !== "bundled")
          await this.resolveImport(entry)
        await this.stop(entry)
        document.entries[id] = {
          enabled,
          configuration,
          revision: revision + 1,
        }
      },
      signal,
      !!entry.manifest.entries.pi || entry.sourceKind !== "bundled"
    )
    Object.assign(entry, {
      enabled,
      configuration,
      revision: revision + 1,
      error: "",
      state: "disabled",
    })
    if (enabled) await this.start(entry)
    return this.descriptor(entry)
  }
  async add(source, signal) {
    await this.discover()
    source = source.trim()
    const sourceKind = this.manager().parseSource(source).type
    if (sourceKind === "local") {
      check(isAbsolute(source), "本地导入须使用实际绝对路径。")
      await stat(source)
    }
    const entry = this.entry(`pi-${randomUUID()}`, source, sourceKind)
    entry.manifest = {
      name: source,
      description: "显式导入的Pi扩展",
      version: "未提供",
      entries: {},
      configurationSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    }
    await this.mutate(async (document) => {
      check(
        !document.imports.some((item) => item.source === source),
        "该来源已导入。"
      )
      document.imports.push({ id: entry.id, source, sourceKind })
      document.entries[entry.id] = {
        enabled: false,
        configuration: "{}",
        revision: 0,
      }
    }, signal)
    this.entries.set(entry.id, entry)
    if (sourceKind === "local")
      await this.resolveImport(entry).catch((error) => {
        entry.state = "failed"
        entry.error = safeError(error)
      })
    return this.descriptor(entry)
  }
  async packageAction(id, action, signal) {
    await this.discover()
    const entry = this.entries.get(id)
    check(
      entry && ["local", "npm", "git"].includes(entry.sourceKind),
      "只能管理明确导入的来源。"
    )
    await this.mutate(async (document) => {
      await this.stop(entry)
      if (action === "remove") {
        if (entry.sourceKind !== "local" && entry.installed)
          await this.manager().remove(entry.source)
        document.imports = document.imports.filter((item) => item.id !== id)
        delete document.entries[id]
      } else {
        check(
          entry.sourceKind !== "local",
          "本地文件直接引用原路径，由外部编辑器更新。"
        )
        const manager = this.manager([entry.source])
        if (action === "update") await manager.update(entry.source)
        else await manager.install(entry.source)
        await this.resolveImport(entry)
        // Node's ESM module cache also covers imported dependencies. A package
        // already executed in this host cannot truthfully promise hot replacement.
        if (action === "update" && entry.loadedSignature)
          entry.restartRequired = true
      }
    }, signal).catch((error) => {
      entry.state = "failed"
      entry.error = safeError(error)
      throw error
    })
    if (action === "remove") {
      this.entries.delete(id)
      for (const [name, owner] of this.toolOwners)
        if (owner === entry) this.toolOwners.delete(name)
    } else {
      entry.state = "disabled"
      entry.error = ""
      if (entry.enabled) await this.start(entry)
    }
    return this.list(signal)
  }
  async lease(entry, action) {
    check(
      entry.state === "active" && !this.closed && !this.frozen,
      "插件已停用或正在释放。"
    )
    const pending = Promise.resolve().then(action)
    entry.leases.add(pending)
    try {
      return await pending
    } finally {
      entry.leases.delete(pending)
    }
  }
  releaseApplication(entry, action) {
    const application = entry.application
    if (!application) return Promise.resolve()
    const field = action === "close" ? "closing" : "quiescing"
    const previous = entry[field]
    // A timeout does not settle the underlying release. Wait for that same
    // instance until it confirms completion; only an explicit rejection retries.
    if (previous?.application === application && previous.state !== "rejected")
      return previous.promise
    const release = {
      application,
      generation: entry.applicationGeneration,
      state: "pending",
    }
    release.promise = Promise.resolve().then(() => application[action]?.())
    entry[field] = release
    void release.promise.then(
      () => {
        release.state = "fulfilled"
      },
      () => {
        release.state = "rejected"
      }
    )
    return release.promise
  }
  async stop(entry) {
    if (entry.stopping) return entry.stopping
    entry.state = "stopping"
    entry.generation++
    const stopping = (async () => {
      const application = entry.application
      const closing = this.releaseApplication(entry, "close")
      const quiesced = this.releaseApplication(entry, "quiesce")
      try {
        await bounded(
          (async () => {
            const settled = await Promise.allSettled([
              closing,
              quiesced,
              entry.starting,
              ...entry.leases,
            ])
            const releases = settled.slice(0, 3)
            // activate may finish after stop began. Its failed cleanup must remain
            // owned and must also be confirmed before this entry can be disabled.
            if (entry.application && entry.application !== application) {
              releases.push(
                ...(await Promise.allSettled([
                  this.releaseApplication(entry, "close"),
                  this.releaseApplication(entry, "quiesce"),
                ]))
              )
            }
            const failures = releases.filter(
              (result) => result.status === "rejected"
            )
            if (failures.length)
              throw new AggregateError(
                failures.map((result) => result.reason),
                "插件资源释放未确认，请重新停用；仍未确认时请重启Moon。"
              )
          })()
        )
        entry.application = undefined
        entry.applicationGeneration = undefined
        entry.closing = undefined
        entry.quiescing = undefined
        entry.state = "disabled"
        entry.error = ""
      } catch (error) {
        entry.state = "failed"
        entry.error = safeError(error)
        throw error
      }
    })()
    entry.stopping = stopping
    try {
      return await stopping
    } finally {
      if (entry.stopping === stopping) entry.stopping = undefined
    }
  }
  async context(sessionId, signal, base = requestContext()) {
    signal?.throwIfAborted()
    if (!sessionId) return Object.freeze({ ...base })
    return Object.freeze({
      ...base,
      ...(await this.ports.authorizeSession(sessionId, base)),
    })
  }
  async call(id, operation, payload, sessionId, generation, signal) {
    await this.initialize()
    const entry = this.entries.get(id)
    check(entry?.state === "active", "请先启用插件。")
    check(
      generation === undefined || generation === entry.generation,
      "插件已重新激活，请重新读取。"
    )
    const definition = entry.application?.operations?.[operation]
    check(definition, "插件未注册此操作。")
    const context = await this.context(sessionId, signal)
    check(
      context.source !== "remote" || definition.remote === true,
      "forbidden：此操作仅本机可用。"
    )
    check(
      definition.scope !== "session" || context.sessionId,
      "此操作需要真实会话。"
    )
    const input = validatePluginValue(definition.input, JSON.parse(payload))
    const result = await this.lease(entry, () =>
      definition.execute(input, context, signal)
    )
    validatePluginValue(definition.output, result)
    // A 2MiB UTF-8 page can expand to 12MiB in JSON (control characters).
    // This bound includes that encoding; source-page limits remain unchanged.
    check(
      Buffer.byteLength(JSON.stringify(result)) <= 16 * 1024 * 1024,
      "插件返回超过编码后传输上限。"
    )
    return { payload: JSON.stringify(result), generation: entry.generation }
  }
  async extensionPaths() {
    await this.initialize()
    return [...this.entries.values()]
      .filter((entry) => entry.state === "active")
      .flatMap((entry) => entry.paths || [])
  }
  async factories(cwd, scope) {
    await this.initialize()
    return [...this.entries.values()]
      .filter((entry) => entry.state === "active" && entry.manifest.entries.pi)
      .map((entry) => ({
        name: `moon-plugin-${entry.id}`,
        factory: async (pi) => {
          const generation = entry.generation
          const module = await import(
            pathToFileURL(join(entry.source, entry.manifest.entries.pi)).href
          )
          const native = new Proxy(pi, {
            get: (target, key) =>
              key === "registerTool"
                ? (definition) => {
                    entry.tools.set(definition.name, definition)
                    const policy = module.toolPolicy?.(definition.name)
                    if (policy)
                      (entry.policies ??= new Map()).set(
                        definition.name,
                        policy
                      )
                    target.registerTool({
                      ...definition,
                      execute: async (...args) => {
                        check(
                          entry.generation === generation,
                          "插件配置已变化，请在空闲时重新加载会话。"
                        )
                        return this.lease(entry, async () => {
                          const result = await definition.execute(...args)
                          return {
                            ...result,
                            details: {
                              ...result.details,
                              moonPlugin: { id: entry.id, generation },
                            },
                          }
                        })
                      },
                    })
                  }
                : Reflect.get(target, key),
          })
          await module.default(native, {
            application: entry.application,
            cwd,
            context: () =>
              this.context(
                scope.sessionId,
                undefined,
                scope.clientContext?.() || requestContext()
              ),
            scope,
          })
        },
      }))
  }
  observeNative(result) {
    const winners = new Map()
    this.toolOwners.clear()
    for (const extension of result.extensions) {
      const entry = [...this.entries.values()].find(
        (entry) =>
          entry.paths?.includes(extension.path) ||
          entry.paths?.includes(extension.resolvedPath) ||
          extension.path === `<inline:moon-plugin-${entry.id}>`
      )
      if (entry && entry.sourceKind !== "bundled") {
        entry.loadedSignature = entry.sourceSignature
        for (const path of entry.paths || []) executedSources.add(path)
      }
      for (const [name, tool] of extension.tools) {
        if (entry) entry.tools.set(name, tool.definition)
        if (winners.has(name)) {
          if (entry) (entry.conflicts ??= new Set()).add(name)
          continue
        }
        if (entry) {
          entry.conflicts?.delete(name)
          this.toolOwners.set(name, entry)
        }
        winners.set(name, {
          definition: tool.definition,
          entry,
          external: true,
          origin: extension.path,
          source: entry?.manifest.name || "Pi扩展",
          ...entry?.policies?.get(name),
        })
      }
    }
    for (const failure of result.errors) {
      const entry = [...this.entries.values()].find(
        (entry) =>
          entry.paths?.includes(failure.path) ||
          failure.path === `<inline:moon-plugin-${entry.id}>`
      )
      if (entry) {
        entry.state = "failed"
        entry.error = "Pi原生扩展加载失败，请核对来源与版本。"
      }
    }
    return winners
  }
  currentTool(tool, definition) {
    if (!tool || tool.sourceInfo?.source === "builtin") return
    const origin = tool.sourceInfo?.path
    const entry = [...this.entries.values()].find(
      (candidate) =>
        candidate.paths?.includes(origin) ||
        origin === `<inline:moon-plugin-${candidate.id}>`
    )
    return {
      definition,
      entry,
      external: true,
      origin,
      source: entry?.manifest.name || "Pi扩展",
      ...entry?.policies?.get(tool.name),
    }
  }
  toolEffect(name) {
    const entry = this.toolOwners.get(name)
    if (entry)
      return {
        ...entry.policies?.get(name),
        available: entry.state === "active",
      }
  }
  toolSource(name, result) {
    return (
      this.entries.get(result?.details?.moonPlugin?.id) ||
      this.toolOwners.get(name)
    )?.manifest.name
  }
  presentation(result, name) {
    const entry =
      this.entries.get(result?.details?.moonPlugin?.id) ||
      this.toolOwners.get(name)
    const value = result?.details?.moonPresentation
    if (
      entry?.manifest.contributions?.some(
        (item) =>
          item.kind === "result" &&
          item.id === value?.kind &&
          item.version === value?.version
      ) &&
      typeof value.payload === "string" &&
      value.payload.length <= 65536
    )
      return value
  }
  fingerprint() {
    return JSON.stringify(
      [...this.entries.values()].map((entry) => [
        entry.id,
        entry.generation,
        entry.state,
        entry.revision,
        entry.manifest?.version,
      ])
    )
  }
  async close({ strict = false } = {}) {
    this.closed = true
    const results = await Promise.allSettled(
      [...this.entries.values()].reverse().map((entry) => this.stop(entry))
    )
    if (strict && results.some((result) => result.status === "rejected"))
      throw new Error("插件资源释放未确认，请重启Moon。")
  }
  async freeze() {
    this.frozen = true
    const results = await Promise.allSettled(
      [...this.entries.values()].flatMap((entry) => [
        Promise.resolve().then(() => entry.application?.quiesce?.()),
        entry.starting,
      ])
    )
    if (results.some((result) => result.status === "rejected"))
      throw new Error("插件维护准备的资源释放未确认，请重启Moon。")
  }
  async resume() {
    for (const entry of this.entries.values())
      await entry.application?.resume?.()
    this.frozen = false
    await this.initialize()
  }
}
