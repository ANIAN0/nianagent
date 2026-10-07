import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "switch",
  name: "开关",
  source: "src/components/ui/switch.tsx",
  group: "操作与选择",
  layer: "基础组件",
  order: 14,
  pages: ["首页"],
  stage: "content",
  description: "启用或关闭扩展配置中的单个布尔选项。",
  boundary: "表示启用状态，不代替工具多选或应用提交。",
  standards: [
    {
      id: "W1",
      name: "布尔含义明确",
      rule: "标签说明启用对象；位置、状态与颜色共同表达开关。",
      reason: "开关适合单个启用决定，不适合选择集合。",
      check: "点击标签和空格均改变值，禁用值不改变。",
    },
    {
      id: "W2",
      name: "不暗示自动保存",
      rule: "候选配置的开关变化不显示为已生效，提交反馈由父级负责。",
      reason: "当前扩展表单需要确认保存，不能给用户错误的持久化预期。",
      check: "在复合会话配置示例核对取消不写、保存才生效。",
    },
  ],
  inputs: ["checked / defaultChecked / disabled", "id 与完整可点击标签关联"],
  events: ["onCheckedChange 回写布尔值，保存时机由所属表单决定"],
  composition: [
    "直接复用 src/components/ui/switch.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["点击标签启用扩展，再用空格关闭。"],
      expected: "标签与开关同步，事件只包含布尔变化。",
      render: () => <BasicControlExample kind="switch" mode="normal" />,
    },
    {
      id: "disabled",
      name: "禁用",
      section: "states",
      condition: "控件由调用方明确禁用。",
      steps: ["尝试鼠标点击、键盘聚焦和输入。", "核对演示事件未变化。"],
      expected: "禁用状态不能触发、选择或编辑；保留对象名称。",
      render: () => <BasicControlExample kind="switch" mode="disabled" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
