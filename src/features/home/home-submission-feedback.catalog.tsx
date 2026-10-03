import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import { HomeSubmissionFeedback } from "./home-submission-feedback"

function RetryExample() {
  const [complete, setComplete] = useState(false)
  return complete ? (
    <p role="status">示例清理完成，原消息仍在会话历史。</p>
  ) : (
    <HomeSubmissionFeedback
      message="消息已接受，但首页草稿清理失败。原提交身份保留，请重试清理后再从首页发送。"
      onRetry={() => setComplete(true)}
    />
  )
}
export default {
  id: "home-submission-feedback",
  name: "首页草稿清理反馈",
  layer: "复合组件",
  group: "首页",
  source: "src/features/home/home-submission-feedback.tsx",
  description:
    "首页发送结果核对与本地草稿清理分别说明，重启后孤立提交记录也有可达入口。",
  boundary:
    "App保留提交身份并执行正式清理；组件只展示错误与重试。目录演示重试事件，不读写用户存储或调用模型。",
  inputs: [
    "message: 明确已接受或尚未接受，以及需要清理的本地状态。",
    "onRetry/actionLabel: 页面明确区分核对原请求与重试本地清理；不发送当前新草稿。",
    "pending/variant: 核对期间禁用重复操作，待核对为常规反馈，清理失败为错误反馈。",
  ],
  events: ["重试由页面执行；失败时反馈保持，成功后由页面移除。"],
  composition: ["Alert / AlertDescription / Button"],
  consumers: ["App（首页与会话顶部）"],
  viewport: { width: 800, height: 200 },
  states: [
    {
      id: "cleanup-failed",
      name: "消息已接受，清理失败",
      condition: "已确认发送，但本地存储清理受阻。",
      expected: "原提交身份保留，重试不会重复发消息；窄宽度换行且按钮可达。",
      render: () => <RetryExample />,
    },
    {
      id: "orphan-record",
      name: "重启后原草稿已清，记录待核对",
      condition: "提交标记最后一步清理失败，当前首页已属于另一个会话身份。",
      expected: "独立顶部入口仍可核对原记录；不会清空同文的新草稿或强制导航。",
      render: () => (
        <HomeSubmissionFeedback
          variant="default"
          message="首页提交记录待核对 · moon"
          actionLabel="核对记录"
          onRetry={() => {}}
        />
      ),
    },
    {
      id: "reconciling",
      name: "正在核对",
      condition: "正式核对请求等待原回执。",
      expected: "核对按钮禁用，当前草稿与页面位置保留。",
      render: () => (
        <HomeSubmissionFeedback
          variant="default"
          message="首页提交记录待核对 · moon"
          actionLabel="核对记录"
          pending
          onRetry={() => {}}
        />
      ),
    },
  ],
} satisfies CatalogEntry
