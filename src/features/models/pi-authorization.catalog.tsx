import { PiAuthorizationExample } from "../../../ui-catalog/fixtures/model-settings"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
export default {
  id: "pi-authorization",
  name: "Pi 授权交互",
  layer: "复合组件",
  group: "模型设置",
  source: "src/features/models/pi-authorization.tsx",
  description:
    "显示 Pi 实际授权通知和提示；准备、提交、取消与结果核对都保留原授权任务身份。",
  boundary:
    "正式组件接收同一服务契约；本展示注入内存替身，不连接账号。开始授权可保存连接，取消不会撤销已完成的保存。",
  inputs: ["connection", "service"],
  events: ["onComplete(connection)", "onCancelled(connection)", "onClose"],
  composition: [
    "Dialog",
    "Field",
    "Input",
    "Select",
    "Button",
    "OperationFeedback",
    "RecoveryAction",
  ],
  consumers: ["ConnectionEditor"],
  viewport: { width: 800, height: 650 },
  states: [
    {
      id: "default",
      name: "设备码与输入",
      condition: "服务返回授权提示",
      expected: "提交后结束，关闭会取消。",
      render: () => <PiAuthorizationExample />,
    },
    {
      id: "preparing",
      name: "准备时取消",
      condition: "开始请求仍在准备保存连接",
      expected:
        "关闭等待原任务退出；取消后发布服务的实际保存状态，不再提交提示。",
      render: () => <PiAuthorizationExample slow />,
    },
    {
      id: "unknown",
      name: "原授权结果待核对",
      condition: "开始响应丢失，原任务已建立",
      expected: "核对原ID恢复提示，不重复授权；关闭取消原ID。",
      render: () => <PiAuthorizationExample failure="authorize-unknown" />,
    },
    {
      id: "restart",
      name: "宿主需重启",
      condition: "授权返回restart恢复要求",
      expected: "显示重启指引，不将重新启动授权当作恢复。",
      render: () => <PiAuthorizationExample failure="authorize-restart" />,
    },
    {
      id: "failed",
      name: "授权未完成",
      condition: "授权准备失败",
      expected: "保留服务返回的原因，原任务终态可核对和关闭。",
      render: () => <PiAuthorizationExample failure="authorize" />,
    },
  ],
} satisfies CatalogEntry
