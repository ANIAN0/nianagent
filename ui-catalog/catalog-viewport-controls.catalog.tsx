import type { CatalogEntry } from "./catalog"
import { CatalogViewportExample } from "./fixtures/catalog-shell"
export default {
  id: "catalog-viewport-controls",
  name: "预览尺寸控制",
  layer: "复合组件",
  group: "组件维护",
  source: "ui-catalog/catalog-viewport-controls.tsx",
  description: "组件默认、桌面、平板、手机视口预设与可校验的自定义宽高。",
  boundary:
    "宽高草稿属于控件，只有合法的240–2560宽、96–1600高十进制整数提交给页面；实际改变iframe尺寸而非缩放。",
  inputs: [
    "width / height：已应用尺寸。",
    "defaultViewport：当前组件默认。",
    "onChange(width,height)：提交合法尺寸。",
  ],
  events: ["失焦或Enter校验并应用；Escape放弃输入草稿。"],
  composition: ["FieldGroup、Field、Input、Select"],
  consumers: ["CatalogToolbar"],
  viewport: { width: 640, height: 280 },
  states: [
    {
      id: "edit",
      name: "预设与自定义",
      condition: "初始640×480；输入390后按Enter，或选择手机预设。",
      expected: "中途不夹断输入；Enter/失焦后应用；值和选择保持同步。",
      render: () => <CatalogViewportExample />,
    },
    {
      id: "invalid",
      name: "无效输入恢复",
      condition: "清空宽度或输入239并失焦。",
      expected:
        "就地显示范围错误、保留输入草稿，已应用尺寸不变；Escape恢复当前尺寸。",
      render: () => <CatalogViewportExample />,
    },
  ],
} satisfies CatalogEntry
