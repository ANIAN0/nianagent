import type { ConversationCompaction } from "@/contracts/rpc.generated"
import { CompactionRecord } from "./compaction-record"

export function ConversationCompactionRecord({
  record,
}: {
  record: ConversationCompaction
}) {
  return <CompactionRecord record={record} />
}
