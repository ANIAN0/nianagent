import type { HomeData, SubmitWork } from "@/features/home/home-types"

// Deliberately separate from App's data and submission adapter.
export const homeData: HomeData = {
  workspaces: [
    { id: "demo", name: "组件演示", path: "/demo/moon" },
    { id: "notes", name: "演示笔记", path: "/demo/notes" },
  ],
  conversations: [
    { id: "layout", workspaceId: "demo", title: "检查首页布局" },
    { id: "keyboard", workspaceId: "demo", title: "验证键盘操作" },
    { id: "notes", workspaceId: "notes", title: "整理演示笔记" },
  ],
  tools: [
    {
      id: "read",
      name: "读取文件",
      description: "读取工作区文件内容",
      group: "内置工具",
      detail: "演示读取能力。",
    },
    {
      id: "edit",
      name: "编辑文件",
      description: "精确修改工作区文件",
      group: "内置工具",
      detail: "演示编辑能力。",
    },
    {
      id: "review",
      name: "代码审查",
      description: "检查代码结构",
      group: "插件",
      detail: "演示插件能力。",
    },
    {
      id: "docs",
      name: "查询文档",
      description: "检索项目文档",
      group: "MCP",
      detail: "演示 MCP 能力。",
    },
  ],
  models: ["演示模型 A", "演示模型 B"],
  materials: [
    {
      id: "readme",
      name: "演示说明.md",
      kind: "附件",
      type: "file",
      status: "ready",
      source: "/demo/moon/演示说明.md",
    },
    {
      id: "design",
      name: "演示设计.png",
      kind: "附件",
      type: "image",
      status: "ready",
      source: "/demo/moon/演示设计.png",
      mimeType: "image/png",
    },
    {
      id: "review",
      name: "演示审查",
      kind: "Skill",
      type: "skill",
      status: "ready",
      source: "/demo/moon/.agents/skills/review/SKILL.md",
    },
  ],
}

export const submitMockWork: SubmitWork = (draft) =>
  `展示回调：${draft.text}；目录 ${draft.workspaceId}；${draft.model}；${draft.thinking}；材料 ${draft.materials.length} 项；工具 ${draft.session.toolIds.length} 个；指令范围 ${draft.session.instructionScope}。`
