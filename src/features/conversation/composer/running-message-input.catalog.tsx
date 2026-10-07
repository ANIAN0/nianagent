import type { CatalogEntry } from "../../../../ui-catalog/catalog-types"

export default {
  id: "running-message-input",
  name: "运行中发送新消息",
  group: "运行中发送新消息",
  layer: "复合组件",
  stage: "structure",
  order: 108,
  pages: ["会话"],
  source: "src/features/conversation/composer/conversation-composer.tsx",
  description: "",
  boundary: "",
  standards: [],
  inputs: [],
  events: [],
  composition: [],
  consumers: [],
  viewport: { width: 800, height: 720 },
  states: [],
} satisfies CatalogEntry
