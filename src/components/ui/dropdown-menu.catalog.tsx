import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "dropdown-menu",
  name: "菜单",
  source: "src/components/ui/dropdown-menu.tsx",
  group: "浮层与导航",
  layer: "基础组件",
  order: 19,
  pages: ["首页"],
  stage: "content",
  description: "组织工作目录或加号的即时选择动作。",
  boundary: "菜单中的动作或选择由调用方处理，不自行打开原生目录或准备材料。",
  standards: [
    {
      id: "D1",
      name: "选择与焦点区别",
      rule: "选中值保留标记；焦点只表示当前键盘位置，禁用项不可执行。",
      reason: "移动焦点不能意外改变工作目录。",
      check: "方向键、Home/End、Enter选择、Esc取消。",
    },
    {
      id: "D2",
      name: "锚点与边界",
      rule: "浮层锚定来源入口，受视口边界约束并局部滚动。",
      reason: "用户需要知道菜单对应哪个操作，避免覆盖无法触及的动作。",
      check: "窄视口打开，点击外部/Esc关闭后焦点回归。",
    },
  ],
  inputs: [
    "Trigger asChild 保留按钮语义；Content side / align",
    "Item onSelect / disabled；Group与Separator表达真实分组",
  ],
  events: ["onSelect 提交选择；open变化仅管理展开状态"],
  composition: [
    "直接复用 src/components/ui/dropdown-menu.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["打开目录菜单，方向键选择notes并确认。", "重新展开，按Esc关闭。"],
      expected: "禁用项不执行，选择与焦点不同，取消不回写。",
      render: () => <BasicControlExample kind="dropdown-menu" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => (
        <BasicControlExample kind="dropdown-menu" mode="disabled" />
      ),
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
