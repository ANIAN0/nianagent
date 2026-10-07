import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "popover",
  name: "浮层",
  source: "src/components/ui/popover.tsx",
  group: "浮层与导航",
  layer: "基础组件",
  order: 20,
  pages: ["首页"],
  stage: "content",
  description: "为模型选择等需要搜索或多步选择的局部操作提供空间。",
  boundary: "浮层只管理展开、定位与焦点；模型列表和回写由业务组件负责。",
  standards: [
    {
      id: "P1",
      name: "内容驱动位置",
      rule: "锚定触发入口；碰到边缘调整位置，内部可滚动而不扩大页面。",
      reason: "局部选择不应脱离操作上下文。",
      check: "窄窗打开与关闭，检查锚点和视口边界。",
    },
    {
      id: "P2",
      name: "焦点连贯",
      rule: "搜索可输入；关闭回原入口，不与其他输入浮层叠开。",
      reason: "连续输入和选择需要明确焦点归属。",
      check: "输入搜索、选择、Esc关闭，再继续编辑正文。",
    },
  ],
  inputs: [
    "open / onOpenChange；Trigger asChild",
    "Content side / align / sideOffset；宽度由业务内容决定",
  ],
  events: ["展开/关闭不等于选择或保存；内部动作确认才回写"],
  composition: [
    "直接复用 src/components/ui/popover.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["打开模型浮层，搜索Vision并选择。", "再次打开按Esc关闭。"],
      expected: "搜索可输入，确认关闭并回到入口，不存在重复浮层。",
      render: () => <BasicControlExample kind="popover" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="popover" mode="disabled" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
