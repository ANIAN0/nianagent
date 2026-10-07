import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "checkbox",
  name: "复选框",
  source: "src/components/ui/checkbox.tsx",
  group: "操作与选择",
  layer: "基础组件",
  order: 11,
  pages: ["首页"],
  stage: "content",
  description: "多选工具；勾选状态与标签共同表达选择。",
  boundary: "复选框不决定工具可用性；列表层提供可用原因、详情与保存操作。",
  standards: [
    {
      id: "C1",
      name: "选择与标签一起操作",
      rule: "点击方框或其关联标签改变同一选择；状态不能只靠颜色表达。",
      reason: "工具可以多选，方框语义使选择数量可预测。",
      check: "点击标签、空格切换；禁用标签也不能改变值。",
    },
    {
      id: "C2",
      name: "对齐与可用性",
      rule: "多行列表方框与首行名称对齐；不可用原因保留可读说明。",
      reason: "首行对齐形成共同扫描轴；说明不能挤压选择目标。",
      check: "检查长说明、未选、选中、不可用。",
    },
  ],
  inputs: [
    "checked / defaultChecked；受控 checked 可为 true / false / indeterminate",
    "disabled；id 与 FieldLabel htmlFor 关联",
  ],
  events: ["onCheckedChange 回写候选，不等于配置保存"],
  composition: [
    "直接复用 src/components/ui/checkbox.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["点击读取文件标签。", "按空格切换选择并查看事件。"],
      expected: "方框与标签共同操作同一布尔值。",
      render: () => <BasicControlExample kind="checkbox" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="checkbox" mode="disabled" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
