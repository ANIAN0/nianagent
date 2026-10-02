import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { ThinkingBlock } from "./thinking-block"
const text =
  "先核对目录和实际记录。\n\n- 阅读入口\n- 核对引用\n\n确认组件来源后，再汇总已确认的进展。"
export default {
  id: "conversation-thinking",
  name: "思考内容",
  layer: "复合组件",
  group: "对话过程",
  source: "src/features/conversation/messages/thinking-block.tsx",
  description: "28px 思考摘要；展开显示沿竖线排列的 Markdown。",
  boundary: "不生成或推测思考，只展示已传入记录。",
  inputs: ["text", "running", "defaultOpen"],
  events: ["展开 / 收起"],
  composition: ["Collapsible", "MarkdownContent"],
  consumers: ["ExecutionProcess"],
  viewport: { width: 760, height: 340 },
  states: [
    {
      id: "collapsed",
      name: "已收起",
      condition: "已完成",
      expected: "摘要取第一非空行。",
      render: () => (
        <div className="p-6">
          <ThinkingBlock text={text} />
        </div>
      ),
    },
    {
      id: "expanded",
      name: "已展开",
      condition: "默认展开",
      expected: "支持 Markdown，按标题行收起。",
      render: () => (
        <div className="p-6">
          <ThinkingBlock text={text} defaultOpen />
        </div>
      ),
    },
    {
      id: "running",
      name: "思考中",
      condition: "运行状态",
      expected: "摘要取最近非空行，有辅助状态说明。",
      render: () => (
        <div className="p-6">
          <ThinkingBlock text={text} running />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
