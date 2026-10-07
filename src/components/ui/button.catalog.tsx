import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "button",
  name: "按钮",
  source: "src/components/ui/button.tsx",
  group: "操作与选择",
  layer: "基础组件",
  order: 10,
  pages: ["首页"],
  stage: "content",
  description: "触发动作，按主次区分应用、取消与图标动作。",
  boundary: "按钮只发出事件，不自行保存配置；业务决定禁用和忙状态。",
  standards: [
    {
      id: "B1",
      name: "层级与同级一致",
      rule: "主提交使用填充；取消与次要操作使用弱层级。输入工具栏三个选择入口共用 composer 变体和尺寸。",
      reason: "形状和强调表达任务层级；同级入口不能因分别实现而产生不同外观。",
      check: "对比默认、焦点、展开、禁用；三个入口28px高、13px/20px、400字重。",
    },
    {
      id: "B2",
      name: "可识别与可达",
      rule: "纯图标按钮提供可访问名称，缺少的操作含义才由Tooltip补充。",
      reason: "图标节省位置但不能丢失动作名称；完整文字标签无需重复提示。",
      check: "Tab定位、Enter/Space触发；禁用无法触发；检查图标名称。",
    },
  ],
  inputs: [
    "variant: default / outline / ghost / composer / insight / send / approval / approval-reject；insight 为会话用量入口，悬停及展开使用局部底色、按下不位移、内侧焦点圈。",
    "size: default / sm / composer / insight（22px、12px/20px统计入口、圆形边角）/ icon / approval（36px审批动作）；disabled 阻止操作",
    "asChild 由调用方保留按钮或链接语义",
  ],
  events: ["onClick 只触发一次动作；提交期间由业务禁用重复调用"],
  composition: [
    "直接复用 src/components/ui/button.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["点击应用与取消，查看演示事件。", "Tab定位纯图标按钮并按Enter。"],
      expected: "每个动作只回调一次，纯图标有名称，主次层级清楚。",
      render: () => <BasicControlExample kind="button" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="button" mode="disabled" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
