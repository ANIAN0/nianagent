import type { HomeData, Material, SubmitWork } from "./home-types"
export const workspaces = [
  { id: "moon", name: "moon", path: "H:/workspace/moon" },
  { id: "notes", name: "个人笔记", path: "H:/workspace/notes" },
]
export const conversations = [
  {
    id: "1",
    workspaceId: "moon",
    title: "梳理首页的交互细节",
    message: "检查输入框、目录选择和工具配置的交互状态。",
    updatedLabel: "2分",
  },
  {
    id: "2",
    workspaceId: "moon",
    title: "检查项目目录结构",
    updatedLabel: "1时",
  },
  { id: "3", workspaceId: "moon", title: "整理开发环境", updatedLabel: "昨天" },
  {
    id: "4",
    workspaceId: "notes",
    title: "整理本周的工作笔记",
    updatedLabel: "昨天",
  },
  {
    id: "5",
    workspaceId: "notes",
    title: "阅读资料与摘要",
    updatedLabel: "3天",
  },
]
export const models = ["GPT-5.6 Terra", "DeepSeek V3.2", "Claude Sonnet 4.5"]
export const materials: Material[] = [
  { id: "readme", name: "README.md", kind: "附件" },
  { id: "design", name: "首页设计.png", kind: "附件" },
  {
    id: "review",
    name: "代码审查",
    kind: "Skill",
    description: "检查项目调用路径、正确性与边界情况",
  },
  {
    id: "writing",
    name: "文档整理",
    kind: "Skill",
    description: "整理文档结构、术语与引用依据",
  },
]

export const homeData: HomeData = {
  workspaces,
  conversations,
  models,
  materials,
  tools: [
    {
      id: "edit",
      name: "编辑文件",
      description: "在工作区内精确修改文件",
      group: "内置工具",
      detail: "模拟编辑能力，不会修改本地文件。",
    },
    {
      id: "read",
      name: "读取文件",
      description: "读取工作区文件内容",
      group: "内置工具",
      detail: "模拟读取能力，不会读取本地文件。",
    },
    {
      id: "browser",
      name: "浏览器操作",
      description: "检查页面结构和交互状态",
      group: "内置工具",
      detail: "模拟浏览器能力，不会打开或操作浏览器。",
    },
    {
      id: "shell",
      name: "运行命令",
      description: "执行项目验证与开发命令",
      group: "内置工具",
      detail: "模拟命令能力，不会启动终端或执行命令。",
    },
  ],
}
export const submitMockWork: SubmitWork = (draft) => {
  const workspace = workspaces.find((item) => item.id === draft.workspaceId)
  return `模拟提交已完成：${workspace?.name ?? draft.workspaceId} · ${draft.model} · ${draft.thinking} · ${draft.materials.length} 项材料 · ${draft.session.toolIds.length} 个工具 · 指令范围：${draft.session.instructionScope === "all" ? "全局与目录" : draft.session.instructionScope === "directory" ? "仅目录" : "不加载"}。未调用模型或执行任务。`
}
