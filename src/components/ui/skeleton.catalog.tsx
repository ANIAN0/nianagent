import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "skeleton",
  name: "骨架",
  source: "src/components/ui/skeleton.tsx",
  group: "内容与反馈",
  layer: "基础组件",
  order: 29,
  pages: ["首页"],
  stage: "content",
  description: "表达首次读取尚无内容的布局占位。",
  boundary: "不表示已成功或已选择；已有内容重新读取时不得无故全部清空。",
  standards: [
    {
      id: "N1",
      name: "形状对应内容",
      rule: "占位接近将出现的行尺寸，不增加虚假的按钮或选择状态。",
      reason: "等待时保持布局可预测。",
      check: "读完后替换内容，动作区不跳出视口。",
    },
    {
      id: "N2",
      name: "等待可识别",
      rule: "提供可访问等待说明；不将骨架载入记为业务通过。",
      reason: "视觉动画不是可读状态，也不是验收证据。",
      check: "等待和完成区分清楚，停止读取后不留骨架。",
    },
  ],
  inputs: [
    "className 决定对应内容尺寸",
    "role/status文字由使用方提供；完成替换真实内容",
  ],
  events: ["无默认交互；示例的完成读取只是环境控制"],
  composition: [
    "直接复用 src/components/ui/skeleton.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["观察工具列表占位。", "点击完成读取。"],
      expected: "等待有可访问文字，真实内容替换占位，不伪装已成功。",
      render: () => <BasicControlExample kind="skeleton" mode="normal" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "观察工具列表占位。",
        "点击完成读取。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="skeleton" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
