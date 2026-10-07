import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { BasicControlExample } from "../../../ui-catalog/fixtures/basic-controls"

export default {
  id: "alert",
  name: "提示",
  source: "src/components/feedback/operation-feedback.tsx",
  group: "内容与反馈",
  layer: "基础组件",
  order: 28,
  pages: ["首页"],
  stage: "content",
  description: "操作异常使用共享Toast；持续状态和恢复动作留在所属操作区域。",
  boundary:
    "终态事实使用DSH行内状态；短暂通知使用NotificationToast，不使用旧版红黄底Alert。示例显示静态状态和真实恢复回调，Toast见对应基础组件。",
  standards: [
    {
      id: "Q1",
      name: "反馈有归属",
      rule: "配置错误在配置面板，材料错误在材料，发送失败在提交所属区；普通提示不占正文布局。",
      reason: "位置要帮助定位原因，不能为一条错误重复增加多处说明。",
      check: "制造失败，检查能定位对象、有恢复且无重复提示。",
    },
    {
      id: "Q2",
      name: "说明与动作",
      rule: "文字说明具体失败和恢复，不仅显示红色；允许重试时保留原候选。",
      reason: "用户需要知道下一步，不需要底层实现名词。",
      check: "失败后恢复不丢输入，重复点击不产生多次写入。",
    },
  ],
  inputs: ["title / message / severity / actions；静态记录可用notify=false"],
  events: ["恢复事件继续原操作，保留候选与输入"],
  composition: [
    "OperationFeedback · src/components/feedback/operation-feedback.tsx",
    "NotificationToast · src/components/ui/notification-toast.tsx",
    "StatusMessage · src/components/feedback/status-message.tsx",
  ],
  consumers: ["首页输入区及其选择、配置、材料相关复合组件"],
  states: [
    {
      id: "normal",
      name: "默认与实际操作",
      section: "normal",
      condition: "正式共享组件，值与事件由示例受控。",
      steps: ["读到目录不可用与恢复动作。", "点击选择目录，查看事件。"],
      expected: "具体对象和恢复方式清楚；不是只有红色或底层错误码。",
      render: () => <BasicControlExample kind="alert" mode="normal" />,
    },
    {
      id: "error",
      name: "失败与恢复",
      section: "exception",
      condition: "通过参数给出对应状态，示例不调用真实后端。",
      steps: ["查看失败说明与恢复动作。", "点击恢复，查看演示事件。"],
      expected: "错误能定位到对象并恢复；没有重复提示或假成功。",
      render: () => <BasicControlExample kind="alert" mode="error" />,
    },
  ],
  viewport: {
    width: 640,
    height: 420,
  },
} satisfies CatalogEntry
