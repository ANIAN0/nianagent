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
  const [location, setLocation] = useState<{
    recordId: string
    message: string
  }>()
  const target =
    messages.find((message) => message.entryId === record.firstKeptEntryId) ??
    (record.firstKeptHistoryIndex >= 0
      ? messages.find(
          (message) =>
            (message.historyIndex ?? -1) >= record.firstKeptHistoryIndex
        )
      : undefined)
  function locate() {
    if (
      !target ||
      !scrollToMessage(target.id, {
        align: "start",
        behavior: "auto",
        scrollMargin: 0,
      })
    )
      setLocation({
        recordId: record.id,
        message: "暂时无法定位这条历史，请在会话中向上查看。摘要与历史保留。",
      })
    else setLocation(undefined)
  }
  return (
    <CompactionRecord
      record={record}
      onLocate={locate}
      locateDisabledReason={
        !target ? "保留起点不在当前已读取的历史中，摘要仍可查看。" : undefined
      }
      locateFeedback={
        location?.recordId === record.id ? location.message : undefined
      }
    />
  )
}
