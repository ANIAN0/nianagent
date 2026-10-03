import { useState } from "react"
import { useMessageScroller } from "@/components/ui/message-scroller"
import type {
  ConversationCompaction,
  ConversationChatMessage,
} from "@/features/models/model-contract.generated"
import { CompactionRecord } from "./compaction-record"
export function ConversationCompactionRecord({
  record,
  messages,
}: {
  record: ConversationCompaction
  messages: ConversationChatMessage[]
}) {
  const { scrollToMessage } = useMessageScroller()
  const [error, setError] = useState("")
  function locate() {
    const target =
      messages.find((message) => message.entryId === record.firstKeptEntryId) ??
      (record.firstKeptHistoryIndex >= 0
        ? messages.find(
            (message) =>
              (message.historyIndex ?? -1) >= record.firstKeptHistoryIndex
          )
        : undefined)
    if (
      !target ||
      !scrollToMessage(target.id, {
        align: "start",
        behavior: "auto",
        scrollMargin: 0,
      })
    )
      setError("保留起点的原消息当前不可定位；摘要与历史保持不变。")
    else setError("")
  }
  return (
    <>
      <CompactionRecord record={record} onLocate={locate} />
      {error && (
        <p role="status" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </>
  )
}
