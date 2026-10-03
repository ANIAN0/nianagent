import { useState } from "react"
import type { CatalogEntry } from "../../../ui-catalog/catalog"
import type { ConversationRuntime } from "@/features/models/model-contract.generated"
import { ExecutionFeedback } from "./execution-feedback"

function Example({
  phase,
  compactionRetry = false,
  stopping = false,
  long = false,
  unknown = false,
}: {
  phase: ConversationRuntime["phase"]
  compactionRetry?: boolean
  stopping?: boolean
  long?: boolean
  unknown?: boolean
}) {
  const [retryAt] = useState(() => new Date(Date.now() + 20000).toISOString())
  return (
    <div className="p-6">
      <ExecutionFeedback
        stopping={stopping}
        runtime={{
          phase,
          updatedAt: new Date().toISOString(),
          toolName: long
            ? "powershell · 检查当前工作目录下多个模块的运行结果与中文路径配置"
            : "powershell",
          ...(phase === "retrying"
            ? {
                retrySource: compactionRetry ? "compaction" : "response",
                reason: "服务暂时繁忙。",
                ...(unknown ? {} : { attempt: 2, maxAttempts: 3, retryAt }),
              }
            : {}),
        }}
      />
    </div>
  )
}

export default {
  id: "execution-feedback",
  name: "运行阶段反馈",
  layer: "复合组件",
  group: "对话",
  source: "src/features/conversation/execution-feedback.tsx",
  description:
    "在输入卡上方就地展示实际 Pi 阶段；运行阶段结束后移除，非阻断压缩失败提示按正式记录保留。",
  boundary:
    "只呈现 runtime，不执行请求，不根据本地超时猜测失败或成功。重试时钟只倒数服务提供的等待截止时间。",
  inputs: [
    "runtime: ConversationSnapshot['runtime']",
    "stopping: boolean",
    "notice: ConversationSnapshot['notice']",
  ],
  events: ["无业务事件；阶段由父级快照更新"],
  composition: [
    "Marker、MarkerIcon、MarkerContent、Alert、AlertTitle、AlertDescription、Lucide",
  ],
  consumers: ["LiveConversationView"],
  viewport: { width: 640, height: 200 },
  states: [
    {
      id: "responding",
      name: "模型回复",
      condition: "runtime.phase=responding",
      expected: "正文显示正在回复；减少动态效果时不旋转。",
      render: () => <Example phase="responding" />,
    },
    {
      id: "tool",
      name: "工具执行",
      condition: "runtime.phase=tool",
      expected: "阶段与工具身份一起显示。",
      render: () => <Example phase="tool" />,
    },
    {
      id: "retrying",
      name: "等待模型重试",
      condition: "官方重试事件，当前次数2/3，等待20秒",
      expected: "倒计时到0显示即将重试，不能自行跳为回复状态；读屏不每秒播报。",
      render: () => <Example phase="retrying" />,
    },
    {
      id: "compacting",
      name: "上下文压缩",
      condition: "runtime.phase=compacting",
      expected: "说明当前正在整理历史，保留停止主动作。",
      render: () => <Example phase="compacting" />,
    },
    {
      id: "compaction-retry",
      name: "压缩重试",
      condition: "retrySource=compaction",
      expected: "与模型回复重试明确区分。",
      render: () => <Example phase="retrying" compactionRetry />,
    },
    {
      id: "retry-unknown",
      name: "重试信息未提供",
      condition: "未记录次数和等待截止时间",
      expected: "显示等待下一次尝试，不补次数或0秒。",
      render: () => <Example phase="retrying" unknown />,
    },
    {
      id: "stopping",
      name: "等待停止",
      condition: "stopping=true",
      expected: "优先显示正在停止，说明已执行操作会保留。",
      render: () => <Example phase="tool" stopping />,
    },
    {
      id: "long",
      name: "长工具身份",
      condition: "窄视口和长中文工具名称",
      expected: "自然换行，不挤掉标题或溢出。",
      render: () => <Example phase="tool" long />,
    },
    {
      id: "compaction-failed",
      name: "压缩未完成提示",
      condition: "终态仍保留压缩失败记录",
      expected: "静态警告不显示运行spinner，不阻断新输入或把回复设失败。",
      render: () => (
        <div className="p-6">
          <ExecutionFeedback
            notice={{
              kind: "compaction-failed",
              message: "本次压缩未完成，原有历史已保留，可以继续对话。",
              occurredAt: "2026-10-03T09:20:00Z",
              runId: "catalog-run",
            }}
          />
        </div>
      ),
    },
  ],
} satisfies CatalogEntry
