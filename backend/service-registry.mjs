/** RPC 装配策略也是接口目录的事实来源；依赖按实际操作根选择，失败不扩散到独立领域。 */
export const serviceRegistry = {
  plugins: {
    ready: [],
    source: "backend/plugin-host.mjs",
    storage: "插件应用配置、贡献和激活代次",
  },
  boot: {
    ready: [],
    source: "backend/boot.mjs",
    storage:
      "模型、会话、MCP、工作区、队列/控制与维护记录的必需存储schema；可选插件错误由插件列表呈现",
  },
  models: {
    ready: ["models"],
    source: "backend/models.mjs",
    storage: "模型配置及配置写入回执",
  },
  jobs: {
    ready: ["models"],
    source: "backend/oauth.mjs",
    storage: "授权任务及原操作身份",
  },
  sessions: {
    ready: ["models", "extensions"],
    source: "backend/sessions.mjs",
    storage: "Pi 会话与生效配置",
  },
  conversations: {
    ready: ["models", "extensions", "conversations"],
    source: "backend/conversations.mjs",
    storage: "Pi 正文、会话元数据和输入/命令回执",
  },
  conversationCatalog: {
    ready: ["conversations"],
    source: "backend/conversation-catalog.mjs",
    storage: "会话索引",
  },
  workspaces: {
    ready: [],
    source: "backend/workspaces.mjs",
    storage: "工作区目录",
  },
  materials: {
    ready: [],
    source: "backend/materials.mjs",
    storage: "材料记录；准备时按需使用 Pi 资源",
  },
  mcp: {
    ready: [],
    source: "backend/mcp.mjs",
    storage: "MCP 配置、目录缓存与写入回执",
  },
  extensions: {
    ready: ["extensions"],
    source: "backend/extensions.mjs",
    storage: "扩展发现与启用配置",
  },
  writeReceipt: {
    ready: [],
    source: "backend/write-receipts.mjs",
    storage: "按操作领域核对原回执",
  },
  writeReceipts: {
    ready: [],
    source: "backend/services.mjs",
    storage: "原写回执读取端口（MoonServices.writeReceipts.read）",
  },
}

/** 装配时拒绝重复公开名称，不能让后加载的领域覆盖已有操作。 */
export function mergeOperationGroups(...groups) {
  const result = {}
  for (const group of groups) {
    for (const [name, definition] of Object.entries(group)) {
      if (Object.hasOwn(result, name))
        throw new Error(`操作 ${name} 被重复注册。`)
      result[name] = definition
    }
  }
  return result
}
export function serviceRoot(method) {
  const root = method.split(".")[0]
  if (!Object.hasOwn(serviceRegistry, root))
    // G05：未知根不再默认 models；契约与注册表不一致在启动检查/分发时显式失败
    throw new Error(`操作根 ${root} 未注册服务归属。`)
  return root
}

/** G05：启动检查——契约中每个操作的根都必须已注册；缺失即装配失败。 */
export function assertRegistryCovers(operations) {
  for (const [name, definition] of Object.entries(operations ?? {})) {
    const root = String(definition.method || "").split(".")[0]
    if (!Object.hasOwn(serviceRegistry, root))
      throw new Error(`操作 ${name} 的归属根 ${root} 未注册（G05 启动检查）。`)
  }
}

/** G05：写回执存储按注册表根归属；替代按操作名前缀猜测。 */
export function receiptRootFor(operation, operations) {
  const definition = operations?.[operation]
  if (!definition) throw new Error(`未知操作 ${operation}，无法确定回执归属。`)
  const root = serviceRoot(definition.method)
  return root === "mcp" || root === "extensions" ? root : "models"
}
export function operationDependencies(method) {
  // 命令原回执独立可读；命令接受流程自己捕获准备故障并保存拒绝终态。
  if (method.startsWith("conversations.commands.")) return []
  if (
    [
      "conversations.queueReceiptRead",
      "conversations.queueItemRead",
      "conversations.readReceipt",
    ].includes(method)
  )
    return []
  return serviceRegistry[serviceRoot(method)].ready
}
