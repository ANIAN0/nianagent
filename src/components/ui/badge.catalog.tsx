import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "badge",
  name: "标签",
  source: "src/components/ui/badge.tsx",
  group: "内容与反馈",
  layer: "基础组件",
  order: 25,
  pages: ["首页"],
  stage: "content",
  description: "表达工具来源或材料类型等紧凑分类。",
  boundary: "不是选择或操作按钮；不能用来源标签替代错误文字。",
  standards: [
    {
      id: "K1",
      name: "分类弱层级",
      rule: "来源使用弱色标签，名称保持主阅读层级；分类文字可读。",
      reason: "来源只辅助识别，不应与工具名称争抢注意。",
      check: "检查名称与标签基线、长来源换行不遮挡动作。",
    },
    {
      id: "K2",
      name: "状态不只靠颜色",
      rule: "不可用等含义有明确文字，颜色只辅助。",
      reason: "不同视觉能力用户都能识别状态。",
      check: "移除颜色后仍能读懂不可用含义。",
    },
  ],
  inputs: [
    "variant: default / secondary / outline / destructive",
    "内容简短；长内容的截断与说明由业务处理",
  ],
  events: ["无默认交互；需要动作时使用正式按钮"],
  composition: [
    "直接复用 src/components/ui/badge.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["对比来源、附件和不可用标签。"],
      expected: "类型文字可读，来源弱于名称，状态不只用颜色表达。",
      render: () => <BasicControlExample kind="badge" mode="normal" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "对比来源、附件和不可用标签。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="badge" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
