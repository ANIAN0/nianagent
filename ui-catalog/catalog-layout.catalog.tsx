import type { CatalogEntry } from "./catalog"
import { CatalogLayoutExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-layout",
  name: "组件库布局",
  layer: "页面",
  group: "组件维护",
  source: "ui-catalog/catalog-layout.tsx",
  description: "组件树、预览、文档的三栏布局，窄屏使用键盘可达的面板切换。",
  boundary:
    "布局只接收 ReactNode 面板与受控 panel/narrow。正式入口注入真实目录组件；展示环境注入正式组件和独立内存状态，不启动后端或递归预览目录自身。",
  inputs: [
    "narrow：由实际媒体查询结果提供。",
    "panel / onPanelChange：窄屏受控面板。",
    "navigation / preview / docs：三栏正式内容。",
  ],
  events: [
    "窄屏 Tabs 支持方向键切换、Tab 进入当前面板；桌面分隔条支持键盘与拖动。",
  ],
  composition: ["ResizablePanelGroup、Tabs"],
  consumers: ["CatalogPage"],
  viewport: { width: 1280, height: 800 },
  states: [
    {
      id: "desktop",
      name: "三栏",
      condition: "桌面模式注入正式导航、工具条与文档。",
      expected:
        "三栏可独立滚动与调整宽度，选择组件同步文档，重置只更新当前演示。",
      render: () => <CatalogLayoutExample />,
    },
    {
      id: "narrow",
      name: "窄屏面板",
      condition: "narrow=true；将画布宽度调整到390/320检查。",
      expected: "组件、预览、文档可切换，切回组件保留搜索，箭头键可切换Tabs。",
      render: () => <CatalogLayoutExample narrow />,
    },
  ],
} satisfies CatalogEntry
