import type { CatalogEntry } from "./catalog"
import { CatalogSourceExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-source",
  name: "正式源码查看",
  layer: "复合组件",
  group: "组件维护",
  source: "ui-catalog/catalog-source.tsx",
  description: "用户展开后按需读取正式源码，提供载入、错误与重试反馈。",
  boundary:
    "默认使用loadSource读取指定正式文件；readSource是明确的读取依赖边界。组件切换或折叠时取消未完成读取，不让旧结果进入新组件。",
  inputs: [
    "entry：当前组件元数据。",
    "readSource(entry,signal)：可注入的读取边界，默认loadSource。",
    "defaultOpen：初始展开，默认false。",
  ],
  events: ["展开加载、折叠取消、失败后重试。"],
  composition: ["Alert、Button"],
  consumers: ["CatalogDocs"],
  viewport: { width: 520, height: 400 },
  states: [
    {
      id: "ready",
      name: "读取成功",
      condition: "独立读取边界返回演示源码。",
      expected: "显示路径与可聚焦滚动源码；折叠再打开仍可读。",
      render: () => <CatalogSourceExample />,
    },
    {
      id: "loading",
      name: "载入中",
      condition: "读取延迟2.5秒，可立即折叠取消。",
      expected: "载入提示可读，折叠不会出现旧请求错误，重新打开后读取。",
      render: () => <CatalogSourceExample slow />,
    },
    {
      id: "error",
      name: "失败并重试",
      condition: "首次读取失败，第二次返回演示源码。",
      expected: "错误明确且重试按钮可操作；成功后错误被源码替换。",
      render: () => <CatalogSourceExample failure />,
    },
  ],
} satisfies CatalogEntry
