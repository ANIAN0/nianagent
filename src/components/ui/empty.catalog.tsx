import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "./empty"
export default {
  id: "empty",
  name: "Empty",
  layer: "基础组件",
  group: "反馈",
  source: "src/components/ui/empty.tsx",
  description: "对无内容或无匹配结果给出明确说明。",
  boundary: "调用方决定状态和提示，不执行搜索。",
  inputs: ["children：标题和辅助说明；className：布局。"],
  events: ["无。"],
  composition: ["EmptyHeader、EmptyTitle、EmptyDescription"],
  consumers: ["ConversationHistory"],
  viewport: { width: 320, height: 240 },
  states: [
    {
      id: "no-results",
      name: "没有匹配",
      condition: "搜索结果为空。",
      expected: "显示清晰的空结果说明。",
      render: () => (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没有找到匹配的会话</EmptyTitle>
            <EmptyDescription>试试其他关键词。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ),
    },
  ],
} satisfies CatalogEntry
