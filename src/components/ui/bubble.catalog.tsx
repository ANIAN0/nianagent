import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { Bubble, BubbleContent, BubbleGroup } from "./bubble"
export default {
  id: "bubble",
  name: "消息气泡",
  layer: "基础组件",
  group: "对话基础",
  source: "src/components/ui/bubble.tsx",
  description: "提供消息正文表面与对齐方式。",
  boundary: "不承担角色、消息操作和 Markdown 解析。",
  inputs: [
    "variant：default / secondary / muted / tinted / outline / ghost / destructive。",
    "align：start / end。",
  ],
  events: ["可通过 BubbleContent asChild 组合实际操作元素。"],
  composition: ["BubbleGroup、Bubble、BubbleContent"],
  consumers: ["UserMessage、AssistantMessage"],
  viewport: { width: 600, height: 420 },
  states: [
    {
      id: "variants",
      name: "表面变体",
      condition: "所有有效表面变体。",
      expected: "统一圆角和内边距，颜色随主题变化。",
      render: () => (
        <BubbleGroup>
          {(
            [
              "default",
              "secondary",
              "muted",
              "tinted",
              "outline",
              "ghost",
              "destructive",
            ] as const
          ).map((variant) => (
            <Bubble key={variant} variant={variant}>
              <BubbleContent>{variant}：核对页面内容与交互。</BubbleContent>
            </Bubble>
          ))}
        </BubbleGroup>
      ),
    },
    {
      id: "end",
      name: "尾端对齐",
      condition: "用户输入内容。",
      expected: "气泡在右侧，长内容自动换行。",
      render: () => (
        <BubbleGroup>
          <Bubble variant="tinted" align="end">
            <BubbleContent>
              请保留已经确认的布局，按原型逐项实现页面。
            </BubbleContent>
          </Bubble>
        </BubbleGroup>
      ),
    },
  ],
} satisfies CatalogEntry
