import { useEffect, useRef, useState } from "react"
import type { ComposerDraft } from "@/lib/composer/types"
import type { MaterialService } from "@/lib/composer/material-service-port"
import {
  effectiveThinking,
  thinkingLabels,
} from "@/lib/composer/model-thinking"
import {
  modelSelectionId,
  type ModelConnection,
} from "@/features/models/model-types"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import {
  createConversationService,
  type ConversationService,
} from "./conversation-service"
import { RpcRequestRejected } from "@/lib/rpc/client"
import { inspectConversationReceipt } from "./conversation-receipt"
import { useConversationStream } from "./use-conversation-stream"
import {
  useConversationSubmission,
  type ConversationActionIssue,
} from "./use-conversation-submission"
import { useConversationQueue } from "./use-conversation-queue"

export type { ConversationActionIssue }

export function resolveConversationModel(
  connections: ModelConnection[],
  draft: ComposerDraft
) {
  for (const connection of connections) {
    const model = connection.models.find(
      (item) => modelSelectionId(connection, item) === draft.model
    )
    if (!model) continue
    if (!model.supportedThinkingLevels)
      throw new RpcRequestRejected(
        "模型能力尚未完整读取，请重新读取模型设置。",
        {
          code: "model_selection",
          summary: "模型能力尚未完整读取，请重新读取模型设置。",
          recovery: "settings",
          severity: "error",
        }
      )
    const selectedLabel = effectiveThinking(
      draft.thinking,
      model.supportedThinkingLevels.map((level) => thinkingLabels[level])
    )
    const thinking =
      Object.entries(thinkingLabels).find(
        ([, label]) => label === selectedLabel
      )?.[0] ?? "off"
    return {
      connectionId: connection.id,
      modelId: model.id,
      thinking: thinking as ConversationSnapshot["thinking"],
    }
  }
  throw new RpcRequestRejected("所选模型已不可用，请重新选择模型。", {
    code: "model_selection",
    summary: "所选模型已不可用，请重新选择模型。",
    recovery: "settings",
    severity: "error",
  })
}

/** Server snapshots and editing drafts are separate; polling never replaces input. */
export function useLiveConversation(
  selectedId: string | undefined,
  providedService?: ConversationService,
  materialService?: MaterialService
) {
  // The service belongs to this hook owner; replacing it requires a new owner.
  const [service] = useState(
    () => providedService ?? createConversationService()
  )
  const bridgesRef = useRef<{
    onBeforeRead?: (sessionId: string) => void
    onAcceptSnapshot?: (
      snapshot: ConversationSnapshot,
      previous: ConversationSnapshot | undefined
    ) => void
    inspectQueueReceipts?: (
      sessionId: string,
      signal: AbortSignal,
      refreshStorage: boolean
    ) => Promise<unknown>
    shouldRefreshQueueStorage?: () => boolean
    getActiveOwnerIds?: () => string[]
    isLocked?: (sessionId: string) => boolean
    getMutationCount?: (sessionId: string) => number
    assertQueueRecovered?: (id: string) => void
  }>({})

  const stream = useConversationStream({
    selectedId,
    service,
    callbacks: {
      onBeforeRead: (id) => bridgesRef.current.onBeforeRead?.(id),
      onAcceptSnapshot: (snapshot, previous) =>
        bridgesRef.current.onAcceptSnapshot?.(snapshot, previous),
      inspectQueueReceipts: (id, signal, refresh) =>
        bridgesRef.current.inspectQueueReceipts
          ? bridgesRef.current.inspectQueueReceipts(id, signal, refresh)
          : Promise.resolve(),
      shouldRefreshQueueStorage: () =>
        bridgesRef.current.shouldRefreshQueueStorage?.() ?? false,
      getActiveOwnerIds: () => bridgesRef.current.getActiveOwnerIds?.() ?? [],
      isLocked: (id) => bridgesRef.current.isLocked?.(id) ?? false,
      getMutationCount: (id) => bridgesRef.current.getMutationCount?.(id) ?? 0,
    },
  })

  const submission = useConversationSubmission({
    service,
    materialService,
    current: stream.current,
    accept: stream.accept,
    assertQueueRecovered: (id) => bridgesRef.current.assertQueueRecovered?.(id),
    resolveModel: resolveConversationModel,
  })

  const queue = useConversationQueue({
    selectedId,
    service,
    current: stream.current,
    locks: submission.locks,
    perform: submission.perform,
  })

  useEffect(() => {
    bridgesRef.current = {
      onBeforeRead: (id) => {
        const recovered = submission.requests.current.get(id)
        if (recovered?.stage === "prepared")
          submission.clearReceipt(id, recovered, "rejected")
        else if (
          recovered?.stage === "accepted" ||
          recovered?.stage === "rejected"
        )
          submission.clearReceipt(id, recovered)
      },
      onAcceptSnapshot: submission.onAcceptSnapshot,
      inspectQueueReceipts: queue.inspectQueueReceipts,
      shouldRefreshQueueStorage: () => {
        const refresh =
          queue.queueRestoreRequested.current ||
          !!queue.queueRecoveryFault.current
        queue.queueRestoreRequested.current = false
        return refresh
      },
      getActiveOwnerIds: () => [
        ...submission.requests.current.keys(),
        ...submission.locks.current,
        ...submission.stopLocks.current,
      ],
      isLocked: (id) => submission.locks.current.has(id),
      getMutationCount: (id) => submission.mutations.current.get(id) ?? 0,
      assertQueueRecovered: queue.assertQueueRecovered,
    }
  })

  return {
    snapshotStore: stream.snapshotStore,
    draftStore: submission.draftStore,
    actionIssues: submission.actionIssues,
    readIssues: stream.readIssues,
    readPending: stream.readPending,
    draftErrors: submission.draftErrors,
    queueIssues: queue.queueIssues,
    queueRecoveryReason: queue.queueRecoveryReason,
    queueRecoveryRecords: queue.queueRecoveryRecords,
    queueOperationPendingByRequest: queue.queueOperationPendingByRequest,
    queueRecoveryIssuesByRequest: queue.queueRecoveryIssuesByRequest,
    queueStorageIssue: queue.queueStorageIssue,
    queueOriginalRetryAllowed: queue.queueOriginalRetryAllowed,
    queueOriginalRetryAllowedByRequest:
      queue.queueOriginalRetryAllowedByRequest,
    retryQueueOriginal: queue.retryQueueOriginal,
    checkQueueReceipts: queue.checkQueueReceipts,
    receiptIssues: submission.receiptIssues,
    cleanReceipt: submission.cleanReceipt,
    settleHomeReceipt: submission.settleHomeReceipt,
    errors: Object.fromEntries(
      Array.from(
        new Set([
          ...Object.keys(submission.actionIssues),
          ...Object.keys(stream.readIssues),
          ...Object.keys(submission.draftErrors),
        ])
      ).map((id) => [
        id,
        submission.actionIssues[id]?.message ||
          stream.readIssues[id]?.message ||
          submission.draftErrors[id] ||
          "",
      ])
    ),
    pending: submission.pending,
    stopPending: submission.stopPending,
    stopUnconfirmed: submission.stopUnconfirmed,
    send: submission.send,
    stop: submission.stop,
    retry: submission.retry,
    unconfirmed: submission.unconfirmed,
    beginHomeHandoff: (id: string, draft: ComposerDraft) => {
      stream.homeHandoffs.current.add(id)
      submission.setHandoffDraft(id, draft)
      stream.clearReadIssue(id)
    },
    endHomeHandoff: (id: string) => {
      stream.homeHandoffs.current.delete(id)
      const receipts = stream.handoffInputReceipts.current.get(id)
      stream.handoffInputReceipts.current.delete(id)
      for (const snapshot of receipts?.values() ?? [])
        stream.publishInputReceipt(snapshot)
      const snapshot = stream.current.current[id]
      if (snapshot && !receipts?.has(snapshot.clientRequestId ?? ""))
        stream.publishInputReceipt(snapshot)
    },
    subscribeInputReceipts: stream.subscribeInputReceipts,
    homeInputReceipt: (id: string, requestId: string | undefined) => {
      if (!requestId) return undefined
      const snapshot =
        stream.handoffInputReceipts.current.get(id)?.get(requestId) ??
        stream.current.current[id]
      if (!snapshot) return undefined
      const receipt = inspectConversationReceipt(id, requestId, snapshot)
      return receipt.state === "accepted" || receipt.state === "handled"
        ? receipt
        : undefined
    },
    submissionDraft: submission.submissionDraft,
    submissionRequestId: submission.submissionRequestId,
    submissionEcho: submission.submissionEcho,
    inspectReceipt: submission.inspectReceipt,
    reconcile: submission.reconcile,
    reload: () => {
      if (!selectedId) return
      queue.requestRestore()
      stream.reload()
    },
    change: submission.change,
    currentDraft: submission.currentDraft,
    updateDraft: submission.updateDraft,
    adoptRecoveredDraft: submission.adoptRecoveredDraft,
    adoptHomeDraft: submission.adoptHomeDraft,
    saveDraft: submission.saveDraft,
    readStoredDraft: submission.readStoredDraft,
    saveStoredDraft: submission.saveStoredDraft,
    queueItemRead: queue.queueItemRead,
    queueEdit: queue.queueEdit,
    queueRemove: queue.queueRemove,
    queueMode: queue.queueMode,
    queueDeliver: queue.queueDeliver,
  }
}
