import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { OperationFeedback } from "./operation-feedback"
import { RecoveryAction } from "./recovery-action"

function Example({ recovery }: { recovery: FeedbackDescription["recovery"] }) {
  const [result, setResult] = useState("")
  const issue: FeedbackDescription = {
    code:
      recovery === "restart"
        ? "host_version"
        : recovery === "check"
          ? "result_unknown"
          : "catalog_read",
    message:
      recovery === "restart"
        ? "Moon 服务版本已更新。"
        : recovery === "check"
          ? "上次操作的结果尚未确认，原输入已保留。"
          : "本次读取未完成，当前输入已保留。",
    recovery,
    severity: recovery === "check" ? "warning" : "error",
  }
  return (
    <div className="p-6">
      <OperationFeedback
        title="读取配置"
        {...issue}
        actions={
          <RecoveryAction
            issue={issue}
            onRetry={() => setResult("已重试原操作（演示）。")}
            onReload={() => setResult("已重新读取（演示）。")}
            onCheck={() => setResult("已核对原操作结果（演示）。")}
            onSettings={() => setResult("已打开设置（演示）。")}
          />
        }
      />
      {result && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {result}
        </p>
      )}
    </div>
  )
}
export default {
  id: "recovery-action",
  name: "恢复动作",
  layer: "基础组件",
  group: "反馈",
  source: "src/components/feedback/recovery-action.tsx",
  description:
    "根据结构化恢复语义选择单一真实动作；重启使用明确指导，不重复请求旧宿主。",
  boundary:
    "只展示恢复动作，不拥有请求和错误；对应操作由调用方提供，未知只核对，未提供回调不会猜测其他动作。",
  inputs: [
    "issue: FeedbackDescription；onRetry/onReload/onCheck/onSettings：对应恢复能力；disabled、labels、className：动作状态、对象命名和布局。",
  ],
  events: [
    "只有当前recovery对应的回调可触发；restart显示启动指导，none无动作。",
  ],
  composition: ["Button"],
  consumers: [
    "WorkspacePicker",
    "ModelPicker",
    "SessionConfig",
    "HomeComposer",
  ],
  viewport: { width: 520, height: 340 },
  states: [
    {
      id: "reload",
      name: "重新读取",
      condition: "读请求明确失败。",
      expected: "仅显示重新读取，点击调用读请求。",
      render: () => <Example recovery="reload" />,
    },
    {
      id: "retry",
      name: "重试原操作",
      condition: "操作明确未完成，允许重试。",
      expected: "仅显示重试。",
      render: () => <Example recovery="retry" />,
    },
    {
      id: "check",
      name: "结果待核对",
      condition: "写入回执未知。",
      expected: "仅显示核对状态，不给重试。",
      render: () => <Example recovery="check" />,
    },
    {
      id: "settings",
      name: "检查设置",
      condition: "凭据或配置错误。",
      expected: "提供打开设置，不请求旧配置。",
      render: () => <Example recovery="settings" />,
    },
    {
      id: "restart",
      name: "重启宿主",
      condition: "服务版本与当前代码不一致。",
      expected: "显示退出重启指导，不输出重试/读取按钮。",
      render: () => <Example recovery="restart" />,
    },
    {
      id: "none",
      name: "无需恢复动作",
      condition: "状态仅需说明。",
      expected: "不输出恢复按钮。",
      render: () => <Example recovery="none" />,
    },
  ],
} satisfies CatalogEntry
