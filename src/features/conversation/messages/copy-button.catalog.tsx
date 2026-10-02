import type { CatalogEntry } from "../../../../ui-catalog/catalog"
import { CopyButton } from "./copy-button"
export default {
  id: "conversation-copy-button",
  name: "内容复制",
  layer: "复合组件",
  group: "对话消息",
  source: "src/features/conversation/messages/copy-button.tsx",
  description: "复制原始正文或代码，成功勾选并恢复；失败保留重试。",
  boundary: "不复制隐藏思考或工具结果。",
  inputs: ["text", "label"],
  events: ["浏览器剪贴板写入"],
  composition: ["Button", "Tooltip"],
  consumers: ["MessageActions", "MarkdownContent"],
  viewport: { width: 360, height: 180 },
  states: [
    {
      id: "default",
      name: "可复制",
      condition: "有文本",
      expected: "点击后显示已复制；失败显示明确提示。",
      render: () => (
        <div className="p-6">
          <CopyButton text="Moon 示例文本" />
        </div>
      ),
    },
    {
      id: "empty",
      name: "无内容",
      condition: "空文本",
      expected: "按钮禁用。",
      render: () => (
        <div className="p-6">
          <CopyButton text="" />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
