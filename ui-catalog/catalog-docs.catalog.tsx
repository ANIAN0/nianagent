import type { CatalogEntry } from "./catalog"
import { CatalogDocsExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-docs",
  name: "组件文档面板",
  layer: "复合组件",
  group: "组件维护",
  source: "ui-catalog/catalog-docs.tsx",
  description:
    "跟随组件和状态展示契约、边界、输入、交互、组成与使用方，并按需查看正式源码。",
  boundary:
    "展示单一元数据来源；源码来自正式loadSource。实际参数类型仍以正式实现为准，关系由源码导入生成。",
  inputs: [
    "entry/stateId：当前组件与状态。",
    "onNavigate/hrefFor：相关组件链接。",
  ],
  events: ["相关组成和使用方可跳转；源码展开后载入，失败可重试。"],
  composition: ["Badge、CatalogSource"],
  consumers: ["CatalogPage"],
  viewport: { width: 420, height: 600 },
  states: [
    {
      id: "reference",
      name: "状态与组成",
      condition: "当前Button变体状态，独立导航驱动。",
      expected:
        "当前状态与契约分组清楚，长路径换行，关系链接更新文档；源码折叠不发起读取。",
      render: () => <CatalogDocsExample />,
    },
  ],
} satisfies CatalogEntry
