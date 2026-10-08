/** RPC 装配策略也是接口目录的事实来源；依赖按实际操作根选择，失败不扩散到独立领域。 */
export const serviceRegistry = {
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
}
export function serviceRoot(method) {
  const root = method.split(".")[0]
  return Object.hasOwn(serviceRegistry, root) ? root : "models"
}
export function operationDependencies(method) {
  // 命令原回执独立可读；命令接受流程自己捕获准备故障并保存拒绝终态。
  if (method.startsWith("conversations.commands.")) return []
  if (
    ["conversations.queueReceiptRead", "conversations.readReceipt"].includes(
      method
    )
  )
    return []
  return serviceRegistry[serviceRoot(method)].ready
}
