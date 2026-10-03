import type { CatalogEntry } from "./catalog"
import { CatalogOverviewExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-overview",
  name: "组件状态概览",
  layer: "复合组件",
  group: "组件维护",
  source: "ui-catalog/catalog-overview.tsx",
  description: "集中阅读状态条件、预期与真实交互，按当前展开项装载预览。",
  boundary:
    "同一组件仅一个状态iframe在运行；折叠卸载演示环境；所有状态仍有条件、预期和独立画布入口。",
  inputs: [
    "entry/stateId：当前组件与状态。",
    "theme/revision：主题与全局重置。",
    "onInspectState/onNavigate/hrefFor：概览状态与URL、独立画布联动。",
  ],
  events: ["展开/折叠、当前状态重置、进入状态画布。"],
  composition: ["Badge、Button、CatalogPreviewFrame"],
  consumers: ["CatalogPage"],
  viewport: { width: 800, height: 700 },
  states: [
    {
      id: "states",
      name: "单一展开与重置",
      condition: "展示现有正式Button的终端状态，避免目录自引用。",
      expected:
        "展开第二状态卸载第一iframe；条件与预期保留；独立重置恢复状态，键盘可展开和进入画布。",
      render: () => <CatalogOverviewExample />,
    },
  ],
} satisfies CatalogEntry
