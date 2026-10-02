import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { ConversationHeader } from "./conversation-header"

export default {
  id: "conversation-header",
  name: "会话标题栏",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/conversation-header.tsx",
  description: "56px 会话标题栏；名称、执行状态、目录元信息及外部操作槽。",
  boundary: "不拥有执行状态，不加入尚未实现的工作侧栏操作。",
  inputs: [
    "title / workspacePath / status：当前会话事实。",
    "leading / actions：宿主提供的实际导航操作。",
  ],
  events: ["标题可聚焦查看完整文本；操作事件由注入的按钮负责。"],
  composition: ["语义 header / h1 / status"],
  consumers: ["ConversationPage"],
  viewport: { width: 880, height: 180 },
  states: [
    {
      id: "idle",
      name: "空闲",
      condition: "已命名会话。",
      expected: "单行标题，顶部固定高度。",
      render: () => <ConversationHeader title="整理项目进展" />,
    },
    {
      id: "running",
      name: "运行中",
      condition: "运行状态及工作路径。",
      expected: "状态位于标题旁，路径次要层级。",
      render: () => (
        <ConversationHeader
          title="整理项目进展"
          status="运行中"
          workspacePath="H:/workspace/moon"
        />
      ),
    },
    {
      id: "long",
      name: "长标题与等待",
      condition: "超出220px的会话名称。",
      expected: "名称省略而状态完整。",
      render: () => (
        <ConversationHeader
          title="整理项目进展、核对待办事项，并准备下一轮原型评审"
          status="等待回答"
        />
      ),
    },
  ],
} satisfies CatalogEntry
