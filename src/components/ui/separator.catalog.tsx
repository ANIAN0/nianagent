import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "separator",
  name: "分隔线",
  source: "src/components/ui/separator.tsx",
  group: "内容与反馈",
  layer: "基础组件",
  order: 27,
  pages: ["首页"],
  stage: "content",
  description: "区分真实内容分区或并列动作。",
  boundary: "不为每一行增加边框，不表达错误、状态或交互。",
  standards: [
    {
      id: "E1",
      name: "有意义才分隔",
      rule: "只在内容类别或操作区域边界使用，间距优先于大量线条。",
      reason: "过多分隔会使同一任务碎片化。",
      check: "同一列表没有无意义的多层边框。",
    },
    {
      id: "E2",
      name: "方向与尺寸",
      rule: "横线随容器，纵线有稳定高度且不撑大布局。",
      reason: "分隔辅助结构，不是独立内容。",
      check: "窄窗没有额外横向溢出。",
    },
  ],
  inputs: [
    "orientation: horizontal / vertical",
    "decorative 默认用于装饰性分界；纵向父容器提供高度",
  ],
  events: ["无交互事件"],
  composition: [
    "直接复用 src/components/ui/separator.tsx；示例只管理布局、受控值与演示事件。",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["检查横向分区与纵向动作分界。", "在390px检查尺寸。"],
      expected: "只表达真实区域，分隔线不扩大容器或制造多层边框。",
      render: () => <BasicControlExample kind="separator" mode="normal" />,
    },
    {
      id: "long",
      name: "长内容与窄窗",
      section: "states",
      condition: "较长内容仅核对边界，不作为业务主流程证据。",
      steps: [
        "在390px和常规视口查看较长内容。",
        "检查横向分区与纵向动作分界。",
        "在390px检查尺寸。",
      ],
      expected: "内容在所属区域收缩、换行或滚动，操作和完整信息仍可到达。",
      render: () => <BasicControlExample kind="separator" mode="long" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
