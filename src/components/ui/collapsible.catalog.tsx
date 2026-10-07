import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "collapsible",
  name: "折叠",
  source: "src/components/ui/collapsible.tsx",
  group: "浮层与导航",
  layer: "基础组件",
  order: 24,
  pages: ["首页"],
  stage: "content",
  description: "按需展开工具的完整详情。",
  boundary: "隐藏次要信息，不隐藏选择、可用状态与失败恢复动作。",
  standards: [
    {
      id: "O1",
      name: "摘要与详情层级",
      rule: "首行保留名称、必要状态和选择，详细参数按需展开。",
      reason: "列表扫描和深读是不同任务，不能多层嵌套阻碍选择。",
      check: "不展开也能选择；展开不移动其他行的扫描起点。",
    },
    {
      id: "O2",
      name: "明确状态",
      rule: "Trigger表达展开/收起，键盘可用，长说明在所属列表滚动。",
      reason: "用户需要知道详情能关闭且不会丢失选择。",
      check: "Enter展开/收起，再勾选工具确认互不影响。",
    },
  ],
  inputs: [
    "open / defaultOpen / onOpenChange",
    "Trigger 与 Content 联动；关闭不清空上层候选",
  ],
  events: ["onOpenChange 仅改变详情展开"],
  composition: [
    "直接复用 src/components/ui/collapsible.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["展开读取文件详情，再按Enter收起。"],
      expected: "展开状态明确、焦点保留，说明不冒充操作反馈。",
      render: () => <BasicControlExample kind="collapsible" mode="normal" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "展开读取文件详情，再按Enter收起。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="collapsible" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
