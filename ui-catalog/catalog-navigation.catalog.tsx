import type { CatalogEntry } from "./catalog"
import { CatalogNavigationExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-navigation",
  name: "组件树导航",
  layer: "复合组件",
  group: "组件维护",
  source: "ui-catalog/catalog-navigation.tsx",
  description:
    "按组件层级与功能组织组件和状态，支持搜索、选中定位与可直接访问的地址。",
  boundary:
    "仅使用静态元数据，query和导航回调由页面提供；不装载全部组件render。",
  inputs: [
    "component/stateId/view：当前选择。",
    "query/onQueryChange：受控搜索。",
    "onNavigate/hrefFor：导航与保留主题、尺寸的地址。",
  ],
  events: ["搜索结果自动展开状态；清除恢复目录；修饰键保留浏览器链接行为。"],
  composition: ["InputGroup、Button、Empty"],
  consumers: ["CatalogPage"],
  viewport: { width: 320, height: 600 },
  states: [
    {
      id: "tree",
      name: "分组与选择",
      condition: "当前选择Button，独立内存状态。",
      expected:
        "树分层、分组和状态地址可读；选择不修改真实业务数据；可折叠当前组件。",
      render: () => <CatalogNavigationExample />,
    },
    {
      id: "no-results",
      name: "无结果恢复",
      condition: "预填不存在的组件关键词。",
      expected: "明确无结果提示与清除入口；清除后恢复组件树。",
      render: () => <CatalogNavigationExample empty />,
    },
  ],
} satisfies CatalogEntry
