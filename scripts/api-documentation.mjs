import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { operations, schemas } from "../backend/contract.mjs"
import {
  desktopCommands,
  desktopSchemas,
} from "../backend/desktop-contract.mjs"
import { serviceRegistry, serviceRoot } from "../backend/service-registry.mjs"
import {
  fileOperations,
  fileDocumentationOutputs,
  fileModule,
} from "../backend/plugins/file-workbench/contract.mjs"
import {
  openCliOperations,
  openCliModule,
  openCliManagement,
} from "../backend/plugins/opencli/contract.mjs"
import { fileURLToPath } from "node:url"
import {
  remoteOperations,
  remoteModule,
} from "../backend/plugins/remote-access/contract.mjs"
import { projectRoot } from "./project-index.mjs"
import {
  mcpServiceOperations,
  mcpServiceModule,
} from "../backend/plugins/mcp-service/contract.mjs"
import {
  logsOperations,
  logsModule,
} from "../backend/plugins/logs/contract.mjs"

const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const str = (description) => ({ type: "string", description })
const empty = object()
const moduleResponsibilities = {
  启动: "检查已保存数据和真实启动进度，支持重试、确认前端就绪和退出。",
  插件宿主: "查看、导入和配置应用插件，并通过插件公开操作调用其能力。",
  本地扩展: "查看可用扩展及其配置，保存配置或启停扩展。",
  操作回执: "核对原配置写入的结果，避免结果未知时重复写入。",
  运行中消息: "查看、编辑、删除和交付待处理消息，核对原队列操作的结果。",
  消息材料: "选择、上传和预览文件图片，恢复草稿及队列使用的材料。",
  "MCP 服务": "管理 MCP 服务配置，检查实际连接及可用工具。",
  工作区: "登记本机工作目录、记住当前选择，并读取目录的可用状态。",
  会话列表: "读取已保存会话与摘要，记录会话的已读状态。",
  真实对话: "提交消息、读取与订阅回复，停止生成并恢复未完成操作。",
  会话权限: "读取和修改会话权限，回答执行审批与扩展交互提示。",
  会话命令: "执行已注册扩展命令，核对原命令的接收及执行结果。",
  会话派生: "从已完成回复建立独立分支会话，保留来源关系。",
  上下文压缩: "发起或取消当前上下文压缩，读取原操作状态与结果。",
  会话配置: "读取可用工具和项目指令，查看并应用当前会话配置。",
  模型配置: "管理模型连接和凭据，发现与检查模型，完成订阅授权。",
  本机文件:
    "发现或选择本机编辑器，在外部程序打开文件，将原文件另存到选定位置。",
  首启迁移:
    "选择并检查首次启动的数据目标，导入旧数据，读取迁移进度并恢复启动。",
  首次启动: "检查独立空目录，明确不导入旧数据并建立新的数据集。",
  桌面: "读取当前桌面宿主的状态、数据位置和维护进度。",
  数据与存储: "打开当前数据和保留副本，选择、检查并迁移到新的数据目录。",
  桌面维护: "确认当前维护过程中的草稿保存和恢复结果，按原维护状态重新启动。",
  关于与更新: "检查、下载或取消更新，保存更新偏好，明确安装并重启。",
}
const nullValue = {
  type: "null",
  description: "没有业务返回值；Tauri invoke 成功解析为 null。",
}
const meaning = {
  entries: "当前目录或结果中的直属条目",
  requests: "匹配当前消费者的打开请求",
  beforeVersion: "管理操作开始前版本",
  targetVersion: "已解析的目标版本",
  installation: "官方安装检测信息",
  cliPath: "CLI程序入口",
  daemonPath: "官方后台入口",
  license: "官方包许可证",
  npmPath: "实际npm路径",
  nodePath: "实际Node路径",
  latestVersion: "最新已检测版本",
  daemon: "实际后台状态",
  pid: "后台进程号",
  bridge: "官方Browser Bridge连接状态",
  profiles: "实际可用连接集合",
  aliases: "官方配置中的别名",
  browserSupport: "当前版本的浏览器接口能力",
  material: "准备后的原材料引用",
  dataDirectory: "当前业务数据目录",
  installDirectory: "应用程序所在目录",
  schemaVersion: "数据schema版本",
  legacyCopyRetained: "是否保留旧数据副本",
  retainedCopyDirectories: "保留的旧副本路径集合",
  directoryMappings: "当前数据目录的逻辑到实际映射",
  usedBytes: "源数据已用字节数",
  availableBytes: "目标可用磁盘字节数",
  sourceRoot: "原始数据根目录",
  targetRoot: "目标数据根目录",
  planExpiresAt: "预检计划失效时间",
  legacyProfileDirectory: "可导入的旧WebView profile目录",
  defaultDirectory: "建议的默认目标目录",
  fileCount: "本次需要处理的文件总数",
  completedFiles: "当前已处理文件数",
  copiedBytes: "已复制的字节数",
  chooseDirectory: "当前是否可选择目录",
  prepare: "当前是否可执行预检",
  migrate: "当前是否可确认迁移",
  createFresh: "当前是否可创建新数据集",
  openDiagnostics: "当前是否可打开诊断",
  continueStartup: "当前是否可继续启动",
  platform: "实际操作系统",
  architecture: "当前进程架构",
  development: "是否开发模式",
  migrateData: "当前是否允许数据迁移",
  openDataDirectory: "当前是否可打开数据目录",
  checkUpdates: "当前是否可检查更新",
  installUpdates: "当前是否可安装已验证更新",
  unavailableReason: "当前能力不可用原因，可空",
  shutdownStarted: "是否已经进入关闭阶段",
  totalFiles: "本次文件总数",
  publishedAt: "发布的ISO时间",
  expiresAt: "当前计划失效时间",
  stopActive: "是否明确允许停止当前活动",
  profileReady: "WebView profile是否已准备完成",

  id: "所属记录的稳定标识",
  name: "用户可识别的名称",
  value: "当前字段或插件返回的实际值",
  revision: "当前记录的乐观并发版本",
  enabled: "当前是否启用",
  generation: "当前激活或状态代次",
  paths: "用户明确选择的文件路径集合",
  materials: "本次输入关联的材料引用",
  cwd: "实际工作目录",
  sessionId: "会话稳定标识",
  toolIds: "选择的工具标识集合",
  apiKey: "用户明确提供的 API 密钥",
  promptId: "原输入操作标识",
  version: "结构或程序版本",
  remote: "是否允许远程调用或显示",
  installed: "来源是否已安装",
  contributions: "插件注册的网页贡献",
  tools: "注册工具集合",
  resultKinds: "注册的结果呈现类型",
  editBaseRevision: "本次编辑所依据的版本",
  items: "当前结果条目集合",
  lineStart: "选区起始行，1基",
  lineEnd: "选区结束行，1基",
  columnStart: "选区起始列，1基",
  columnEnd: "选区结束列，1基",
  pageStart: "PDF选区起始页，1基",
  pageEnd: "PDF选区结束页，1基",
  files: "当前文件材料集合",
  skills: "当前可用 Skill 集合",
  diagnostics: "当前诊断说明",
  commands: "实际可用命令集合",
  lineage: "分支来源身份与历史位置",
  images: "实际交付的图像集合",
  thinking: "模型返回的思考内容",
  attachments: "该条消息关联的附件",
  blocks: "消息内容块，按实际顺序排列",
  type: "当前记录或内容块的类型判别值",
  messages: "已投影的会话消息",
  approvals: "待处理或已处理审批集合",
  extensionNotifications: "Pi扩展发出的通知",
  compactions: "上下文压缩记录",
  notice: "当前额外状态说明",
  context: "本次运行的上下文统计",
  contextState: "上下文统计的可用状态",
  upserts: "本次增量新增或替换的记录",
  order: "记录的展示顺序",
  options: "可选择的实际选项",
  available: "此项当前是否可用",
  busy: "当前是否存在占用操作",
  args: "按顺序传给程序的参数",
  env: "显式环境变量配置",
  headers: "显式请求头配置",
  defaults: "当前目录提供的默认选择",
  metadata: "提供者或命令返回的附加元数据",
  account: "授权后提供者返回的账号信息",
  path: "所属资源的实际路径",
  bytes: "文件或资源字节数",
  offset: "字节窗口起始位置",
  data: "当前字节窗口的base64编码",
  token: "原操作或接收记录的稳定身份",
  expected: "预期的原文件观察版本",
  line: "文本起始行，1基",
  atLine: "定位到指定实际行，覆盖offset/line",
  purpose: "读取用途：preview或download",
  active: "当前消费者是否保持可见",
  text: "实际选择或输入的文本",
  selectionKind: "选区来源类型",
  expectedDaemonPid: "已观察到的官方后台PID；是否必须匹配见当前操作条件",
  expectedDaemonVersion: "已观察到的官方后台版本；省略语义依当前操作",
  mimeType: "文件实际MIME类型",
  attemptId: "当前启动尝试身份",
  dataSetId: "数据集稳定身份",
  phase: "当前生命周期阶段",
  stage: "当前启动或维护步骤",
  hostMode: "当前宿主模式",
  storage: "当前已确认的数据存储信息",
  issue: "当前具体失败或状态说明",
  capabilities: "当前状态允许的实际操作",
  code: "稳定错误类别",
  message: "面向用户的安全说明",
  recovery: "当前可执行的恢复动作",
  activities: "当前占用或阻止维护的活动",
  retry: "是否允许重试",
  exit: "是否允许退出",
  ready: "前端阶段是否已完成",
  selection: "首次启动选择：导入或新数据集",
  operationId: "原维护或启动操作身份",
  nonce: "当前保存握手的一次性身份",
  saved: "前端状态是否保存完成",
  blockers: "尚未完成保存或释放的具体活动",
  target: "当前计划的目标数据根",
  source: "当前操作的原始来源",
  planId: "预检生成的计划身份",
  index: "保留副本列表中的序号",
  automaticCheck: "是否自动检查更新",
  automaticDownload: "是否自动下载更新",
  autoCheck: "自动检查更新开关",
  autoDownload: "自动下载更新开关",
  releaseId: "当前更新发布身份",
  requestId: "原传输请求身份",
  url: "当前对象的网址",
  program: "用户选择的受支持编辑器路径；null使用系统关联",
  title: "供界面显示的标题",
  state: "当前对象的实际状态",
  kind: "所属对象或活动类别",
  retryable: "是否允许用户重试",
  stoppable: "此活动能否主动停止",
  label: "用户可识别的简短名称",
  reason: "当前状态或限制的具体原因",
  root: "当前资源或数据根目录",
  pending: "当前待完成状态",
  current: "当前使用的实际记录",
  preferences: "持久化的用户偏好",
  maintenance: "当前维护阶段与冻结状态",
  update: "当前更新检查、下载和安装状态",
  retained: "保留的原副本",
  diagnosticPath: "诊断信息所在路径",
  confirmed: "用户是否已明确确认",
  expectedRevision: "调用依据的原记录版本",
  targetDirectory: "用户选择的目标目录",
  sourceDirectory: "原数据所在目录",
  transferred: "已处理字节数",
  total: "需要处理的总量",
  progress: "当前步骤进度",
  versionName: "展示的版本名称",
  error: "本次失败原因",
  operation: "当前操作身份或进度",
  release: "已验证的更新发布记录",
  download: "当前下载状态",
  downloaded: "已下载的字节数",
  downloadedBytes: "已下载字节数",
  totalBytes: "本次操作的总字节数",
  writesFrozen: "当前是否冻结写操作",
  reasonCode: "当前状态的稳定原因代码",
  checkedAt: "最近检查的ISO时间",
  startedAt: "操作开始ISO时间",
  endedAt: "操作结束ISO时间，可空",
  pathExists: "路径当前是否存在",
  installable: "当前更新是否允许安装",
  checked: "当前是否已完成检查",
  command: "实际注册命令",
  input: "所属业务契约的入参，保持原类型",
  result: "所属业务契约的返回值",
  readyToInstall: "已下载并验证、可安装",
  availableVersion: "可用更新版本",
  currentVersion: "当前运行版本",
  notes: "发布说明",
  targetPath: "已预检目标路径",
  sourcePath: "原数据绝对路径",
  nameConflict: "名称冲突状态",
  status: "实际业务状态",
  readOnly: "是否只读",
  writable: "当前目录是否可写",
  canonicalPath: "规范化的实际路径",
  retainedCopies: "维护后保留的原数据副本集合",
  profile: "当前WebView或数据profile信息",
  runtime: "当前本机运行时信息",
  diagnosticsDirectory: "本次诊断目录",
  foreground: "当前是否为前台消费者",
  connectionId: "当前连接的稳定标识",
  profileId: "当前客户端profile身份",
}
/** Enrich only the documentation projection, never the validator or generated DTO. */
export function documentSchema(value, key = "") {
  const copy = { ...value }
  if (!copy.description && key && meaning[key]) copy.description = meaning[key]
  if (
    copy.type === "object" &&
    !Object.keys(copy.properties ?? {}).length &&
    copy.additionalProperties !== false
  )
    copy.description = [
      copy.description,
      "开放对象：由所属提供者或插件原样传递额外字段，目录不把它收紧为固定结构。",
    ]
      .filter(Boolean)
      .join("；")
  if (copy.properties)
    copy.properties = Object.fromEntries(
      Object.entries(copy.properties).map(([name, schema]) => [
        name,
        documentSchema(schema, name),
      ])
    )
  if (copy.items) copy.items = documentSchema(copy.items)
  if (copy.anyOf)
    copy.anyOf = copy.anyOf.map((schema) => documentSchema(schema, key))
  return copy
}
function desktopSchema(schema, input = false) {
  if (schema.nullable)
    return { anyOf: [desktopSchema(schema.nullable, input), { type: "null" }] }
  if (schema.type === "object")
    return object(
      Object.fromEntries(
        Object.entries(schema.properties).map(([key, value]) => [
          key,
          desktopSchema(value, input),
        ])
      ),
      Object.entries(schema.properties)
        .filter(([, value]) => !input || !value.nullable)
        .map(([key]) => key)
    )
  if (schema.items)
    return { ...schema, items: desktopSchema(schema.items, input) }
  return schema
}
const allSchemas = {
  ...schemas,
  ...Object.fromEntries(
    Object.entries(desktopSchemas).flatMap(([name, schema]) => [
      [`Desktop.${name}`, desktopSchema(schema)],
      [`DesktopInput.${name}`, desktopSchema(schema, true)],
    ])
  ),
}
function prefixDesktop(value, prefix = "Desktop") {
  if (value.$ref) return { ...value, $ref: `${prefix}.${value.$ref}` }
  if (value.properties)
    return {
      ...value,
      properties: Object.fromEntries(
        Object.entries(value.properties).map(([key, schema]) => [
          key,
          prefixDesktop(schema, prefix),
        ])
      ),
    }
  if (value.items)
    return { ...value, items: prefixDesktop(value.items, prefix) }
  if (value.anyOf)
    return {
      ...value,
      anyOf: value.anyOf.map((part) => prefixDesktop(part, prefix)),
    }
  return value
}
for (const [key, value] of Object.entries(allSchemas))
  allSchemas[key] = documentSchema(
    key.startsWith("DesktopInput.")
      ? prefixDesktop(value, "DesktopInput")
      : key.startsWith("Desktop.")
        ? prefixDesktop(value)
        : value
  )
export function collectReferencedSchemas(
  roots,
  registry = allSchemas,
  operation = "documentation"
) {
  const selected = {},
    visited = new Set()
  function visit(schema) {
    if (schema.$ref && !visited.has(schema.$ref)) {
      if (!registry[schema.$ref])
        throw new Error(`${operation}: missing schema ${schema.$ref}`)
      visited.add(schema.$ref)
      selected[schema.$ref] = registry[schema.$ref]
      visit(registry[schema.$ref])
    }
    Object.values(schema.properties ?? {}).forEach(visit)
    if (schema.items) visit(schema.items)
    schema.anyOf?.forEach(visit)
  }
  roots.forEach(visit)
  return selected
}
function sourceFiles(directory) {
  return readdirSync(resolve(projectRoot, directory), {
    withFileTypes: true,
  }).flatMap((entry) =>
    entry.isSymbolicLink()
      ? []
      : entry.isDirectory()
        ? sourceFiles(`${directory}/${entry.name}`)
        : /\.(?:tsx?|mjs)$/.test(entry.name) &&
            !/\.generated\.|\.catalog\./.test(entry.name)
          ? [`${directory}/${entry.name}`]
          : []
  )
}
const uses = () =>
  sourceFiles("src")
    .concat(sourceFiles("backend/plugins"))
    .map((path) => ({
      path,
      text: readFileSync(resolve(projectRoot, path), "utf8"),
    }))
// Verified call sites. Dynamic wrappers (OpenCLI management actions) are listed
// explicitly; module ownership alone is never evidence that an operation is used.
const pluginCallers = {
  "mcp-service": Object.fromEntries(
    Object.keys(mcpServiceOperations).map((name) => [name, ["web.tsx"]])
  ),
  logs: { query: ["web.tsx"], detail: ["web.tsx"] },
  "file-workbench": {
    git: ["git-viewer.tsx"],
    gitDiff: ["git-viewer.tsx"],
    tree: ["web.tsx"],
    info: ["web.tsx"],
    text: ["web.tsx"],
    bytes: ["web.tsx"],
    state: ["web.tsx"],
    reference: ["web.tsx"],
    selection: ["web.tsx", "pdf-viewer.tsx"],
    view: ["web.tsx"],
  },
  opencli: Object.fromEntries(
    [...openCliManagement, "status"].map((name) => [name, ["web.tsx"]])
  ),
  "remote-access": {
    connection: ["web.tsx"],
    reset: ["web.tsx"],
    uploadReservations: ["web.tsx"],
    uploadIsolate: ["web.tsx"],
    directories: ["directory-chooser.tsx"],
    uploadStart: ["upload-client.ts"],
    uploadChunk: ["upload-client.ts"],
    uploadFinish: ["upload-client.ts"],
    uploadStatus: ["upload-client.ts"],
    uploadDiscard: ["upload-client.ts"],
  },
}
export function createApiDocumentation() {
  const callers = uses(),
    documents = {}
  const consumers = (id) =>
    callers
      .filter((file) =>
        new RegExp(
          `\\b(?:rpcCall|invoke|call)\\s*(?:<[^\\n]*?>)?\\s*\\(\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`
        ).test(file.text)
      )
      .map((file) => file.path)
  const register = (id, definition, facts) => {
    const request = documentSchema(definition.request),
      response = documentSchema(definition.response)
    if (id.startsWith("opencli.") && request.properties?.expectedDaemonPid) {
      const action = id.slice("opencli.".length)
      const rules =
        action === "stop"
          ? {
              pid: "停止时：省略按内部哨兵0处理；若后台运行，会因PID不匹配拒绝，不会猜测停止当前进程。后台已停止时无需PID。",
              version:
                "停止时：提供则核对当前后台版本；省略不增加该版本条件，PID条件仍成立。",
            }
          : ["upgrade", "uninstall"].includes(action)
            ? {
                pid: "升级/卸载时：后台运行则必须与实际PID一致；后台已停止时可省略。",
                version:
                  "升级/卸载时：后台运行则必须与实际版本一致；后台已停止时可省略。",
              }
            : {
                pid: "安装/启动流程当前不使用此字段，可省略。",
                version: "安装/启动流程当前不使用此字段，可省略。",
              }
      request.properties.expectedDaemonPid.description = rules.pid
      request.properties.expectedDaemonVersion.description = rules.version
    }
    const defaults = {
      materialPrepare: { scope: "selected" },
      conversationList: { filter: {} },
      conversationSend: { materials: [], delivery: "followUp" },
    }
    const fileDefaults = {
      "file-workbench.tree": { path: "." },
      "file-workbench.text": { offset: 0, line: 1, expected: "" },
      "file-workbench.bytes": { offset: 0, expected: "", purpose: "preview" },
    }
    for (const [key, value] of Object.entries(fileDefaults[id] ?? {}))
      if (request.properties?.[key]) request.properties[key].default = value
    for (const [key, value] of Object.entries(defaults[id] ?? {}))
      if (request.properties?.[key]) request.properties[key].default = value
    const absence = {
      pluginCall: {
        sessionId: "省略时为应用级调用；session范围操作必须提供有效会话",
        generation: "省略时使用当前激活代次，不提供代次前置条件",
      },
      sessionApply: {
        revision: "新建时省略；更新必须传当前revision，没有通用默认版本",
      },
      conversationRead: {
        afterVersion: "当前实现返回完整快照，此字段不改变读取结果",
      },
      conversationFollow: {
        epoch: "省略或不同于当前epoch时返回完整快照",
        afterVersion: "省略时返回完整快照",
      },
      conversationQueueEdit: { clientEditId: "省略时不提供客户端编辑回执身份" },
    }
    for (const [key, description] of Object.entries(absence[id] ?? {}))
      if (request.properties?.[key])
        request.properties[key].description = [
          request.properties[key].description,
          description,
        ]
          .filter(Boolean)
          .join("；")
    documents[id] = {
      definition: { ...definition, request, response },
      schemas: collectReferencedSchemas(
        [request, response, { $ref: "RpcFailure" }],
        allSchemas,
        id
      ),
      ...facts,
    }
  }
  for (const [id, operation] of Object.entries(operations)) {
    const service = serviceRegistry[serviceRoot(operation.method)]
    register(id, operation, {
      kind: "rpc",
      module: operation.module ?? "模型配置",
      source: service.source,
      storage: service.storage,
      responsibility: moduleResponsibilities[operation.module ?? "模型配置"],
      consumers: consumers(id),
    })
  }
  const plugins = {
    "mcp-service": [mcpServiceOperations, mcpServiceModule],
    logs: [logsOperations, logsModule],
    "file-workbench": [fileOperations, fileModule],
    opencli: [openCliOperations, openCliModule],
    "remote-access": [remoteOperations, remoteModule],
  }
  for (const [plugin, [registered, module]] of Object.entries(plugins))
    for (const [name, operation] of Object.entries(registered)) {
      const envelope = {
        ...operations.pluginCall,
        title: operation.title,
        effect: operation.effect,
        example: {
          id: plugin,
          operation: name,
          ...(operation.scope === "session" ? { sessionId: "session-id" } : {}),
          payload: JSON.stringify(operation.example),
        },
      }
      const output =
        plugin === "file-workbench"
          ? object({ value: fileDocumentationOutputs[name] })
          : operation.documentationOutput
      register(
        `${plugin}.${name}`,
        {
          ...envelope,
          module: operation.module,
          request: operation.input,
          response: {
            ...output,
            description:
              "实际插件结果以 value 包装。这里说明已知字段；运行时仍沿原开放 output，不额外拒绝字段。",
          },
          result: "{ value: 插件原结果 }",
          condition: `${operation.condition} 调用范围：${operation.scope ?? "application"}；remote=${operation.remote}。`,
          errors: operation.errors,
        },
        {
          kind: "plugin",
          plugin,
          name,
          envelope,
          module: operation.module,
          source: module.source,
          storage: module.storage,
          responsibility: module.responsibility,
          consumers: (pluginCallers[plugin][name] ?? []).map(
            (file) => `backend/plugins/${plugin}/${file}`
          ),
        }
      )
    }
  for (const [id, command] of Object.entries(desktopCommands)) {
    const response =
      command.result === "OptionalString"
        ? { anyOf: [str("用户选择的实际绝对路径"), { type: "null" }] }
        : command.result
          ? { $ref: `Desktop.${command.result}` }
          : nullValue
    register(
      id,
      {
        title: command.title,
        module: command.module,
        request: command.input
          ? object({ input: { $ref: `DesktopInput.${command.input}` } })
          : empty,
        response,
        effect: command.effect,
        condition:
          "必须从获授权的 Tauri 窗口调用。请求中Rust Option字段可省略并按None处理，响应中对应字段仍存在并可为null。启动、首启和维护状态的具体允许条件按实际命令及 capabilities 决定；网页只读文档。",
        errors:
          "原生命令拒绝返回 DesktopIssue；当前命令未完成不表示业务未执行。",
        result: command.result ?? "null",
        example: {},
      },
      {
        kind: "desktop",
        module: command.module,
        source: command.source,
        storage: "桌面数据根、profile、维护记录及原生系统状态",
        responsibility: moduleResponsibilities[command.module],
        consumers: consumers(id),
      }
    )
  }
  const extra = {
    model_request: {
      title: "业务 RPC 通用传输",
      request: object({
        requestId: str("本次传输标识，最多100字符"),
        operation: str("已登记RPC标识，不允许以$开头，最多100字符"),
        input: {
          description:
            "对应 operation 的真实入参；从本页业务接口查看完整契约。可为其定义允许的JSON值。",
        },
      }),
      response: {
        description:
          "对应业务接口返回值。以 operation 关联本目录全部 RPC 契约，不复制或虚构另一套业务字段。",
      },
      effect: "通过 Rust 所有的 Node JSON 行桥执行同一业务RPC。",
      condition:
        "普通输入序列化最多1MiB；materialUpload/pluginCall最多16MiB。普通等待60秒，workspaceChoose/materialChoose610秒；超时取消原等待。",
    },
    cancel_model_request: {
      title: "取消原 RPC 等待",
      request: object({ requestId: str("原 model_request 的请求身份") }),
      response: nullValue,
      effect: "结束原等待并向 Node 发送 $cancel；不证明已接受的业务未执行。",
      condition: "仅取消原传输请求，后续按原业务操作身份核对。",
    },
    open_authorization_url: {
      title: "在系统浏览器打开授权链接",
      request: object({
        url: str("HTTPS 授权链接；最多16000字符，不得包含CR/LF/NUL"),
      }),
      response: nullValue,
      effect: "打开系统浏览器进行用户授权。",
      condition: "沿既有 OAuth 专用函数，仅接受HTTPS；不用于开发工具开页。",
    },
    open_developer_tools: {
      title: "打开固定开发工具网页",
      request: object({
        tool: {
          ...str("固定工具标识"),
          enum: ["project", "components", "api"],
        },
      }),
      response: nullValue,
      effect:
        "在系统浏览器打开可信 dev 来源下的 /project/、/ui-catalog/ 或 /api-catalog/ 页面。",
      condition:
        "仅debug dev、main窗口、已配置的回环开发来源；正式发行拒绝，不接受任意URL。",
    },
    open_local_url: {
      title: "在系统浏览器打开本机回环页面",
      request: object({
        url: str("本机回环 HTTP 链接；最多16000字符，不得包含CR/LF/NUL"),
      }),
      response: nullValue,
      effect: "打开系统浏览器访问本机回环页面，如插件托管的工作台。",
      condition:
        "仅放行 http://127.0.0.1、http://localhost、http://[::1] 回环地址；其余来源由授权链接命令承担。",
    },
  }
  for (const [id, entry] of Object.entries(extra))
    register(
      id,
      {
        ...entry,
        module: "桌面传输与开页",
        errors: "返回原命令具体失败字符串；浏览器环境不能执行。",
        result: id === "model_request" ? "所选RPC返回值" : "null",
        example: {},
        input: [],
      },
      {
        kind: "desktop",
        module: "桌面传输与开页",
        source:
          id === "open_developer_tools"
            ? "src-tauri/src/developer_tools.rs"
            : "src-tauri/src/models.rs",
        storage: "原传输等待与系统浏览器；业务数据沿对应RPC所有者",
        responsibility: "桥接真实业务传输、取消和固定用途开页。",
        consumers: consumers(id),
        related: id === "model_request" ? Object.keys(operations) : [],
      }
    )
  const entry = readFileSync(
    resolve(projectRoot, "src-tauri/src/lib.rs"),
    "utf8"
  )
  const handler = entry.match(/generate_handler!\[([\s\S]*?)\]/)?.[1]
  if (!handler) throw new Error("无法读取 Tauri generate_handler 注册集合。")
  const actual = [...handler.matchAll(/\w+::(\w+)/g)].map((match) => match[1])
  const documented = Object.entries(documents)
    .filter(([, item]) => item.kind === "desktop")
    .map(([id]) => id)
  const missing = actual.filter((id) => !documented.includes(id)),
    stale = documented.filter((id) => !actual.includes(id))
  if (missing.length || stale.length)
    throw new Error(
      `原生命令目录覆盖不一致：缺失 ${missing.join(",")}；残留 ${stale.join(",")}`
    )
  for (const [plugin, [registered]] of Object.entries(plugins)) {
    const host = readFileSync(
      resolve(projectRoot, `backend/plugins/${plugin}/host.mjs`),
      "utf8"
    )
    const actual =
      plugin === "remote-access"
        ? [...host.matchAll(/\.\.\.remoteOperations\.(\w+)/g)]
            .map((match) => match[1])
            .concat(
              [
                ...readFileSync(
                  resolve(
                    projectRoot,
                    "backend/plugins/remote-access/uploads.mjs"
                  ),
                  "utf8"
                ).matchAll(/\b(\w+):\s*operation\(/g),
              ].map((match) => match[1])
            )
        : [...host.matchAll(/\b(\w+):\s*operation\(/g)]
            .map((match) => match[1])
            .concat(plugin === "opencli" ? openCliManagement : [])
    const declared = Object.keys(registered)
    if (
      actual.some((name) => !declared.includes(name)) ||
      declared.some((name) => !actual.includes(name))
    )
      throw new Error(`${plugin}: 宿主真实操作与共享契约不一致`)
  }
  return documents
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv.includes("--check"))
    throw new Error("使用 --check 核对接口目录。")
  const documents = createApiDocumentation()
  console.log(
    `接口目录覆盖通过：${Object.keys(documents).length} 项 RPC、内置插件操作和真实注册原生命令。`
  )
}
