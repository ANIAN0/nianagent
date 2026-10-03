import type { CatalogEntry } from "./catalog"
import { CatalogToolbarExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-toolbar",
  name: "组件预览工具条",
  layer: "复合组件",
  group: "组件维护",
  source: "ui-catalog/catalog-toolbar.tsx",
  description:
    "围绕当前组件组织查看方式、状态选择、真实视口、主题、重置与链接操作。",
  boundary:
    "受控 controller 来自正式 useCatalogController 或独立内存驱动；工具条不直接修改演示业务数据。",
  inputs: ["controller：选择、视口、主题、URL与重置控制。"],
  events: [
    "navigate / setViewport / toggleTheme / reset。",
    "主题按钮与 d 快捷键同步目录 URL，刷新与浏览器返回恢复对应主题。",
    "复制链接给出成功或失败反馈，独立打开当前状态。",
  ],
  composition: ["Select、CatalogViewportControls、Button"],
  consumers: ["CatalogPage"],
  viewport: { width: 900, height: 320 },
  states: [
    {
      id: "canvas",
      name: "状态画布",
      condition: "选择正式Button，独立内存驱动尺寸与重置。",
      expected:
        "选择状态、预设和尺寸可操作；主题作用当前展示文档；复制反馈可读，重置计数更新。",
      render: () => <CatalogToolbarExample />,
    },
    {
      id: "overview",
      name: "组件概览",
      condition: "不显示无作用的尺寸控制。",
      expected: "仍可切换画布、主题、复制、重置和独立打开。",
      render: () => <CatalogToolbarExample overview />,
    },
  ],
} satisfies CatalogEntry
