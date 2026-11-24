const obj = (properties, required = Object.keys(properties)) => ({
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

export const skillTools = [
  {
    name: "list_skills",
    description: "列出 Skill 工作台中的所有 Skill 及其当前版本号。",
    inputSchema: obj({}),
    shareable: true,
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_skill_blocks",
    description:
      "读取指定 Skill 的结构化段落列表（每段含 blockId、顺序、标题、正文与评估状态）及附属文件列表。",
    inputSchema: obj({ skillId: str("Skill ID") }),
    shareable: true,
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_block_lineage",
    description:
      "查看指定段落的完整生命周期：何时加入、经历了哪几次修改、每次修改前后的内容与修改原因。",
    inputSchema: obj({
      skillId: str("Skill ID"),
      blockId: str("段落 ID"),
    }),
    shareable: true,
    annotations: { readOnlyHint: true },
  },
  {
    name: "compare_versions",
    description:
      "对比 Skill 两个版本（0 表示当前草稿）之间的段落增删改与顺序变化。",
    inputSchema: obj({
      skillId: str("Skill ID"),
      fromVersion: { type: "integer", minimum: 0 },
      toVersion: { type: "integer", minimum: 0 },
    }),
    shareable: true,
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_skill",
    description: "创建一个新的解耦 Skill（可附带初始段落），并记录创建原因。",
    inputSchema: obj(
      {
        slug: str("英文短标识，如 my-skill"),
        name: str("显示名称"),
        description: str("Skill 触发描述"),
        reason: str("创建原因"),
        initialBlocks: {
          type: "array",
          items: obj(
            { heading: str("可选段落标题"), content: str("段落正文") },
            ["content"]
          ),
        },
      },
      ["slug", "name", "description", "reason"]
    ),
    shareable: true,
    annotations: { destructiveHint: false },
  },
  {
    name: "add_block",
    description: "向 Skill 主文档插入一个自包含的新段落，必须记录加入原因。",
    inputSchema: obj(
      {
        skillId: str("Skill ID"),
        heading: str("可选段落小标题"),
        content: str("自包含段落 Markdown 正文"),
        insertIndex: { type: "integer", minimum: 0 },
        reason: str("新增此段落的原因"),
      },
      ["skillId", "content", "reason"]
    ),
    shareable: true,
    annotations: { destructiveHint: false },
  },
  {
    name: "update_block",
    description:
      "聚焦修改 Skill 中的单个段落（不影响其他段落），必须记录修改原因。",
    inputSchema: obj(
      {
        skillId: str("Skill ID"),
        blockId: str("段落 ID"),
        heading: str("可选：更新段落标题"),
        content: str("可选：更新段落正文"),
        reason: str("本次修改原因"),
      },
      ["skillId", "blockId", "reason"]
    ),
    shareable: true,
    annotations: { destructiveHint: false },
  },
  {
    name: "delete_block",
    description: "删除 Skill 中的指定段落（保留历史溯源记录），必须记录原因。",
    inputSchema: obj({
      skillId: str("Skill ID"),
      blockId: str("段落 ID"),
      reason: str("删除原因"),
    }),
    shareable: true,
    annotations: { destructiveHint: true },
  },
  {
    name: "reorder_blocks",
    description: "调整 Skill 主文档的段落排列顺序，必须记录调序原因。",
    inputSchema: obj({
      skillId: str("Skill ID"),
      orderedBlockIds: { type: "array", items: str("段落 ID") },
      reason: str("调整顺序的原因"),
    }),
    shareable: true,
    annotations: { destructiveHint: false },
  },
  {
    name: "upsert_asset",
    description: "创建或更新 Skill 同包下的附属脚本或参考文件。",
    inputSchema: obj({
      skillId: str("Skill ID"),
      relPath: str("相对路径，如 scripts/check.py"),
      content: str("文件文本内容"),
      reason: str("写入或修改原因"),
    }),
    shareable: true,
    annotations: { destructiveHint: false },
  },
  {
    name: "publish_version",
    description: "将当前草稿编译并封存为不可变版本快照（如 V1、V2）。",
    inputSchema: obj({
      skillId: str("Skill ID"),
      summary: str("版本发布说明"),
    }),
    shareable: true,
    annotations: { destructiveHint: false },
  },
]

export const readOnlyTools = new Set(
  skillTools
    .filter((tool) => tool.annotations.readOnlyHint)
    .map((tool) => tool.name)
)
