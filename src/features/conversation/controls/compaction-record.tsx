import type { ConversationCompaction } from "@/contracts/rpc.generated"
import { MarkdownContent } from "../messages/markdown-content"
import { CompactionRow } from "./compaction-row"

export function CompactionRecord({
  record,
}: {
  record: ConversationCompaction
}) {
  const expandable = !!record.summary
  return (
    <CompactionRow
      title={record.source === "manual" ? "compact" : "上下文已压缩"}
      summary={expandable ? "点击查看压缩摘要" : "压缩摘要不可用"}
    >
      {expandable ? <MarkdownContent text={record.summary} /> : undefined}
    </CompactionRow>
  )
}
