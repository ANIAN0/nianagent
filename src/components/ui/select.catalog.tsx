import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "select",
  name: "下拉选择",
  source: "src/components/ui/select.tsx",
  group: "操作与选择",
  layer: "基础组件",
  order: 13,
  pages: ["首页"],
  stage: "content",
  description: "在工具来源等固定集合中选择筛选值。",
  boundary: "不检索资源、不保存配置；只传递选择值。",
  standards: [
    {
      id: "S1",
      name: "与搜索同级",
      rule: "搜索输入和来源选择共用高度、边界、字体，触发器包含当前来源和箭头。",
      reason: "两者共同筛选同一列表，同级视觉便于比较。",
      check: "同屏检查搜索、来源的上下和左右对齐。",
    },
    {
      id: "S2",
      name: "键盘与选择反馈",
      rule: "选中项使用Check；Escape关闭并回到触发器；禁用不展开。",
      reason: "避免把菜单焦点误当已选择的值。",
      check: "方向键定位、Enter选择、Esc关闭、禁用尝试。",
    },
  ],
  inputs: [
    "value / onValueChange；SelectItem value 唯一",
    "SelectTrigger size / disabled；SelectValue 显示当前值",
  ],
  events: ["onValueChange 改变筛选，保留其他候选选择"],
  composition: [
    "直接复用 src/components/ui/select.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["打开工具来源，选择Pi内置工具。", "再次打开并按Esc取消。"],
      expected: "确认才回写值，取消不改值，关闭回触发器。",
      render: () => <BasicControlExample kind="select" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="select" mode="disabled" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
