import type { MutableRefObject } from "react"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import type { ComposerDraft } from "@/lib/composer/types"
import { materialReference } from "@/lib/composer/material-service-port"
import type { ConversationService } from "./conversation-service"
import { queueOperationIdentity } from "./queue-operation-recovery"
import { useQueueRecovery } from "./use-queue-recovery"

export function useConversationQueue({
  selectedId,
  service,
  snapshots,
  current,
  locks,
  perform,
}: {
  selectedId: string | undefined
  service: ConversationService
  snapshots: Record<string, ConversationSnapshot>
  current: MutableRefObject<Record<string, ConversationSnapshot>>
  locks: MutableRefObject<Set<string>>
  perform: (
    id: string,
    action: () => Promise<ConversationSnapshot>,
    kind?:
      | "send"
      | "stop"
      | "retry"
      | "reconcile"
      | "queue-edit"
      | "queue-remove"
      | "queue-mode"
      | "queue-deliver"
  ) => Promise<ConversationSnapshot>
}) {
  const {
    queueRestoreRequested: queueRestoreRequestedRef,
    queueRecoveryFault,
    inspectQueueReceipts,
    assertQueueRecovered,
    queueIssues,
    queueRecoveryRecords,
    queueRecoveryError,
    queueInFlight,
    queueRecoveryIssuesByRequest,
    queueOriginalRetryAllowed,
    queueOriginalRetryAllowedByRequest,
    retryQueueOriginal,
    startQueueOperation,
  } = useQueueRecovery({ service, perform, locks, current })

  const queueRecoveryReason = Object.fromEntries(
    [
      ...new Set([
        ...queueRecoveryRecords.map((record) => record.sessionId),
        ...(queueRecoveryError
          ? [...Object.keys(snapshots), ...(selectedId ? [selectedId] : [])]
          : []),
      ]),
    ].map((id) => [
      id,
      queueRecoveryError?.message ??
        "原队列操作尚未核对，或已确认的本机标识尚未清理。当前草稿保留，请先核对原操作。",
    ])
  ) as Record<string, string | undefined>

  const queueOperationPendingByRequest = Object.fromEntries(
    queueRecoveryRecords.map((record) => [
      record.operationRequestId,
      queueInFlight.current.has(queueOperationIdentity(record)),
    ])
  )

  const queueStorageIssue = queueRecoveryError
    ? {
        code: "queue_recovery_storage",
        message: queueRecoveryError.message,
        recovery: "reload" as const,
        severity: "warning" as const,
      }
    : undefined

  return {
    queueRestoreRequested: queueRestoreRequestedRef,
    requestRestore: () => {
      queueRestoreRequestedRef.current = true
    },
    queueRecoveryFault,
    inspectQueueReceipts,
    assertQueueRecovered,
    queueIssues,
    queueRecoveryReason,
    queueRecoveryRecords,
    queueOperationPendingByRequest,
    queueRecoveryIssuesByRequest,
    queueStorageIssue,
    queueOriginalRetryAllowed,
    queueOriginalRetryAllowedByRequest,
    retryQueueOriginal,
    checkQueueReceipts: inspectQueueReceipts,
    queueItemRead: (id: string, itemId: string, signal?: AbortSignal) =>
      service.queueItem
        ? service.queueItem(id, itemId, signal)
        : Promise.resolve(null),
    queueEdit: async (
      id: string,
      itemId: string,
      text: string,
      materials?: ComposerDraft["materials"],
      revision?: number,
      clientEditId?: string
    ) => {
      assertQueueRecovered(id)
      return perform(
        id,
        () =>
          service.queueEdit({
            sessionId: id,
            itemId,
            text,
            ...(materials
              ? { materials: materials.map(materialReference) }
              : {}),
            ...(clientEditId ? { clientEditId } : {}),
            revision: revision ?? current.current[id]?.queue?.revision ?? 0,
          }),
        "queue-edit"
      )
    },
    queueRemove: (id: string, itemId: string) =>
      startQueueOperation(id, "conversationQueueRemove", { itemId }),
    queueMode: (id: string, mode: "single" | "all") =>
      startQueueOperation(id, "conversationQueueMode", { mode }),
    queueDeliver: (id: string, itemId: string) =>
      startQueueOperation(id, "conversationQueueDeliver", { itemId }),
  }
}
