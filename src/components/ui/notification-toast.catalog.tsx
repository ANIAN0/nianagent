import type { CatalogEntry } from "../../../ui-catalog/catalog-types"
import { NotificationToastExample } from "../../../ui-catalog/fixtures/notification-toast-example"

export default {
  id: "notification-toast",
  name: "Toast 提示",
  source: "src/components/ui/notification-toast.tsx",
  composition: [
    "NotificationToaster（入口挂载一次） · src/components/ui/notification-toast.tsx",
    "NotificationToast / notifyToast（共享通知） · src/components/ui/notification-toast.tsx",
    "OperationFeedback（所属操作的恢复入口） · src/components/feedback/operation-feedback.tsx",
  ],
  group: "内容与反馈",
  layer: "基础组件",
  order: 28.5,
  pages: ["首页", "会话", "模型设置", "MCP设置"],
  stage: "content",
  description: "DSH风格的短暂顶部通知，所有操作异常共用同一组件。",
  boundary:
    "通知不替代持续恢复入口；发送结果未知时，会话在原消息下、首页在输入卡外检查原请求，不能重新发送。终态错误仍留在所属历史条目。",
  standards: [
    {
      id: "toast-presentation",
      name: "共享外观与时长",
      rule: "距顶40px，按所属输入或面板水平居中，深色16px圆角，14px/22px，显示3秒后1秒淡出。错误及未知结果使用警告图标；重复事件可再次提示。",
      reason: "通知不挤压正文或遮挡输入，也不丢失原请求的持续恢复能力。",
      check: "点击显示提示，阅读完整文案与淡出；再次点击后重新提示。",
    },
  ],
  inputs: [
    "message / tone / trigger / anchor / actions",
    "NotificationToaster在正式入口及预览入口各挂载一次",
  ],
  events: ["notifyToast通知；恢复动作由所属操作提供"],
  consumers: ["OperationFeedback / ComposerNotification及所有异常调用方"],
  states: [
    {
      id: "information",
      name: "普通通知",
      section: "normal",
      condition: "由用户触发真实共享Toast。",
      steps: ["点击显示提示，等待淡出。"],
      expected: "通知短暂显示，不追加正文布局。",
      render: () => <NotificationToastExample tone="info" />,
    },
    {
      id: "failure",
      name: "操作失败",
      section: "exception",
      condition: "隔离文案，不发起真实写入。",
      steps: ["点击显示提示，再次点击。"],
      expected: "警告图标与完整原因清楚，重复提示有效。",
      render: () => <NotificationToastExample tone="error" />,
    },
    {
      id: "unknown",
      name: "结果待确认",
      section: "exception",
      condition: "这里只展示通知；正式核对流程在空闲输入故事。",
      steps: ["点击显示提示，阅读结果待确认文案。"],
      expected: "不把未知说成失败或未执行。",
      render: () => <NotificationToastExample tone="warning" />,
    },
  ],
  viewport: { width: 640, height: 420 },
} satisfies CatalogEntry
