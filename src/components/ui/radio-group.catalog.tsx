import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "radio-group",
  name: "单选组",
  source: "src/components/ui/radio-group.tsx",
  group: "操作与选择",
  layer: "基础组件",
  order: 12,
  pages: ["首页"],
  stage: "content",
  description: "在项目指令范围等互斥选项中选择一个值。",
  boundary: "只维护一组互斥值；应用或取消由会话配置层完成。",
  standards: [
    {
      id: "R1",
      name: "互斥语义",
      rule: "同一组只有一个选中项；完整标签可点击。",
      reason: "范围选择是互斥决定，不应让用户用多个复选框猜组合含义。",
      check: "方向键切换并读取选中值；点击标签检查对应值。",
    },
    {
      id: "R2",
      name: "说明归属",
      rule: "解释范围的文字靠近对应选项；不添加重复标签浮窗。",
      reason: "用户比较不同范围时需要就地读到差异。",
      check: "检查长说明仍归属于原选项，禁用不可切换。",
    },
  ],
  inputs: [
    "value / defaultValue；每个 RadioGroupItem value 唯一",
    "disabled / orientation；标签通过 id 关联",
  ],
  events: ["onValueChange 更新候选范围"],
  composition: [
    "直接复用 src/components/ui/radio-group.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["点击当前目录指令。", "方向键切换，再核对唯一选中项。"],
      expected: "始终只有一个有效范围，标签可点击，值和焦点对应。",
      render: () => <BasicControlExample kind="radio-group" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="radio-group" mode="disabled" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
