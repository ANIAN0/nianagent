import type { ConversationControlOperation } from "@/contracts/rpc.generated"
import type {
  ConversationControlAction,
  ConversationControlIssue,
} from "./conversation-control-state"
import { CompactionRow } from "./compaction-row"

export function CompactionStatus({
  operation,
  issue,
  pending,
  pendingAction,
}: {
  operation: ConversationControlOperation
  issue?: ConversationControlIssue
  pending?: boolean
  pendingAction?: ConversationControlAction
}) {
  const running = ["running", "cancelling", "unknown"].includes(
    operation.status
  )
  const error = operation.status === "failed"
  const summary = running
    ? operation.status === "cancelling" ||
      (pending && pendingAction === "cancel")
      ? "正在取消压缩…"
      : "正在压缩…"
    : operation.status === "cancelled"
      ? "压缩已取消。"
      : operation.status === "completed"
        ? "上下文已压缩"
        : issue?.message || operation.error || "压缩未完成。"
  const output = [summary, !running ? issue?.details : undefined]
    .filter(Boolean)
    .join("\n")
  return (
    <CompactionRow
      title="compact"
      summary={summary}
      running={running}
      error={error}
    >
      {output.includes("\n") ? (
        <pre className="conversation-compaction-output">{output}</pre>
      ) : undefined}
    </CompactionRow>
  )
}
