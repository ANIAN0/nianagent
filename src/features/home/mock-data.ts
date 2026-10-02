export const workspaces = [
  { id: "moon", name: "moon", path: "H:/workspace/moon" },
  { id: "notes", name: "个人笔记", path: "H:/workspace/notes" },
]
export const conversations = [
  { id: "1", workspaceId: "moon", title: "梳理首页的交互细节" },
  { id: "2", workspaceId: "moon", title: "检查项目目录结构" },
  { id: "3", workspaceId: "moon", title: "整理开发环境" },
  { id: "4", workspaceId: "notes", title: "整理本周的工作笔记" },
  { id: "5", workspaceId: "notes", title: "阅读资料与摘要" },
]
export const models = ["DeepSeek V3.2", "Claude Sonnet 4.5", "GPT-5"]
export const materials = [
  { id: "readme", name: "README.md", kind: "附件" },
  { id: "design", name: "首页设计.png", kind: "附件" },
  { id: "review", name: "代码审查", kind: "Skill" },
  { id: "writing", name: "文档整理", kind: "Skill" },
]
export type Material = (typeof materials)[number]
