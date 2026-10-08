// @ts-check
import { ModelService } from "./models.mjs"
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

/** 服务装配根：业务服务不再创建其他领域；就绪失败只阻断真实依赖它的操作。 */
export class MoonServices {
  constructor(directory) {
    this.closed = false
    this.ready = new Map()
    this.models = new ModelService(directory)
    this.mcp = new McpService(directory)
    this.extensions = new ExtensionService(directory)
    this.sessions = new SessionService(directory, {
      runtime: this.models.runtime.bind(this.models),
      mcp: this.mcp,
      extensions: this.extensions,
    })
    this.materials = new MaterialService(
      directory,
      this.sessions,
      (sessionId) => this.conversations.commands.catalog(sessionId)
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
    return dispatchOperation(owner, operation, input, signal)
  }
  writeReceipt(operation, requestId, signal) {
    const store = operation.startsWith("mcp")
      ? this.mcp.receiptStore()
      : operation === "extensionConfigure"
        ? this.extensions.receiptStore()
        : this.models.store
    return readWriteReceipt(store, operation, requestId, signal)
  }
  async close() {
    this.closed = true
    this.workspaces.close()
    // 先结束执行/会话持有者，再释放共享资源；关闭期间不再创建新依赖。
    await this.conversations.close()
    await this.sessions.close()
    await this.models.close()
    await this.mcp.close()
    await this.extensions.close()
    await Promise.allSettled(this.ready.values())
  }
}
