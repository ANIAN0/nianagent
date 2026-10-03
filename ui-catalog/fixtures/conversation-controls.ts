import type { ConversationControlOperation } from "@/features/models/model-contract.generated"
import type { ConversationControlService } from "@/features/conversation/controls/conversation-control-service"
/** An explicit service dependency for previews. Never connects to the host. */
export function createCatalogConversationControls(): ConversationControlService {
  const operations = new Map<string, ConversationControlOperation>()
  function create(
    sessionId: string,
    id: string,
    kind: "compact" | "fork",
    extra: Partial<ConversationControlOperation>
  ) {
    const now = new Date().toISOString()
    const operation: ConversationControlOperation = {
      id,
      sessionId,
      kind,
      status: "running",
      createdAt: now,
      updatedAt: now,
      error: "",
      ...extra,
    }
    operations.set(id, operation)
    return Promise.resolve(operation)
  }
  return {
    compact: (sessionId, id, focus) =>
      create(sessionId, id, "compact", { focus }),
    fork: (sessionId, id, entryId) =>
      create(sessionId, id, "fork", {
        anchorId: entryId,
        status: "completed",
        targetSessionId: "catalog-fork-target",
      }),
    read: async (_sessionId, id) => operations.get(id) ?? null,
    cancel: async (_sessionId, id) => {
      const value = operations.get(id)
      if (!value) throw new Error("示例操作不存在。")
      const result = {
        ...value,
        status: "cancelled" as const,
        error: "压缩已取消，原上下文保留。",
      }
      operations.set(id, result)
      return result
    },
  }
}
