import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "input-group",
  name: "输入组",
  source: "src/components/ui/input-group.tsx",
  group: "输入与表单",
  layer: "基础组件",
  order: 16,
  pages: ["首页"],
  stage: "content",
  description: "将搜索图标、输入和清除动作组织成一个控件。",
  boundary: "统一容器边界，内部图标不独立制造输入框；不承载候选数据读取。",
  standards: [
    {
      id: "G1",
      name: "一个输入边界",
      rule: "附加图标和清除动作在同一输入边界内；焦点由容器统一表达。InputGroupInput透传Input的compact规格，默认调用不变。",
      reason: "搜索是一项任务，不应出现多重边框或错位图标。",
      check: "输入、清除、Tab切换检查边界和垂直居中。",
    },
    {
      id: "G2",
      name: "清除可发现",
      rule: "查询非空时提供有名称的清除按钮，清除不改工具选择。",
      reason: "缩短恢复未筛选列表的操作，同时保留已选配置。",
      check: "输入关键词再清除；检查onChange和选择状态分别管理。",
    },
  ],
  inputs: [
    "InputGroupInput value / onChange / placeholder / variant(default | compact)",
    "InputGroupAddon align；InputGroupButton size / aria-label",
  ],
  events: ["清除动作只清空查询；输入焦点与候选选择归父级"],
  composition: [
    "直接复用 src/components/ui/input-group.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["输入read，点击清除搜索。", "Tab在输入与清除动作间切换。"],
      expected: "搜索和清除共用一条边界，清除只改变查询。",
      render: () => <BasicControlExample kind="input-group" mode="normal" />,
    },
    {
      id: "compact",
      name: "紧凑搜索与清除",
      section: "states",
      condition: "InputGroupInput显式使用compact，完整组合搜索图标、输入与清除。",
      steps: ["在390px与常规视口输入read，核对14px/20px与32px高度。", "点击清除，再输入搜索词；Tab切换输入和清除按钮。"],
      expected: "compact透传正式Input，图标与文字居中；清除只改变查询。",
      render: () => <BasicControlExample kind="input-group" mode="compact" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="input-group" mode="disabled" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "输入read，点击清除搜索。",
        "Tab在输入与清除动作间切换。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="input-group" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
