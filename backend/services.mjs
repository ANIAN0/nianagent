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
import { validateRequest, dispatchOperation } from "./contract.mjs"
import { readWriteReceipt } from "./write-receipts.mjs"
import { operationDependencies, serviceRoot } from "./service-registry.mjs"
import { settleResources } from "./close-resources.mjs"
import { requestContext, withRequestContext } from "./request-context.mjs"

/** 服务装配根：业务服务不再创建其他领域；就绪失败只阻断真实依赖它的操作。 */
export class MoonServices {
  /** @param {string} directory @param {{dispatchRequest?: (operation: string, input: any, signal?: AbortSignal) => Promise<any>}} [options] */
  constructor(directory, options = {}) {
    this.closed = false
    this.directory = directory
    this.ready = new Map()
    this.models = new ModelService(directory)
    this.mcp = new McpService(directory)
    this.extensions = new ExtensionService(directory)
    this.plugins = new PluginHost(directory, {
      authorizeSession: this.authorizeSession.bind(this),
      assertIdle: () => {
        if (
          [...this.sessions.active.values()].some(
            (entry) => entry.busy || !entry.session.isIdle
          ) ||
          [...this.conversations.active.values()].some(
            (state) =>
              state.entry.busy ||
              state.controlBusy ||
              this.conversations.permissions.pendingFor(state.record.id).length
          )
        )
          throw new Error("当前执行或审批结束后才能更改插件。")
      },
      dispatch: options.dispatchRequest ?? this.dispatch.bind(this),
      services: () => this,
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
    this.boot = new BootService(directory, () => this)
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
    const root = serviceRoot(definition.method)
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
    const owner = root in this && root !== "models" ? this : this.models
    return withRequestContext(
      this.plugins.captureRequestContext(requestContext(), input.sessionId),
      () => dispatchOperation(owner, operation, input, signal)
    )
  }
  writeReceipt(operation, requestId, signal) {
    const store = operation.startsWith("mcp")
      ? this.mcp.receiptStore()
      : operation === "extensionConfigure"
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
