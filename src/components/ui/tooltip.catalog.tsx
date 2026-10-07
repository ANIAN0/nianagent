import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "tooltip",
  name: "悬停提示",
  source: "src/components/ui/tooltip.tsx",
  group: "浮层与导航",
  layer: "基础组件",
  order: 23,
  pages: ["首页"],
  stage: "content",
  description: "补充当前画面缺失的操作含义、截断名称或不可用原因。",
  boundary:
    "不重复完整标签、不承载操作、不替代错误恢复；完整入口与短菜单选项不用。",
  standards: [
    {
      id: "H1",
      name: "使用条件",
      rule: "只在信息实际缺失时出现，所属操作浮层展开后抑制入口提示。",
      reason: "重复浮窗增加遮挡，对选择没有帮助。",
      check: "完整标签无重复提示；图标或截断内容才补全。",
    },
    {
      id: "H2",
      name: "统一外观",
      rule: "项目Tooltip：500ms延时、13px/20px、8px圆角、深底浅字、水平12px/垂直6px、最大320px、上方优先且保留12px视口边界。",
      reason: "说明在各入口应有一致阅读和识别方式。",
      check: "鼠标和键盘触发；窄窗换行，无原生提示叠加。",
    },
  ],
  inputs: [
    "Trigger asChild；Content 内容为缺失的文字信息",
    "由TooltipProvider统一延时；不使用原生HTML title",
  ],
  events: ["hover/focus 只展示说明；实际点击由触发器执行"],
  composition: [
    "直接复用 src/components/ui/tooltip.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: [
        "鼠标移到打开文件图标，或Tab聚焦。",
        "移开/Escape关闭，点击按钮查看独立事件。",
      ],
      expected: "只补缺失文件来源，统一项目样式，不抢点击或重复原生提示。",
      render: () => <BasicControlExample kind="tooltip" mode="normal" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "鼠标移到打开文件图标，或Tab聚焦。",
        "移开/Escape关闭，点击按钮查看独立事件。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="tooltip" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
