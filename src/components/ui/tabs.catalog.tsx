import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "tabs",
  name: "标签页",
  source: "src/components/ui/tabs.tsx",
  group: "浮层与导航",
  layer: "基础组件",
  order: 22,
  pages: ["首页"],
  stage: "content",
  description: "在会话配置的工具和项目指令两类内容间切换。",
  boundary: "切换展示分类，不自行清空候选，也不代表保存。",
  standards: [
    {
      id: "A1",
      name: "同级分类",
      rule: "使用共享Tabs样式、尺寸和上下间距，内容区从统一轴开始。",
      reason: "工具和指令是同一配置任务的两部分，不是各自独立弹窗。",
      check: "切换检查两侧、上下间距，保留工具选择。",
    },
    {
      id: "A2",
      name: "键盘语义",
      rule: "Trigger选中与关联tabpanel一致，方向键切换；不可用项跳过。",
      reason: "标签页需要符合用户对键盘导航的预期。",
      check: "方向键切换、Tab进入当前内容；禁用项不打开。",
    },
  ],
  inputs: [
    "value / defaultValue / onValueChange",
    "List / Trigger / Content 对应唯一 value；disabled可用",
  ],
  events: ["onValueChange 只改变分类，父级保存两类候选"],
  composition: [
    "直接复用 src/components/ui/tabs.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["点击项目指令，再用方向键切工具。", "Tab进入当前内容。"],
      expected: "选中Trigger与tabpanel一致，禁用标签不打开。",
      render: () => <BasicControlExample kind="tabs" mode="normal" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
