import type { ConversationCompaction } from "@/features/models/model-contract.generated"
import { CompactionRecord } from "./compaction-record"

export function ConversationCompactionRecord({
  record,
}: {
  record: ConversationCompaction
}) {
  return <CompactionRecord record={record} />
}
