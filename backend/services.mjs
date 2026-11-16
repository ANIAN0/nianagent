// @ts-check
import { ModelService } from "./models.mjs"
import { BootService } from "./boot.mjs"
import { PluginHost } from "./plugin-host.mjs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { McpService } from "./mcp.mjs"
import { ExtensionService } from "./extensions.mjs"
import { SessionService } from "./sessions.mjs"
import { MaterialService } from "./materials.mjs"
import { WorkspaceService } from "./workspaces.mjs"
import { ConversationStore } from "./conversation-store.mjs"
import { ConversationCatalogService } from "./conversation-catalog.mjs"
import { ConversationService } from "./conversations.mjs"
import { operations, validateRequest, dispatchOperation } from "./contract.mjs"
import { readWriteReceipt } from "./write-receipts.mjs"
import {
  assertRegistryCovers,
  operationDependencies,
  receiptRootFor,
} from "./service-registry.mjs"
import { settleResources } from "./close-resources.mjs"
import { requestContext, withRequestContext } from "./request-context.mjs"

/** 服务装配根：业务服务不再创建其他领域；就绪失败只阻断真实依赖它的操作。 */
export class MoonServices {
  /** @param {string} directory @param {{dispatchRequest?: (operation: string, input: any, signal?: AbortSignal) => Promise<any>, diagnostics?: {append: (record: any) => any}, operationLog?: {query: (input: any) => Promise<any>, status: () => {queued: number, dropped: number, issue: string}}, notify?: (value: any) => void}} [options] */
  constructor(directory, options = {}) {
    // G05：启动检查——每个契约操作必须归属已注册服务根；未知根不再默认 models
    assertRegistryCovers(operations)
    const self = this
    this.closed = false
    this.directory = directory
    this.ready = new Map()
    this.models = new ModelService(directory)
    this.mcp = new McpService(directory)
    this.extensions = new ExtensionService(directory)
    this.plugins = new PluginHost(directory, {
      authorizeSession: this.authorizeSession.bind(this),
      // G01：装配只消费领域活动快照端口，不遍历会话/对话内部状态
      assertIdle: () => {
        if (this.sessions.hasBusyWork() || this.conversations.hasPendingWork())
          throw new Error("当前执行或审批结束后才能更改插件。")
      },
      dispatch: options.dispatchRequest ?? this.dispatch.bind(this),
      // T20-3：传输终态日志只读诊断端口（logs 插件消费），未装配时为 undefined
      operationLog: options.operationLog,
      diagnostics: options.diagnostics,
      // 后端主动通知链：包任务终态等经传输层转达桌面端（未装配时安全省略）
      notify: options.notify,
      // G02：插件只获得显式窄端口，不获取服务根；directory 用 getter 惰性解析
      // （materials 在本构造器后段才创建）。
      dataRoot: () => this.directory,
      materials: {
        get directory() {
          return self.materials.directory
        },
        selection: (context, input, signal) =>
          self.materials.selection(context, input, signal),
        upload: (
          sessionId,
          cwd,
          name,
          mimeType,
          data,
          signal,
          uploadIdentity
        ) =>
          self.materials.upload(
            sessionId,
            cwd,
            name,
            mimeType,
            data,
            signal,
            uploadIdentity
          ),
        prepare: (sessionId, cwd, paths, signal, uploadIdentity) =>
          self.materials.prepare(sessionId, cwd, paths, signal, uploadIdentity),
        uploadAdoption: (identity, materialId) =>
          Reflect.apply(self.materials.uploadAdoption, self.materials, [
            identity,
            materialId,
          ]),
      },
      sessions: {
        identity: (value) => self.sessions.identity(value),
        cwd: (value) => self.sessions.cwd(value),
      },
      extensions: {
        list: (signal) => this.extensions.list(signal),
        configure: (id, revision, enabled, configuration, signal) =>
          this.extensions.configure(
            id,
            revision,
            enabled,
            configuration,
            signal
          ),
      },
    })
    this.sessions = new SessionService(directory, {
      runtime: this.models.runtime.bind(this.models),
      mcp: this.mcp,
      extensions: this.extensions,
      plugins: this.plugins,
    })
    this.materials = new MaterialService(
      directory,
      this.sessions,
      (sessionId) => this.conversations.commands.catalog(sessionId),
      (pending, materialId) =>
        this.conversations.uploadAdoption(pending, materialId)
    )
    this.workspaces = new WorkspaceService(directory)
    this.conversationStore = new ConversationStore(directory)
    this.conversationCatalog = new ConversationCatalogService(
      this.conversationStore
    )
    this.conversations = new ConversationService(
      directory,
      {
        store: this.models.store,
        present: this.models.present.bind(this.models),
        runtime: this.models.runtime.bind(this.models),
        mcp: this.mcp,
        extensions: this.extensions,
        plugins: this.plugins,
        materials: this.materials,
      },
      this.sessions,
      this.conversationStore,
      this.workspaces,
      () =>
        this.initializeOnce("conversations", () =>
          this.conversationStore.initialize({ recoverInterrupted: true })
        )
    )
    this.jobs = this.models.jobs
    this.boot = new BootService(directory, this.storageReaders())
  }
  storageReaders() {
    return {
      models: () => this.models.store.read(),
      conversations: () => this.conversationStore.document(),
      sessions: () => this.sessions.document(),
      mcp: () => this.mcp.document(),
      workspaces: () => this.workspaces.read(),
      queueDocument: (id) => this.conversations.queue.document(id),
    }
  }
  async authorizeSession(sessionId, context) {
    if (this.closed || this.conversations.maintenanceFrozen)
      throw new Error("Moon 正在维护或关闭。")
    this.sessions.identity(sessionId)
    const configuration = (await this.sessions.document()).sessions[sessionId]
    const record = await this.conversationStore.get(sessionId)
    const cwd = record?.cwd || configuration?.cwd
    if (!cwd) throw new Error("会话配置不存在，不能访问工作文件。")
    const data = JSON.parse(
      await readFile(join(this.directory, "moon-data.json"), "utf8")
    )
    if (context.source === "remote") {
      if (context.profileId !== data.dataSetId)
        throw new Error("forbidden：远程连接不属于当前Moon数据。")
      // The authenticated Noise transport admits all normal sessions in this
      // data set, including old sessions. Registration is not an allowlist.
    }
    return {
      profileId: data.dataSetId,
      sessionId,
      cwd,
      workspaceId: record?.workspaceId || "",
    }
  }
  async initializeOnce(key, initialize) {
    let pending = this.ready.get(key)
    if (!pending) {
      pending = initialize().catch((error) => {
        this.ready.delete(key)
        throw error
      })
      this.ready.set(key, pending)
    }
    await pending
    if (this.closed) throw new Error("Moon 正在退出。")
  }
  async dispatch(operation, input, signal) {
    if (this.closed) throw new Error("Moon 正在退出。")
    const definition = validateRequest(operation, input)
    // Optional applications start independently of a model or session. Their
    // errors remain in plugin descriptors and cannot block boot/ordinary Chat.
    if (operation === "bootStatus")
      void this.plugins.initialize().catch(() => {})
    // 工作区和材料/回执的独立读取不应因模型配置损坏而失去恢复入口。
    const initializers = {
      models: () => this.models.initialize(),
      extensions: () => this.extensions.discover(),
      conversations: () =>
        this.conversationStore.initialize({ recoverInterrupted: true }),
    }
    for (const dependency of operationDependencies(definition.method))
      await this.initializeOnce(dependency, initializers[dependency])
    signal?.throwIfAborted()
    // AC12：owner 与方法解析契约统一——dispatchOperation 以装配根为起点按
    // method 路径逐级解析（models.list → this.models.list）。此前对 models 根
    // 先窄化 this.models 再按全路径解析，this.models.models 为 undefined 必崩；
    // 其余根行为不变；未知根仍由 serviceRoot 显式拒绝（G05，不默认转 models）。
    return withRequestContext(
      this.plugins.captureRequestContext(requestContext(), input.sessionId),
      () => dispatchOperation(this, operation, input, signal)
    )
  }
  /** G05：writeReceiptRead 的显式归属端口（旧隐式根回退路径无法到达本方法）。 */
  writeReceipts = {
    read: (operation, requestId, signal) =>
      this.writeReceipt(operation, requestId, signal),
  }
  writeReceipt(operation, requestId, signal) {
    const root = receiptRootFor(operation, operations)
    const store =
      root === "mcp"
        ? this.mcp.receiptStore()
        : root === "extensions"
          ? this.extensions.receiptStore()
          : this.models.store
    return readWriteReceipt(store, operation, requestId, signal)
  }
  async close({ strict = false } = {}) {
    this.closed = true
    this.workspaces.close()
    // 先结束执行/会话持有者，再释放共享资源；关闭期间不再创建新依赖。
    const failures = []
    for (const resource of [
      this.conversations,
      this.sessions,
      this.models,
      this.mcp,
      this.extensions,
      this.plugins,
    ]) {
      try {
        await resource.close({ strict })
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await settleResources([...this.ready.values()], strict)
    } catch (error) {
      failures.push(error)
    }
    if (strict && failures.length)
      throw new AggregateError(
        failures,
        "维护资源关闭未确认，请重启 Moon 恢复。"
      )
  }
}
