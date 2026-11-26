const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const str = (description, extra = {}) => ({
  type: "string",
  description,
  ...extra,
})

const int = (description, minimum = 0, maximum) => ({
  type: "integer",
  description,
  minimum,
  ...(maximum === undefined ? {} : { maximum }),
})

const snippetSchema = object({
  id: str("附加说明唯一标识", { minLength: 1, maxLength: 128 }),
  name: str("附加说明名称", { minLength: 1, maxLength: 120 }),
  content: str("附加说明 Markdown 内容", { maxLength: 200_000 }),
  enabled: { type: "boolean", description: "是否追加到最终统一内容" },
  source: {
    type: "string",
    enum: ["manual", "plugin"],
    description: "说明来源（manual 手动添加，plugin 插件提供）",
  },
})

const projectSummarySchema = object({
  id: str("项目唯一标识"),
  name: str("项目名称"),
  path: str("项目绝对路径"),
  source: {
    type: "string",
    enum: ["workspace", "custom"],
    description: "来源（workspace 已注册工作区，custom 插件内手动登记）",
  },
  status: {
    type: "string",
    enum: ["synced", "different", "missing", "unavailable"],
    description: "AGENTS.md 与统一版本的比对状态",
  },
  filePath: str("目标 AGENTS.md 绝对路径"),
  updatedAt: str("文件最后修改时间，无文件时为空"),
  lineCount: int("文件行数", 0),
  unavailableReason: str("目录不可访问时的原因"),
})

export const agentsMdStatusSchema = object({
  revision: int("插件状态版本号", 0),
  baseContent: str("统一 AGENTS.md 基础正文"),
  composedContent: str("基础正文与已开启附加说明拼接后的最终内容"),
  updatedAt: str("统一内容最近保存时间"),
  snippets: {
    type: "array",
    items: snippetSchema,
    maxItems: 64,
    description: "可开关的附加说明列表",
  },
  projects: {
    type: "array",
    items: projectSummarySchema,
    description: "已登记项目的 AGENTS.md 状态列表",
  },
})

const projectDetailSchema = object({
  id: str("项目唯一标识"),
  name: str("项目名称"),
  path: str("项目绝对路径"),
  filePath: str("目标 AGENTS.md 绝对路径"),
  status: {
    type: "string",
    enum: ["synced", "different", "missing", "unavailable"],
  },
  exists: { type: "boolean" },
  content: str("项目当前 AGENTS.md 全文"),
  updatedAt: str("文件最后修改时间"),
  lineCount: int("文件行数", 0),
  diff: str("与当前统一内容的行级差异（legacy unified 行格式）"),
})

const publicationId = str("发布预览和结果查询 ID", {
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
})

const publicationInput = {
  revision: int("预览时统一内容的版本", 0),
  paths: {
    type: "array",
    items: str("目标项目绝对路径", { minLength: 1, maxLength: 4096 }),
    minItems: 1,
    maxItems: 256,
  },
}

const publicationTarget = { path: str("目标项目路径"), name: str("项目名称") }
const replaceResultSchema = object({
  publicationId,
  state: { type: "string", enum: ["previewed", "finished"] },
  results: {
    type: "array",
    items: object({
      ...publicationTarget,
      outcome: {
        type: "string",
        enum: [
          "pending",
          "created",
          "replaced",
          "conflict",
          "failed",
          "stopped",
          "unknown",
        ],
      },
      reason: str("冲突、失败、停止或待核对的原因"),
    }),
  },
})

const operation = (title, input, value, effect, example = {}) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  module: "AGENTS.md 管理",
  remote: false,
  effect,
  example,
  condition: "AGENTS.md 管理插件已启用，仅本机插件详情页可调用。",
  errors: "状态版本冲突、目录不可访问、未登记路径或磁盘写入失败。",
})

export const agentsMdModule = {
  source: "backend/plugins/agents-md/host.mjs",
  storage: "plugins/agents-md/state.json、plugins/agents-md/publications/",
  responsibility:
    "维护统一 AGENTS.md 正文与开关式附加说明，盘点并全量替换已登记项目的 AGENTS.md。",
}

export const agentsMdOperations = {
  status: operation(
    "读取统一 AGENTS.md 与各项目状态",
    object(),
    agentsMdStatusSchema,
    "读取基础正文、附加说明开关及所有已登记项目的 AGENTS.md 状态。"
  ),
  saveBase: operation(
    "保存统一 AGENTS.md 基础正文",
    object({
      revision: int("读取时状态版本", 0),
      baseContent: str("基础正文 Markdown", { maxLength: 500_000 }),
    }),
    agentsMdStatusSchema,
    "更新基础正文并重新计算所有项目的比对状态。",
    { revision: 0, baseContent: "# AGENTS.md\n" }
  ),
  saveSnippets: operation(
    "保存附加说明列表与开关状态",
    object({
      revision: int("读取时状态版本", 0),
      snippets: {
        type: "array",
        items: snippetSchema,
        maxItems: 64,
      },
    }),
    agentsMdStatusSchema,
    "保存附加说明的新增、编辑、删除或开关切换，并重新计算合成内容与项目状态。",
    { revision: 0, snippets: [] }
  ),
  chooseDirectory: operation(
    "通过系统目录选择器登记项目目录",
    object(),
    object({
      cancelled: { type: "boolean" },
      addedPath: str("新增目录路径，取消时为空"),
      status: agentsMdStatusSchema,
    }),
    "调用本机目录选择器并将所选目录登记到项目清单。"
  ),
  addDirectory: operation(
    "按路径登记项目目录",
    object({
      path: str("项目绝对目录路径", { minLength: 1, maxLength: 4096 }),
    }),
    agentsMdStatusSchema,
    "校验路径为可读目录后登记到项目清单并返回最新状态。",
    { path: "C:\\workspace\\demo" }
  ),
  removeDirectory: operation(
    "移除手动登记的项目目录",
    object({
      revision: int("读取时状态版本", 0),
      id: str("手动登记项目 ID", { minLength: 1, maxLength: 128 }),
    }),
    agentsMdStatusSchema,
    "仅从插件清单移除手动登记项，不删除磁盘文件。",
    { revision: 0, id: "custom-id" }
  ),
  readProject: operation(
    "读取指定项目的 AGENTS.md 内容与差异",
    object({
      path: str("已登记项目绝对路径", { minLength: 1, maxLength: 4096 }),
    }),
    projectDetailSchema,
    "读取已登记项目的 AGENTS.md 全文及与当前统一版本的差异。",
    { path: "C:\\workspace\\demo" }
  ),
  projectLibrary: operation(
    "项目规则库",
    object({ projectId: str("项目 ID") }),
    object({
      snippets: { type: "array", items: snippetSchema },
      templates: {
        type: "array",
        items: object({
          id: str("模板 ID"),
          name: str("模板名"),
          ids: { type: "array", items: str("片段 ID") },
        }),
      },
      selected: { type: "array", items: str("片段 ID") },
    }),
    "读取项目的有序片段与模板。"
  ),
  saveProjectTemplate: operation(
    "保存片段模板",
    object({
      name: str("模板名称", { minLength: 1, maxLength: 120 }),
      ids: {
        type: "array",
        items: str("片段 ID"),
        minItems: 1,
        uniqueItems: true,
      },
    }),
    str("模板 ID"),
    "保存一组有序引用。"
  ),
  previewProjectEdit: operation(
    "预览项目指令编辑",
    object(
      {
        projectId: str("项目 ID"),
        original: str("打开时原文"),
        exists: { type: "boolean" },
        content: str("拟写入正文", { maxLength: 500000 }),
        snippetIds: { type: "array", items: str("片段 ID"), uniqueItems: true },
        resolution: str("手工合并全文", { maxLength: 500000 }),
      },
      ["projectId", "original", "exists", "content"]
    ),
    object({
      publicationId,
      revision: int("配置版本"),
      path: str("项目路径"),
      diff: str("正文差异"),
    }),
    "记录磁盘基线与项目草稿。"
  ),
  previewReplace: operation(
    "预览 AGENTS.md 发布目标",
    object(publicationInput),
    object({
      publicationId,
      targets: {
        type: "array",
        items: object({
          ...publicationTarget,
          exists: { type: "boolean" },
          composed: { type: "boolean" },
        }),
      },
    }),
    "记录预览时的模板版本与目标文件状态。预览保留 30 分钟，每批目标文件总大小最多 64 MiB。",
    { revision: 0, paths: ["C:\\workspace\\demo"] }
  ),
  replaceProjects: operation(
    "全量替换指定项目的 AGENTS.md",
    object({ ...publicationInput, publicationId }, ["revision", "paths"]),
    replaceResultSchema,
    "凭预览 ID 逐项复核并写入。无 ID 的旧请求须先重新预览。同一 ID 重试只读取原结果。",
    {
      revision: 0,
      paths: ["C:\\workspace\\demo"],
      publicationId: "01234567-89ab-4cde-8012-3456789abcde",
    }
  ),
  replaceResult: operation(
    "查询 AGENTS.md 批量发布结果",
    object({ publicationId }),
    replaceResultSchema,
    "读取预览状态或本次操作的每项目标结果。宿主中断后核对已尝试的写入并停止其余目标。",
    { publicationId: "01234567-89ab-4cde-8012-3456789abcde" }
  ),
}
