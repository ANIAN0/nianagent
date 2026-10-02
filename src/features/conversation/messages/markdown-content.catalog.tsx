import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { MarkdownContent } from "./markdown-content"
export default {
  id: "conversation-markdown",
  name: "Agent 富文本",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/markdown-content.tsx",
  description: "Agent 正文的标题、列表、引用、表格与代码。",
  boundary: "仅解析 Markdown；不执行原始 HTML。用户原文不使用此组件。",
  inputs: ["text: Markdown 字符串"],
  events: ["复制代码", "在新标签页打开链接"],
  composition: ["CopyButton"],
  consumers: ["AssistantMessage", "ThinkingBlock"],
  viewport: { width: 780, height: 580 },
  states: [
    {
      id: "nested-checklist",
      name: "嵌套任务与长代码",
      condition: "已完成与待完成项、二级解释、宽表格和长代码共存",
      expected:
        "只读状态清楚，嵌套文档流正常；代码和表格局部滚动，不撑宽消息。",
      render: () => (
        <div className="p-6">
          <MarkdownContent
            text={
              "## 交付检查\n\n- [x] 保留历史记录\n  - 标题与工作目录保持一致\n  - [x] 已验证恢复阅读位置\n- [ ] 处理离线重连\n\n> 失败后保留原有输入，不重复提交。\n\n| 检查项 | 条件 | 预期 |\n| --- | --- | --- |\n| 长工作目录 | H:/workspace/moon/packages/conversation/features/messages/components | 可局部滚动 |\n\n```ts\nconst conversation = { id: 'conversation-2026', workspace: 'H:/workspace/moon/packages/conversation/features/messages/components', title: '整理项目结构' }\n```"
            }
          />
        </div>
      ),
    },
    {
      id: "rich",
      name: "完整正文",
      condition: "包含常用 Markdown",
      expected: "正文14/24，代码和表格局部横向滚动。",
      render: () => (
        <div className="p-6">
          <MarkdownContent
            text={
              "## 已完成检查\n\n保留 **已确认设计**，这里只调整 `src/features` 的职责。\n\n- 首页入口\n- 对话阅读区\n\n> 模拟数据不连接后端。\n\n| 组件 | 职责 |\n| --- | --- |\n| Message | 消息排列 |\n| Composer | 输入提交 |\n\n```tsx\nconst page = <ConversationPage />\n```"
            }
          />
        </div>
      ),
    },
    {
      id: "streaming",
      name: "未闭合内容",
      condition: "模拟逐字输出",
      expected: "不完整代码块仍安全显示。",
      render: () => (
        <div className="p-6">
          <MarkdownContent
            text={"正在核对入口。\n\n```ts\nconst state = { ready: true"}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
