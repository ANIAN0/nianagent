import { loadPiSdk } from "./pi-sdk.mjs"
import { existsSync } from "node:fs"
import {
  mkdir,
  readFile,
  readdir,
  stat,
  realpath,
  writeFile,
} from "node:fs/promises"
import {
  join,
  resolve,
  isAbsolute,
  relative,
  sep,
  dirname,
  extname,
} from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHash, randomUUID } from "node:crypto"
import { replaceJson, withAcquiredLock } from "./atomic-file.mjs"
import lockfile from "proper-lockfile"
import { createWorkbenchSupervisor } from "./loopback-host.mjs"
import { ActivityLog } from "./activity-log.mjs"
import { operationError } from "./operation-issue.mjs"
import { check, identifier, safeError, samePath } from "./plugin-primitives.mjs"
import { createSharedToolGateway } from "./plugin-shared-tools.mjs"
import {
  requestContext,
  currentTraceId,
  registerRemoteContextResolver,
} from "./request-context.mjs"

const root = fileURLToPath(new URL("./plugins/", import.meta.url))
// This process's module cache outlives an import record. Removing a record must
// not erase the fact that Node has already executed that same physical source.
const executedSources = new Set()
const bounded = async (
  promise,
  limit = 15000,
  message = "插件资源释放超时，请重启Moon。"
) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), limit)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const workbenchModules = new Map([
  ["notes-workbench", "notes"],
  ["skill-workbench", "skills"],
])

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
    // 每插件至多一个包任务记录：运行中防并发，终态保留供 packageStatus 查询。
    this.packageTasks = new Map()
    this.logs = new ActivityLog(directory)
    this.workbench = createWorkbenchSupervisor(this.directory, this.logs)
    // G16 拆分：共享工具网关（②）独立模块；宿主仅保留薄委托
    this.sharedToolGateway = createSharedToolGateway({
      entries: this.entries,
      logs: this.logs,
      lease: (entry, action) => this.lease(entry, action),
    })
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
      operationCalls: new Set(),
      sharedCalls: new Set(),
      sharedPending: new Set(),
      tools: new Map(),
      registrations: { events: [], commands: [], providers: [] },
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
      const source = join(this.root, directory.name)
      // 没有 manifest 的目录不是插件（如未完成的占位目录），不产生失败条目。
      if (!existsSync(join(source, "manifest.json"))) continue
      const entry = this.entry(directory.name, source, "bundled")
      try {
        const manifest = JSON.parse(
          await readFile(join(entry.source, "manifest.json"), "utf8")
        )
        if (manifest?.bundled === false) continue
        check(
          manifest.id === entry.id &&
            manifest.apiVersion === 1 &&
            typeof manifest.name === "string" &&
            typeof manifest.version === "string",
          "插件身份或Moon接口版本无效。"
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
        check(
          manifest.activationTimeout === undefined ||
            (Number.isSafeInteger(manifest.activationTimeout) &&
              manifest.activationTimeout >= 1000 &&
              manifest.activationTimeout <= 120000),
          "插件启动超时声明无效。"
        )
        this.validateContributions(manifest.contributions || [])
        entry.manifest = manifest
        let saved = configuration.entries[entry.id]
        if (!saved && manifest.migrateFrom?.legacyModule) {
          try {
            const previous = JSON.parse(
              await readFile(
                join(
                  dirname(this.directory),
                  "extensions",
                  "configuration.json"
                ),
                "utf8"
              )
            )
            const old = previous.modules?.[manifest.migrateFrom.legacyModule]
            if (old)
              saved = {
                enabled: old.enabled,
                configuration: JSON.stringify(old.configuration),
                revision: 0,
              }
          } catch (error) {
            if (error.code !== "ENOENT") throw error
          }
        }
        entry.enabled = this.storageError
          ? false
          : (saved?.enabled ?? manifest.defaultEnabled ?? false)
        entry.revision = saved?.revision ?? 0
        entry.configuration =
          saved?.configuration ??
          JSON.stringify(manifest.defaultConfiguration ?? {})
        const { validatePluginValue } = await import("./plugin-helpers.mjs")
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
      this.entries.set(entry.id, entry)
    }
    for (const imported of configuration.imports) {
      const entry = this.entry(
        imported.id,
        imported.source,
        imported.sourceKind
      )
      Object.assign(entry, configuration.entries[entry.id] || {})
      entry.savedIntegrity = imported.integrity
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
  async manager(sources = []) {
    const { DefaultPackageManager, SettingsManager } = await loadPiSdk()
    return new DefaultPackageManager({
      cwd: this.directory,
      agentDir: join(this.directory, "pi"),
      settingsManager: SettingsManager.inMemory({ packages: sources }),
    })
  }
  async resolveImport(entry) {
    const manager = await this.manager()
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

    entry.installed = true
    const manifestPath = (await stat(path)).isDirectory()
      ? join(path, "package.json")
      : join(resolve(path, ".."), "package.json")
    try {
      const metadata = JSON.parse(await readFile(manifestPath, "utf8"))
      entry.manifest.version = metadata.version || "未提供"
      entry.packageRoot = (await stat(path)).isDirectory()
        ? path
        : dirname(path)
      const moon = metadata.moon
      if (moon) {
        check(moon.apiVersion === 1, "该插件的Moon Web接口版本不兼容。")
        this.validateContributions(moon.contributions || [])
        for (const file of [moon.web, moon.app, moon.pi].filter(Boolean))
          check(
            typeof file === "string" &&
              !isAbsolute(file) &&
              !file.split(/[\\/]/).includes(".."),
            "插件资源入口须位于包内。"
          )
        Object.assign(entry.manifest, {
          name: metadata.displayName || metadata.name || entry.id,
          description: metadata.description || "Pi与Moon插件",
          webApiVersion: 1,
          webEntry: moon.web || "",
          entries: {
            ...(moon.app ? { app: moon.app } : {}),
            ...(moon.pi ? { pi: moon.pi } : {}),
          },
          contributions: moon.contributions || [],
          effects: moon.effects || [],
          configurationSchema:
            moon.configurationSchema || entry.manifest.configurationSchema,
        })
        if (
          entry.revision === 0 &&
          entry.configuration === "{}" &&
          moon.defaultConfiguration
        )
          entry.configuration = JSON.stringify(moon.defaultConfiguration)
      }
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error
      /* A single Pi source has no Moon frontend. */
    }
    for (const file of [
      entry.manifest.entries.pi,
      entry.manifest.entries.app,
    ].filter(Boolean)) {
      const absolute = resolve(entry.packageRoot || entry.source, file)
      if (!entry.paths.some((path) => samePath(path, absolute)))
        entry.paths.push(absolute)
    }
    if (
      !entry.loadedSignature &&
      entry.paths.some((path) => executedSources.has(path))
    )
      entry.restartRequired = true
    // 来源完整性指纹：路径+大小+mtime+内容 sha256；超过 32MiB 的文件
    // 记为 unhashed 并如实展示。内容哈希使保留 mtime 的篡改也能被发现。
    entry.sourceSignature = JSON.stringify(
      await Promise.all(
        entry.paths.map(async (path) => {
          const metadata = await stat(path)
          if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024)
            return [path, metadata.size, metadata.mtimeMs, "unhashed"]
          const data = await readFile(path)
          return [
            path,
            metadata.size,
            metadata.mtimeMs,
            createHash("sha256").update(data).digest("hex"),
          ]
        })
      )
    )
    if (
      entry.loadedSignature &&
      entry.loadedSignature !== entry.sourceSignature &&
      entry.paths.some((path) => /\.(?:m?js|cjs)$/i.test(path))
    )
      entry.restartRequired = true
    // 来源完整性指纹：记录导入时的文件签名摘要，来源变化后如实提示。
    entry.integrity = createHash("sha256")
      .update(entry.sourceSignature)
      .digest("hex")
    if (entry.savedIntegrity && entry.savedIntegrity !== entry.integrity)
      entry.integrityChanged = true
    check(
      entry.paths.length > 0 ||
        entry.manifest.webEntry ||
        entry.manifest.entries.app,
      "该来源没有Pi或Moon插件入口。"
    )
  }
  validateContributions(items) {
    const keys = new Set()
    for (const item of items) {
      check(
        item &&
          identifier.test(item.id) &&
          ["page", "session-tab", "delivery"].includes(item.kind) &&
          typeof item.title === "string" &&
          Number.isInteger(item.version) &&
          item.version > 0 &&
          typeof item.remote === "boolean",
        "插件界面贡献声明无效。"
      )
      const key = `${item.kind}:${item.id}:${item.version}`
      check(!keys.has(key), "插件贡献重复。")
      keys.add(key)
    }
  }
  async resource(id, path, generation, signal) {
    await this.initialize()
    const entry = this.entries.get(id)
    check(
      entry?.state === "active" && entry.generation === generation,
      "插件已停用或资源代次已变化。"
    )
    check(
      typeof path === "string" &&
        path.length &&
        !isAbsolute(path) &&
        !path.split(/[\\/]/).includes(".."),
      "插件资源路径无效。"
    )
    const root = await realpath(entry.packageRoot || entry.source)
    const file = await realpath(resolve(root, path))
    const local = relative(root, file)
    check(
      local &&
        !isAbsolute(local) &&
        local !== ".." &&
        !local.startsWith(`..${sep}`),
      "插件资源不能越出安装目录。"
    )
    const size = await stat(file)
    check(
      size.isFile() && size.size <= 8 * 1024 * 1024,
      "插件资源超过8MiB或不是文件。"
    )
    const data = await readFile(file, { signal })
    const mime =
      {
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".woff2": "font/woff2",
      }[extname(file)] || "application/octet-stream"
    return { data: data.toString("base64"), mime }
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
      let activating
      try {
        if (entry.sourceKind !== "bundled") await this.resolveImport(entry)
        check(
          !entry.restartRequired,
          "来源已更新，但Pi当前进程可能仍缓存旧JavaScript模块；请重启Moon后启用，当前未应用新代码。"
        )
        if (inactive()) return
        const app = entry.manifest.entries.app
        if (app) {
          this.recordExecution(entry)
          const module = await import(
            pathToFileURL(join(entry.packageRoot || entry.source, app)).href
          )
          const directory = join(this.directory, entry.id)
          await mkdir(directory, { recursive: true })
          if (inactive()) return
          const workbenchKind = entry.sourceKind === "bundled" &&
            workbenchModules.get(entry.id)
          activating = module.activate({
            ...(workbenchKind && {
              workbench: (operations) =>
                this.workbench.forModule(workbenchKind, operations),
            }),
            directory,
            configuration: JSON.parse(configuration),
            generation,
            dispatch: this.ports.dispatch,
            dataRoot: this.ports.dataRoot,
            materials: this.ports.materials,
            sessions: this.ports.sessions,
            workspaces: this.ports.workspaces,
            registerRemoteContextResolver,
            isActive: () =>
              entry.generation === generation &&
              entry.enabled &&
              entry.state === "active" &&
              !this.closed &&
              !this.frozen,
            lease: (action) => this.lease(entry, action),
            logs: this.logs,
            // T20-3：传输终态日志只读诊断端口（查询+状态摘要），未装配时为 undefined
            operationLog: this.ports.operationLog,
            diagnostics: this.ports.diagnostics,
            sharedTools: {
              list: () => this.sharedToolGateway.catalog(),
              call: (...args) => this.sharedToolGateway.call(...args),
              subscribe: (listener) =>
                this.sharedToolGateway.subscribe(listener),
            },
            emit: (event, payload) => {
              if (
                typeof event !== "string" ||
                !event ||
                entry.generation !== generation ||
                !entry.enabled ||
                this.closed ||
                this.frozen
              )
                return
              this.ports.notify?.({
                operation: "$notify",
                event: {
                  type: "plugin-event",
                  pluginId: entry.id,
                  event,
                  payload,
                },
              })
            },
          })
          // 有界激活：单个插件挂死不得拖住全部插件 RPC；超时上限供清单覆盖。
          application = await bounded(
            activating,
            Math.min(
              Math.max(entry.manifest.activationTimeout ?? 30000, 1000),
              120000
            ),
            "插件启动超时，请在插件页停用该插件并反馈。"
          )
          check(
            application && typeof application.close === "function",
            "应用入口须声明实际资源释放方法。"
          )
          this.validateSharedTools(application.sharedTools || [])
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
        this.sharedChanged()
      } catch (error) {
        let failure = error
        if (!application && activating) {
          // 启动超时等场景的迟到实例：落定后立即释放，避免泄漏。
          void activating.then(
            (late) => late?.close?.(),
            () => {}
          )
        }
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
      integrityChanged: entry.integrityChanged === true,
      configuration: entry.configuration,
      configurationSchema: JSON.stringify(
        entry.manifest?.configurationSchema || {
          type: "object",
          properties: {},
          additionalProperties: false,
        }
      ),
      contributions: entry.manifest?.contributions || [],
      webEntry: entry.manifest?.webEntry || "",
      webApiVersion: 1,
      effects: entry.manifest?.effects || [],
      registrations: entry.registrations || {
        events: [],
        commands: [],
        providers: [],
      },
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
    const legacy = await this.ports.extensions.list(signal)
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
          effects: [],
          registrations: { events: [], commands: [], providers: [] },
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
        await this.ports.extensions.configure(
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
    const packageTask = this.packageTasks.get(id)
    check(
      !packageTask || packageTask.terminal,
      "该插件正在安装或更新，请等待任务结束后再更改。"
    )
    // A failed plugin can be disabled without rewriting its damaged saved
    // configuration. New configuration and every enable still validate fully.
    if (enabled || configuration !== entry.configuration) {
      const { validatePluginValue } = await import("./plugin-helpers.mjs")
      validatePluginValue(
        entry.manifest.configurationSchema,
        JSON.parse(configuration)
      )
    }
    await this.mutate(
      async (document) => {
        if ((document.entries[id]?.revision || 0) !== revision)
          throw operationError(
            "plugin_revision_conflict",
            "插件配置已变化，请重新读取。",
            "reload"
          )
        if (enabled && entry.sourceKind !== "bundled") {
          await this.resolveImport(entry)
          // 内容指纹随启用落库：下次加载据此核对来源是否变化。
          const record = document.imports.find((item) => item.id === id)
          if (record && entry.integrity) record.integrity = entry.integrity
        }
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
    const sourceKind = (await this.manager()).parseSource(source).type
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
    if (entry.integrity)
      await this.mutate(async (document) => {
        const record = document.imports.find((item) => item.id === entry.id)
        if (record) record.integrity = entry.integrity
      }, signal)
    return this.descriptor(entry)
  }
  taskSnapshot(id, task = this.packageTasks.get(id)) {
    if (!task) return { phase: "none" }
    return {
      phase: task.phase,
      action: task.action,
      ...(task.error ? { error: task.error } : {}),
      ...(task.failedAt ? { failedAt: task.failedAt } : {}),
    }
  }
  async packageAction(id, action, signal) {
    await this.discover()
    const entry = this.entries.get(id)
    check(
      entry && ["local", "npm", "git"].includes(entry.sourceKind),
      "只能管理明确导入的来源。"
    )
    const current = this.packageTasks.get(id)
    check(
      !current || current.terminal,
      "该插件已有安装或更新任务在进行，请等待其结束。"
    )
    if (action === "remove") {
      await this.mutate(async (document) => {
        await this.stop(entry)
        if (entry.sourceKind !== "local" && entry.installed)
          await (await this.manager()).remove(entry.source)
        document.imports = document.imports.filter((item) => item.id !== id)
        delete document.entries[id]
      }, signal)
      this.entries.delete(id)
      this.packageTasks.delete(id)
      for (const [name, owner] of this.toolOwners)
        if (owner === entry) this.toolOwners.delete(name)
      return this.taskSnapshot(id, { action, phase: "done" })
    }
    check(action === "install" || action === "update", "包管理动作无效。")
    check(
      entry.sourceKind !== "local",
      "本地文件直接引用原路径，由外部编辑器更新。"
    )
    check(
      !this.changing && !this.frozen && !this.closed,
      "插件正在变更，请稍后再试。"
    )
    this.ports.assertIdle()
    // 同步段仅停用入口；包管理器在锁外运行，Rust 60s 传输超时不再卡死安装。
    this.changing = true
    try {
      signal?.throwIfAborted()
      await this.stop(entry)
    } finally {
      this.changing = false
    }
    const task = {
      action,
      phase: "running",
      error: "",
      failedAt: undefined,
      terminal: false,
      cancelled: false,
    }
    task.promise = (async () => {
      let stage = "install"
      try {
        const manager = await this.manager([entry.source])
        manager.setProgressCallback?.((event) => {
          if (!task.cancelled && event?.type === "start") task.phase = "running"
        })
        await (action === "update"
          ? manager.update(entry.source)
          : manager.install(entry.source))
        if (task.cancelled) {
          task.phase = "cancelled"
          task.error = "已取消：包管理器在取消请求后结束，结果未应用。"
          entry.state = "disabled"
          entry.error = task.error
          return
        }
        task.phase = "applying"
        stage = "resolve"
        await this.resolveImport(entry)
        // Node's ESM module cache also covers imported dependencies. A package
        // already executed in this host cannot truthfully promise hot replacement.
        if (action === "update" && entry.loadedSignature)
          entry.restartRequired = true
        // 内容指纹随安装/更新落库；仅写配置文件，不重断言会话空闲
        // （长任务期间用户可能已开始新会话，误报会让成功的安装显示失败）。
        await this.mutate(
          async (document) => {
            const record = document.imports.find((item) => item.id === id)
            if (record && entry.integrity) record.integrity = entry.integrity
          },
          undefined,
          false
        )
        stage = "apply"
        entry.state = "disabled"
        entry.error = ""
        if (entry.enabled) await this.start(entry)
        task.phase = "done"
      } catch (error) {
        task.error = safeError(error)
        task.phase = task.cancelled ? "cancelled" : "failed"
        task.failedAt = task.cancelled ? undefined : stage
        if (!task.cancelled) {
          entry.state = "failed"
          entry.error = task.error
        }
      } finally {
        task.terminal = true
        this.ports.notify?.({
          operation: "$notify",
          event: "plugins-changed",
        })
      }
    })()
    this.packageTasks.set(id, task)
    void task.promise.catch(() => {})
    return this.taskSnapshot(id, task)
  }
  async packageStatus(id) {
    await this.discover()
    check(this.entries.has(id), "插件不存在或已被移除。")
    return this.taskSnapshot(id)
  }
  async packageCancel(id) {
    await this.discover()
    check(this.entries.has(id), "插件不存在或已被移除。")
    check(
      requestContext().source === "local",
      "forbidden：插件管理仅本机可用。"
    )
    const task = this.packageTasks.get(id)
    check(task?.phase === "running", "该插件没有可取消的包任务。")
    // Pi 包管理器不支持中断子进程：尽力取消=标记放弃，任务结束后不应用结果。
    task.cancelled = true
    task.phase = "cancelling"
    this.ports.notify?.({ operation: "$notify", event: "plugins-changed" })
    return this.taskSnapshot(id, task)
  }
  async recover(signal) {
    check(
      requestContext().source === "local",
      "forbidden：插件管理仅本机可用。"
    )
    check(
      !this.changing && !this.frozen && !this.closed,
      "插件正在变更，请稍后再试。"
    )
    check(
      [...this.packageTasks.values()].every((task) => task.terminal),
      "有安装或更新任务在进行，请等待其结束。"
    )
    let healthy = false
    try {
      await this.document()
      healthy = true
    } catch {
      /* 配置损坏正是本操作的目标场景。 */
    }
    check(!healthy, "插件配置可以读取，无需恢复。")
    // 原文备份后重建空配置：内置插件回默认状态，已导入来源需重新添加。
    await writeFile(
      `${this.file}.broken-${Date.now()}`,
      await readFile(this.file, "utf8")
    )
    await replaceJson(
      this.file,
      { version: 1, entries: {}, imports: [] },
      { signal }
    )
    this.storageError = undefined
    this.discovery = undefined
    this.entries.clear()
    await this.load()
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
    for (const controller of entry.operationCalls) controller.abort()
    for (const controller of entry.sharedCalls) controller.abort()
    this.sharedChanged()
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
              ...entry.sharedPending,
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
  validateSharedTools(tools) {
    this.sharedToolGateway.validateSharedTools(tools)
  }
  sharedChanged() {
    this.sharedToolGateway.changed()
  }
  sharedToolCatalog() {
    return this.sharedToolGateway.catalog()
  }
  callSharedTool(name, ...args) {
    return this.sharedToolGateway.call(name, ...args)
  }
  async executeSharedTool(name, input, options) {
    return this.sharedToolGateway.executeSharedTool(name, input, options)
  }

  async call(id, operation, payload, sessionId, generation, signal) {
    await this.initialize()
    const entry = this.entries.get(id)
    check(entry?.state === "active", "请先启用插件。")
    check(
      generation === undefined || generation === entry.generation,
      "插件已重新激活，请重新读取。"
    )
    const application = entry.application
    const admittedGeneration = entry.generation
    const definition = application?.operations?.[operation]
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
    const { validatePluginValue } = await import("./plugin-helpers.mjs")
    signal?.throwIfAborted()
    const input = validatePluginValue(definition.input, JSON.parse(payload))
    const current = () =>
      this.entries.get(id) === entry &&
      entry.state === "active" &&
      entry.application === application &&
      entry.generation === admittedGeneration
    const controller = new AbortController()
    const operationSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal
    entry.operationCalls.add(controller)
    const stopped = () =>
      operationError(
        "result_unknown",
        "插件执行期间已停止；请核对操作实际结果。",
        "none"
      )
    let result
    try {
      result = await this.lease(entry, () => {
        check(current(), "插件实例已变化，请重新读取后操作。")
        operationSignal.throwIfAborted()
        return definition.execute(input, context, operationSignal)
      })
    } catch (error) {
      if (controller.signal.aborted) throw stopped()
      throw error
    } finally {
      entry.operationCalls.delete(controller)
    }
    if (!current()) throw stopped()
    validatePluginValue(definition.output, result)
    // A 2MiB UTF-8 page can expand to 12MiB in JSON (control characters).
    // This bound includes that encoding; source-page limits remain unchanged.
    check(
      Buffer.byteLength(JSON.stringify(result)) <= 16 * 1024 * 1024,
      "插件返回超过编码后传输上限。"
    )
    return { payload: JSON.stringify(result), generation: admittedGeneration }
  }
  async extensionPaths() {
    await this.initialize()
    return [...this.entries.values()]
      .filter((entry) => entry.state === "active")
      .flatMap((entry) =>
        (entry.paths || []).filter(
          (path) =>
            ![entry.manifest.entries.pi, entry.manifest.entries.app]
              .filter(Boolean)
              .some((file) =>
                samePath(resolve(entry.packageRoot || entry.source, file), path)
              )
        )
      )
  }
  async factories(cwd, scope) {
    await this.initialize()
    return [...this.entries.values()]
      .filter((entry) => entry.state === "active" && entry.manifest.entries.pi)
      .map((entry) => ({
        name: `moon-plugin-${entry.id}`,
        factory: async (pi) => {
          const generation = entry.generation
          this.recordExecution(entry)
          const module = await import(
            pathToFileURL(
              join(entry.packageRoot || entry.source, entry.manifest.entries.pi)
            ).href
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
                          // 内部 Pi 的受信上下文由宿主注入到 Pi SDK 五参签名之后的附加位；
                          // 插件工具不能自报 actor。
                          const result = await definition.execute(...args, {
                            callId: randomUUID(),
                            source: "pi",
                            traceId: currentTraceId() || randomUUID(),
                            sessionId: scope.sessionId || "",
                            actorId: "internal-pi",
                          })
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
            configuration: JSON.parse(entry.configuration),
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
  prepareNative(result, scope = {}) {
    for (const extension of result.extensions) {
      const entry = [...this.entries.values()].find(
        (candidate) =>
          candidate.paths?.some(
            (path) =>
              samePath(path, extension.path) ||
              samePath(path, extension.resolvedPath)
          ) || extension.path === `<inline:moon-plugin-${candidate.id}>`
      )
      if (!entry) continue
      entry.registrations = {
        ...entry.registrations,
        events: [
          ...new Set([
            ...(entry.registrations?.events || []),
            ...extension.handlers.keys(),
          ]),
        ],
        commands: [
          ...new Set([
            ...(entry.registrations?.commands || []),
            ...extension.commands.keys(),
          ]),
        ],
        providers: [
          ...new Set(
            [
              ...(result.runtime.pendingProviderRegistrations || []),
              ...(result.runtime.pendingNativeProviderRegistrations || []),
              ...(result.runtime.pendingVirtualModelRegistrations || []),
            ]
              .filter((item) => item.extensionPath === extension.path)
              .map((item) =>
                String(
                  item.name ||
                    item.provider?.id ||
                    item.definition?.id ||
                    "自定义提供方"
                )
              )
          ),
        ],
      }
      const context = (ctx) =>
        scope.uiFor ? { ...ctx, ui: scope.uiFor(entry.id) } : ctx
      for (const [event, handlers] of extension.handlers)
        extension.handlers.set(
          event,
          handlers.map((handler) => async (value, ctx) => {
            const answer = await handler(value, context(ctx))
            return answer?.details
              ? {
                  ...answer,
                  details: this.deliveryDetails(entry, answer.details),
                }
              : answer
          })
        )
      for (const registered of extension.tools.values()) {
        const execute = registered.definition.execute
        registered.definition.execute = async (...args) => {
          args[4] = context(args[4])
          const value = await execute(...args)
          return {
            ...value,
            details: this.deliveryDetails(entry, value.details),
          }
        }
      }
      for (const command of extension.commands.values()) {
        const handler = command.handler
        command.handler = (args, ctx) => handler(args, context(ctx))
      }
    }
    return this.observeNative(result)
  }
  deliveryDetails(entry, details) {
    const value = details?.moonDelivery
    if (!value) return details
    check(
      entry.manifest.contributions?.some(
        (c) =>
          c.kind === "delivery" &&
          c.id === value.kind &&
          c.version === value.version
      ),
      "交付类型未在插件清单中声明。"
    )
    check(
      typeof value.summary === "string" &&
        value.summary.length <= 16000 &&
        typeof value.payload === "string" &&
        value.payload.length <= 65536,
      "交付数据或摘要无效。"
    )
    JSON.parse(value.payload)
    return {
      ...details,
      moonDelivery: {
        ...value,
        pluginId: entry.id,
        source: entry.manifest.name,
      },
    }
  }
  recordExecution(entry) {
    if (entry.sourceKind === "bundled") return
    entry.loadedSignature = entry.sourceSignature
    for (const path of entry.paths || []) executedSources.add(path)
  }
  observeNative(result) {
    const winners = new Map()
    this.toolOwners.clear()
    for (const extension of result.extensions) {
      const entry = [...this.entries.values()].find(
        (entry) =>
          entry.paths?.some(
            (path) =>
              samePath(path, extension.path) ||
              samePath(path, extension.resolvedPath)
          ) || extension.path === `<inline:moon-plugin-${entry.id}>`
      )
      if (entry && entry.sourceKind !== "bundled") {
        this.recordExecution(entry)
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
        candidate.paths?.some((path) => samePath(path, origin)) ||
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
    const value = result?.details?.moonDelivery
    if (
      !value ||
      typeof value.kind !== "string" ||
      !Number.isInteger(value.version) ||
      typeof value.payload !== "string" ||
      value.payload.length > 65536
    )
      return
    const summary =
      typeof value.summary === "string"
        ? value.summary
        : (result.content || [])
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n")
            .slice(0, 16000)
    return {
      kind: value.kind,
      version: value.version,
      payload: value.payload,
      summary,
      ...(value.pluginId || entry?.id
        ? { pluginId: value.pluginId || entry.id }
        : {}),
      source: value.source || entry?.manifest.name || "插件交付",
    }
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
    // 进行中的包任务先落定（有界）：避免关闭时 node_modules 处于半写状态。
    await Promise.allSettled(
      [...this.packageTasks.values()].map((task) =>
        bounded(task.promise, 60000, "插件包任务收尾超时，已放弃等待。")
      )
    )
    const results = await Promise.allSettled(
      [...this.entries.values()].reverse().map((entry) => this.stop(entry))
    )
    results.push(...(await Promise.allSettled([this.workbench.close()])))
    const logging = await Promise.allSettled([this.logs.close()])
    results.push(...logging)
    if (strict && results.some((result) => result.status === "rejected"))
      throw new Error("插件资源释放未确认，请重启Moon。")
  }
  async freeze() {
    this.frozen = true
    for (const entry of this.entries.values())
      for (const controller of entry.sharedCalls) controller.abort()
    this.sharedChanged()
    const results = await Promise.allSettled(
      [...this.entries.values()].flatMap((entry) => [
        bounded(Promise.resolve().then(() => entry.application?.quiesce?.())),
        bounded(entry.starting ?? Promise.resolve()),
        bounded(Promise.allSettled([...entry.sharedPending])),
      ])
    )
    if (results.some((result) => result.status === "rejected"))
      throw new Error("插件维护准备的资源释放未确认，请重启Moon。")
  }
  async resume() {
    for (const entry of this.entries.values())
      await entry.application?.resume?.()
    this.frozen = false
    this.sharedChanged()
    await this.initialize()
  }
}
