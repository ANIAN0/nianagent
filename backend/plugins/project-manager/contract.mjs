const object = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})
const text = { type: "string" }
const id = { type: "string", minLength: 1, maxLength: 128 }
const array = (items) => ({ type: "array", items })
const flag = { type: "boolean" }
const project = object({
  id,
  name: text,
  path: text,
  sources: array(text),
  aliases: array(text),
  available: flag,
})
const identity = { projectId: id }
const operation = (title, input, value, effect) => ({
  title,
  input,
  output: object({ value }),
  documentationOutput: object({ value }),
  effect,
  module: "项目管理",
  remote: false,
  example: {},
  condition: "本机项目管理插件已启用。",
  errors: "项目不可访问、资源不可用或预览已失效。",
})
const uuid = {
  type: "string",
  pattern: "^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$",
}
const client = {
  type: "string",
  enum: ["Moon / Pi", "Codex", "Claude Code", "Antigravity"],
}
const section = (row) => object({ items: array(row), error: text })
const skillSection = section(
  object({
    name: text,
    path: text,
    state: {
      type: "string",
      enum: [
        "unknownLink",
        "local",
        "sharedLink",
        "source",
        "missingManifest",
        "broken",
        "unreadable",
      ],
    },
  })
)
const mcpSection = section(
  object({
    name: text,
    path: text,
    client,
    scope: { enum: ["personal", "project"] },
    state: { const: "unverified" },
  })
)
const entryName = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }
const change = {
  oneOf: [
    object({ kind: { const: "mcp.cleanup" }, entryName }),
    object(
      {
        kind: { const: "skill.bind" },
        libraryId: id,
        location: {
          type: "string",
          enum: [".agents/skills", ".claude/skills"],
        },
        mode: {
          type: "string",
          enum: [
            "source",
            "link",
            "copy",
            "unlink",
            "publish",
            "detach",
            "takeover",
          ],
        },
        decisions: {
          type: "object",
          additionalProperties: { type: "string", enum: ["local", "library"] },
        },
      },
      ["kind", "libraryId", "location", "mode"]
    ),
    object({
      kind: { const: "mcp.update" },
      definitionId: id,
      target: client,
      entryName,
    }),
    object({
      kind: { const: "mcp.bind" },
      definitionId: id,
      targets: { ...array(client), minItems: 1, uniqueItems: true },
      entryName,
    }),
    object({ kind: { const: "mcp.remove" }, target: client, entryName }),
    object({
      kind: { const: "agents.edit" },
      content: { type: "string", maxLength: 500000 },
    }),
    object(
      {
        kind: { const: "agents.append" },
        snippetIds: { ...array(id), uniqueItems: true },
        resolution: text,
      },
      ["kind", "snippetIds"]
    ),
  ],
}
export const projectManagerModule = {
  source: "backend/plugins/project-manager/host.mjs",
  storage: "projects.json、plugins/project-manager/",
  responsibility: "按登记项目聚合实际配置并协调资源操作。",
}
export const projectManagerOperations = {
  inheritedMcp: operation(
    "读取个人服务来源",
    object(identity),
    mcpSection,
    "仅返回名称、客户端及来源文件。"
  ),
  importMcp: operation(
    "从项目配置登记服务定义",
    object({ ...identity, target: client, entryName }),
    id,
    "登记可转换的基本定义。"
  ),
  listSkills: operation(
    "列出 Skill 库",
    object(identity),
    array(
      object({
        id,
        name: text,
        slug: text,
        version: { type: "integer" },
        source: text,
      })
    ),
    "从 Skill 工作台读取。"
  ),
  listDefinitions: operation(
    "读取 MCP 定义库",
    object(),
    array(id),
    "列出被动定义。"
  ),
  readDefinition: operation(
    "读取服务定义",
    object({ name: entryName }),
    object({
      name: entryName,
      command: text,
      url: text,
      args: array(text),
      envRefs: { type: "object", additionalProperties: text },
      headerRefs: { type: "object", additionalProperties: text },
      revision: { type: "integer" },
    }),
    "读取定义与凭据引用。"
  ),
  saveDefinition: operation(
    "登记 MCP 定义",
    object(
      {
        name: entryName,
        command: text,
        args: array(text),
        url: text,
        envRefs: { type: "object", additionalProperties: id },
        headerRefs: { type: "object", additionalProperties: id },
        expectedRevision: { type: "integer", minimum: 1 },
      },
      ["name", "command", "args", "url"]
    ),
    id,
    "写入定义库，不启用个人服务。"
  ),
  projectTrust: operation(
    "查看或更新 Pi 项目信任",
    object({ ...identity, trusted: flag }, ["projectId"]),
    flag,
    "显式确认后更新 Pi 信任记录。"
  ),
  verifyMcp: operation(
    "验证项目 MCP",
    object({ ...identity, entryName: id }),
    object({ state: text, testedAt: text, error: text }),
    "验证已信任的 Pi 项目服务并记录工具目录。"
  ),
  listProjects: operation(
    "列出项目",
    object({ query: text }, []),
    array(project),
    "合并手动登记目录与聊天工作区。"
  ),
  chooseDirectory: operation(
    "添加目录",
    object(),
    object({ cancelled: flag, path: text }),
    "经宿主选择器登记。"
  ),
  unregister: operation(
    "取消登记",
    object(identity),
    object({ removed: flag }),
    "移除手动来源。"
  ),
  inspectProject: operation(
    "读取项目配置",
    object(identity),
    object({
      revision: uuid,
      skills: skillSection,
      mcp: mcpSection,
      agents: object({ content: text, exists: flag, error: text }),
    }),
    "读取磁盘配置，不执行项目服务。"
  ),
  saveTemplate: operation(
    "保存模板",
    object({ name: id, ids: { ...array(id), minItems: 1, uniqueItems: true } }),
    id,
    "保存有序片段引用。"
  ),
  listLibrary: operation(
    "选择片段",
    object(identity),
    object({
      snippets: array(object({ id, name: text, content: text })),
      templates: array(object({ id, name: text, ids: array(id) })),
      selected: array(id),
    }),
    "从 AGENTS.md 管理读取片段。"
  ),
  previewChange: operation(
    "预览项目修改",
    object({ ...identity, expectedRevision: uuid, change }),
    {
      oneOf: [
        object({ previewId: uuid, diff: text }),
        object({ conflicts: array(text) }),
      ],
    },
    "记录修改前提并返回差异，未提交的预览保留 30 分钟。"
  ),
  applyChange: operation(
    "应用预览",
    object({ previewId: uuid, requestId: uuid }),
    object({ outcome: text, reason: text }),
    "重核磁盘并提交原预览。"
  ),
  getReceipt: operation(
    "查询操作回执",
    object({ requestId: uuid }),
    object({ outcome: text, reason: text }),
    "查询最近 30 天的操作回执。"
  ),
}
