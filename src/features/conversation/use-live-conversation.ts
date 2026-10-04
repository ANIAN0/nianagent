import { useCallback, useEffect, useRef, useState } from "react"
import type { HomeDraft } from "@/features/home/home-types"
import { adoptFollowingHomeDraft } from "@/features/home/home-submission-draft"
import {
  effectiveThinking,
  thinkingLabels,
} from "@/features/home/model-thinking"
import {
  modelSelectionId,
  type ModelConnection,
} from "@/features/models/model-types"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import { createConversationService } from "./conversation-service"
import { RpcRequestRejected } from "@/features/models/model-service"
import { materialReference } from "@/features/materials/material-service"
import { readConversationReceipt } from "./conversation-receipt"
import {
  clearQueueOperation,
  freezeQueueOperation,
  queueOperationIdentity,
  queueOperationIssueKey,
  queueReceiptMatches,
  restoreQueueOperations,
  saveQueueOperation,
  type QueueOperationRecord,
} from "./queue-operation-recovery"
import {
  prepareConversationSubmission,
  resolvedConversationDraft,
  persistConversationResolution,
  conversationSubmissionEcho,
} from "./conversation-submission"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  draftSignature,
  restoreConversationDrafts,
  saveConversationDraft,
  saveConversationRequest,
  type PendingSubmission,
  type HomeSubmission,
} from "./conversation-draft-store"

export type ConversationActionIssue = FeedbackDescription & {
  action: "send" | "stop" | "retry" | "reconcile"
}
type ActionKind =
  | ConversationActionIssue["action"]
  | "queue-edit"
  | "queue-remove"
  | "queue-mode"
  | "queue-deliver"
const unknownQueueIssue = (
  record: QueueOperationRecord,
  details?: string
): FeedbackDescription => ({
  code: "result_unknown",
  message:
    record.operation === "conversationQueueRemove"
      ? "尚未确认这条排队消息的移除结果，请先核对原操作。"
      : record.operation === "conversationQueueMode"
        ? `尚未确认${record.mode === "single" ? "逐条" : "全部"}交付设置，请先核对原操作。`
        : "尚未确认这条消息的交付操作是否已采用，请先核对原操作。",
  recovery: "check",
  severity: "warning",
  ...(details ? { details } : {}),
})
const restoredQueueIssues = (records: QueueOperationRecord[]) => {
  const issues: Record<
    string,
    Record<string, FeedbackDescription | undefined>
  > = {}
  for (const record of records)
    (issues[record.sessionId] ??= {})[queueOperationIssueKey(record)] =
      unknownQueueIssue(record)
  return issues
}
export function resolveConversationModel(
  connections: ModelConnection[],
  draft: HomeDraft
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
export function useLiveConversation(selectedId: string | undefined) {
  const [service] = useState(createConversationService)
  const [restored] = useState(restoreConversationDrafts)
  const [restoredQueue] = useState(restoreQueueOperations)
  const queueRecoveries = useRef(
    new Map(
      restoredQueue.records.map((record) => [
        queueOperationIdentity(record),
        record,
      ])
    )
  )
  const [queueRecoveryRecords, setQueueRecoveryRecords] = useState(
    restoredQueue.records
  )
  const queueRecoveryFault = useRef(restoredQueue.error)
  const queueRestoreRequested = useRef(false)
  const [queueRecoveryError, setQueueRecoveryError] = useState(
    restoredQueue.error
  )
  const queueInFlight = useRef(new Set<string>())
  const queueKnownResults = useRef(
    new Map<string, FeedbackDescription | undefined>()
  )
  const queueRecordIssues = useRef(
    new Map<string, FeedbackDescription | undefined>(
      restoredQueue.records.map((record) => [
        queueOperationIdentity(record),
        unknownQueueIssue(record),
      ])
    )
  )
  const [queueRecoveryIssuesByRequest, setQueueRecoveryIssuesByRequest] =
    useState<Record<string, Record<string, FeedbackDescription | undefined>>>(
      () =>
        Object.fromEntries(
          [
            ...new Set(restoredQueue.records.map((record) => record.sessionId)),
          ].map((id) => [
            id,
            Object.fromEntries(
              restoredQueue.records
                .filter((record) => record.sessionId === id)
                .map((record) => [
                  record.operationRequestId,
                  unknownQueueIssue(record),
                ])
            ),
          ])
        )
    )
  const queueRetryAllowed = useRef(new Set<string>())
  const queueReceiptReads = useRef(new Map<string, Promise<void>>())
  const [queueOriginalRetryAllowed, setQueueOriginalRetryAllowed] = useState<
    Record<string, Record<string, boolean>>
  >({})
  const [
    queueOriginalRetryAllowedByRequest,
    setQueueOriginalRetryAllowedByRequest,
  ] = useState<Record<string, Record<string, boolean>>>({})
  const [snapshots, setSnapshots] = useState<
    Record<string, ConversationSnapshot>
  >({})
  const [drafts, setDrafts] = useState<Record<string, HomeDraft>>(
    restored.drafts
  )
  const draftsRef = useRef(drafts)
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({})
  const [actionIssues, setActionIssues] = useState<
    Record<string, ConversationActionIssue | undefined>
  >({})
  const [readIssues, setReadIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const [readPending, setReadPending] = useState<Record<string, boolean>>({})
  const readOwners = useRef(new Map<string, AbortController>())
  const reloadRequested = useRef<string | undefined>(undefined)
  const [queueIssues, setQueueIssues] = useState<
    Record<string, Record<string, FeedbackDescription | undefined>>
  >(() => restoredQueueIssues(restoredQueue.records))
  const [receiptIssues, setReceiptIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const receiptCleanups = useRef(new Map<string, PendingSubmission>())
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [reload, setReload] = useState(0)
  const current = useRef(snapshots)
  const requests = useRef(restored.requests)
  const locks = useRef(new Set<string>())
  const stopLocks = useRef(new Set<string>())
  const mutations = useRef(new Map<string, number>())
  const publishQueueRecovery = useCallback(() => {
    const records = [...queueRecoveries.current.values()]
    setQueueRecoveryRecords((previous) =>
      previous.length === records.length &&
      previous.every((record, index) => record === records[index])
        ? previous
        : records
    )
    const allowed: Record<string, Record<string, boolean>> = {}
    const byRequest: Record<string, Record<string, boolean>> = {}
    const issuesByRequest: Record<
      string,
      Record<string, FeedbackDescription | undefined>
    > = {}
    for (const record of records) {
      const key = queueOperationIssueKey(record)
      const sameObject = records.filter(
        (other) =>
          other.sessionId === record.sessionId &&
          queueOperationIssueKey(other) === key
      )
      ;(allowed[record.sessionId] ??= {})[key] =
        sameObject.length === 1 &&
        queueRetryAllowed.current.has(queueOperationIdentity(record))
      ;(byRequest[record.sessionId] ??= {})[record.operationRequestId] =
        queueRetryAllowed.current.has(queueOperationIdentity(record))
      ;(issuesByRequest[record.sessionId] ??= {})[record.operationRequestId] =
        queueRecordIssues.current.get(queueOperationIdentity(record))
    }
    setQueueOriginalRetryAllowed(allowed)
    setQueueOriginalRetryAllowedByRequest(byRequest)
    setQueueRecoveryIssuesByRequest(issuesByRequest)
  }, [])
  const finishQueueRecovery = useCallback(
    (record: QueueOperationRecord, issue?: FeedbackDescription) => {
      const identity = queueOperationIdentity(record)
      if (queueRecoveries.current.get(identity) !== record) return
      queueRetryAllowed.current.delete(identity)
      queueKnownResults.current.set(identity, issue)
      const key = queueOperationIssueKey(record)
      try {
        clearQueueOperation(record)
        queueRecoveries.current.delete(identity)
        queueKnownResults.current.delete(identity)
        queueRecordIssues.current.delete(identity)
        const other = [...queueRecoveries.current.values()].find(
          (value) =>
            value.sessionId === record.sessionId &&
            queueOperationIssueKey(value) === key
        )
        setQueueIssues((all) => ({
          ...all,
          [record.sessionId]: {
            ...all[record.sessionId],
            [key]: other ? unknownQueueIssue(other) : issue,
          },
        }))
      } catch {
        const cleanupIssue: FeedbackDescription = {
          code: "result_unknown",
          message:
            "队列操作结果已确认，本机恢复标识尚未清理。请重新核对以完成本地清理，不会重复执行。",
          recovery: "check",
          severity: "warning",
        }
        queueRecordIssues.current.set(identity, cleanupIssue)
        setQueueIssues((all) => ({
          ...all,
          [record.sessionId]: {
            ...all[record.sessionId],
            [key]: cleanupIssue,
          },
        }))
      }
      publishQueueRecovery()
    },
    [publishQueueRecovery]
  )
  const inspectQueueReceipts = useCallback(
    (
      id: string,
      signal?: AbortSignal,
      refreshStorage = true
    ): Promise<void> => {
      const existing = queueReceiptReads.current.get(id)
      if (existing) return existing
      const inspection = (async () => {
        signal?.throwIfAborted()
        // Cold restore is already complete. Ordinary polling checks retained
        // receipts without repeatedly scanning every session draft in storage.
        if (refreshStorage) {
          const recovered = restoreQueueOperations()
          queueRecoveryFault.current = recovered.error
          setQueueRecoveryError(recovered.error)
          for (const record of recovered.records) {
            const identity = queueOperationIdentity(record)
            const currentRecord = queueRecoveries.current.get(identity)
            if (
              currentRecord &&
              JSON.stringify(currentRecord) !== JSON.stringify(record)
            ) {
              const error = new Error(
                "队列恢复标识与本机原记录不一致；核对前不会发送新的修改。"
              )
              queueRecoveryFault.current = error
              setQueueRecoveryError(error)
            } else if (!currentRecord) {
              queueRecoveries.current.set(identity, record)
              queueRecordIssues.current.set(identity, unknownQueueIssue(record))
              setQueueIssues((all) => ({
                ...all,
                [record.sessionId]: {
                  ...all[record.sessionId],
                  [queueOperationIssueKey(record)]: unknownQueueIssue(record),
                },
              }))
            }
          }
          publishQueueRecovery()
        }
        for (const record of [...queueRecoveries.current.values()]) {
          if (record.sessionId !== id) continue
          signal?.throwIfAborted()
          const identity = queueOperationIdentity(record)
          if (queueInFlight.current.has(identity)) continue
          if (queueKnownResults.current.has(identity)) {
            finishQueueRecovery(record, queueKnownResults.current.get(identity))
            continue
          }
          try {
            const receipt = await service.queueReceipt(
              id,
              record.operationRequestId,
              signal
            )
            signal?.throwIfAborted()
            if (
              queueRecoveries.current.get(identity) !== record ||
              queueInFlight.current.has(identity)
            )
              continue
            if (!queueReceiptMatches(record, receipt))
              throw new RpcRequestRejected(
                "原队列操作回执与本机标识不一致，请重启服务后重新核对。",
                {
                  code: "request_identity_conflict",
                  summary:
                    "原队列操作回执与本机标识不一致，原操作保留，未发送新的修改。",
                  recovery: "check",
                  severity: "warning",
                }
              )
            if (receipt.state === "committed" || receipt.state === "rejected") {
              const issue =
                receipt.state === "rejected"
                  ? feedbackFromError(
                      { issue: receipt.issue },
                      "原队列操作未被采用，请重新读取后再操作。"
                    )
                  : undefined
              finishQueueRecovery(
                record,
                issue && issue.recovery === "check"
                  ? { ...issue, recovery: "reload" }
                  : issue
              )
              continue
            }
            if (
              receipt.retryOriginalAllowed === true &&
              receipt.operation === undefined
            )
              queueRetryAllowed.current.add(identity)
            else queueRetryAllowed.current.delete(identity)
            const issue = unknownQueueIssue(
              record,
              receipt.retryOriginalAllowed === true &&
                receipt.operation === undefined
                ? "宿主尚未登记原操作。可以显式恢复原操作；恢复使用相同编号、原目标和原版本，不会创建新请求。"
                : "原操作仍待宿主确认。读取回执不会重新执行移除、修改交付设置或交付消息。"
            )
            queueRecordIssues.current.set(identity, issue)
            setQueueIssues((all) => ({
              ...all,
              [id]: {
                ...all[id],
                [queueOperationIssueKey(record)]: issue,
              },
            }))
            publishQueueRecovery()
          } catch (error) {
            if (signal?.aborted) throw error
            if (queueRecoveries.current.get(identity) !== record) continue
            queueRetryAllowed.current.delete(identity)
            const failure = feedbackFromError(
              error,
              "暂时无法核对原队列操作，原标识已保留。"
            )
            const issue: FeedbackDescription = {
              ...unknownQueueIssue(record, failure.message),
              ...(failure.recovery === "restart"
                ? { recovery: "restart" }
                : {}),
            }
            queueRecordIssues.current.set(identity, issue)
            setQueueIssues((all) => ({
              ...all,
              [id]: {
                ...all[id],
                [queueOperationIssueKey(record)]: issue,
              },
            }))
            publishQueueRecovery()
          }
        }
      })()
      queueReceiptReads.current.set(id, inspection)
      void inspection
        .finally(() => {
          if (queueReceiptReads.current.get(id) === inspection)
            queueReceiptReads.current.delete(id)
        })
        .catch(() => {})
      return inspection
    },
    [service, publishQueueRecovery, finishQueueRecovery]
  )
  const assertQueueRecovered = (id: string) => {
    const reason =
      queueRecoveryFault.current?.message ||
      ([...queueRecoveries.current.values()].some(
        (record) => record.sessionId === id
      )
        ? "请先核对原队列操作；当前草稿保留，不会发送新的修改。"
        : undefined)
    if (reason)
      throw new RpcRequestRejected(reason, {
        code: "queue_recovery_pending",
        summary: reason,
        recovery: "reload",
        severity: "warning",
      })
  }
  const clearReceipt = useCallback(
    (
      id: string,
      submission: PendingSubmission,
      outcome: "accepted" | "rejected" = submission.stage === "rejected"
        ? "rejected"
        : "accepted"
    ) => {
      const draft = resolvedConversationDraft(
        id,
        submission,
        outcome,
        draftsRef.current[id]
      )
      const resolved = { ...submission, stage: outcome }
      // Retain both copies in memory on any storage failure. A resolved receipt
      // cannot be resent, including after a window reload.
      requests.current.set(id, resolved)
      draftsRef.current = { ...draftsRef.current, [id]: draft }
      setDrafts(draftsRef.current)
      try {
        persistConversationResolution(id, resolved, outcome, draft)
        requests.current.delete(id)
        receiptCleanups.current.delete(id)
        setDraftErrors((all) => ({ ...all, [id]: "" }))
        setReceiptIssues((all) => ({ ...all, [id]: undefined }))
        setActionIssues((all) => ({
          ...all,
          [id]: all[id]?.code === "receipt_cleanup" ? undefined : all[id],
        }))
        return true
      } catch {
        receiptCleanups.current.set(id, resolved)
        setReceiptIssues((all) => ({
          ...all,
          [id]: {
            code: "receipt_cleanup",
            message:
              submission.kind === "retry"
                ? "继续请求结果已确认，当前下一稿或本地回执尚未保存。请重试本地保存，不会再次调用模型。"
                : "消息结果已确认，当前草稿或本地回执尚未保存。请重试本地保存，不会再次调用模型。",
            recovery: "retry",
          },
        }))
        return false
      }
    },
    []
  )
  const changeDraft = useCallback((id: string, draft: HomeDraft) => {
    draftsRef.current = { ...draftsRef.current, [id]: draft }
    setDrafts(draftsRef.current)
    try {
      saveConversationDraft(id, draft)
      setDraftErrors((all) => ({ ...all, [id]: "" }))
    } catch {
      setDraftErrors((all) => ({
        ...all,
        [id]: "草稿未保存，请释放本地存储空间后重试。",
      }))
    }
  }, [])
  const adoptHomeDraft = useCallback(
    (submission: HomeSubmission, following: HomeDraft) => {
      const id = submission.sessionId
      const next = adoptFollowingHomeDraft(
        submission,
        following,
        draftsRef.current[id]
      )
      // Handoff is durable before Home may remove its source. Unlike normal edits,
      // a persistence failure must propagate to the explicit Home cleanup state.
      saveConversationDraft(id, next)
      draftsRef.current = { ...draftsRef.current, [id]: next }
      setDrafts(draftsRef.current)
      setDraftErrors((all) => ({ ...all, [id]: "" }))
    },
    []
  )
  const accept = useCallback(
    (snapshot: ConversationSnapshot) => {
      // The original matching ACK resolves its immutable receipt even when a
      // newer display snapshot has already arrived. It must not replace that UI.
      const submission = requests.current.get(snapshot.id)
      const accepted =
        submission &&
        (snapshot.queue?.acceptedRequestIds.includes(submission.id) ||
          (snapshot.clientRequestId === submission.id &&
            snapshot.inputAccepted))
      if (submission && accepted) {
        setActionIssues((all) => ({
          ...all,
          [snapshot.id]: ["send", "retry", "reconcile"].includes(
            all[snapshot.id]?.action ?? ""
          )
            ? undefined
            : all[snapshot.id],
        }))
        clearReceipt(snapshot.id, submission, "accepted")
      }
      const previous = current.current[snapshot.id]
      if (
        previous?.epoch === snapshot.epoch &&
        previous.version > snapshot.version
      )
        return
      current.current = { ...current.current, [snapshot.id]: snapshot }
      setSnapshots(current.current)
      setReadIssues((all) => ({ ...all, [snapshot.id]: undefined }))
      if (!["running", "stopping"].includes(snapshot.phase))
        setActionIssues((all) => ({
          ...all,
          [snapshot.id]:
            all[snapshot.id]?.action === "stop" ? undefined : all[snapshot.id],
        }))
      // Interrupted metadata without Pi input is not proof of rejection;
      // only the formal per-request lookup or an explicit RPC rejection is.
    },
    [clearReceipt]
  )
  useEffect(() => {
    if (!selectedId) return
    const recovered = requests.current.get(selectedId)
    if (recovered?.stage === "prepared")
      clearReceipt(selectedId, recovered, "rejected")
    else if (recovered?.stage === "accepted" || recovered?.stage === "rejected")
      clearReceipt(selectedId, recovered)
    const controller = new AbortController()
    reloadRequested.current = undefined
    const ownedReads = readOwners.current
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      ownedReads.set(selectedId!, controller)
      setReadPending((all) => ({ ...all, [selectedId!]: true }))
      const before = mutations.current.get(selectedId!) ?? 0
      try {
        // Receipt reads have their own owner. They never borrow the write lock,
        // infer a result from queue shape, or repeat an original operation.
        const refreshQueueStorage =
          queueRestoreRequested.current || !!queueRecoveryFault.current
        queueRestoreRequested.current = false
        await inspectQueueReceipts(
          selectedId!,
          controller.signal,
          refreshQueueStorage
        ).catch((error) => {
          if (controller.signal.aborted) throw error
        })
        controller.signal.throwIfAborted()
        const snapshot = await service.read(selectedId!, controller.signal)
        if (
          !controller.signal.aborted &&
          !locks.current.has(selectedId!) &&
          before === (mutations.current.get(selectedId!) ?? 0)
        )
          accept(snapshot)
      } catch (error) {
        if (
          !controller.signal.aborted &&
          before === (mutations.current.get(selectedId!) ?? 0)
        )
          setReadIssues((all) => ({
            ...all,
            [selectedId!]: feedbackFromError(
              error,
              "会话暂时无法读取，请重新读取。"
            ),
          }))
      } finally {
        if (ownedReads.get(selectedId!) === controller) {
          ownedReads.delete(selectedId!)
          setReadPending((all) => ({ ...all, [selectedId!]: false }))
        }
        if (!controller.signal.aborted) {
          const phase = current.current[selectedId!]?.phase
          const requested = reloadRequested.current === selectedId
          if (requested) reloadRequested.current = undefined
          timer = setTimeout(
            read,
            requested
              ? 0
              : phase === "running" || phase === "stopping"
                ? 250
                : 1600
          )
        }
      }
    }
    void read()
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (ownedReads.get(selectedId) === controller) {
        ownedReads.delete(selectedId)
        setReadPending((all) => ({ ...all, [selectedId]: false }))
      }
    }
  }, [selectedId, service, reload, accept, clearReceipt, inspectQueueReceipts])
  const submissionFor = (
    id: string,
    value:
      | Omit<Extract<PendingSubmission, { kind: "send" }>, "id">
      | Omit<Extract<PendingSubmission, { kind: "retry" }>, "id">,
    clientRequestId?: string
  ) => {
    if (receiptCleanups.current.has(id))
      throw new RpcRequestRejected("请先完成本地回执清理，再发送新消息。", {
        code: "receipt_cleanup",
        summary: "请先完成本地回执清理，再发送新消息。",
        recovery: "none",
        severity: "warning",
      })
    const existing = requests.current.get(id)
    if (existing && clientRequestId && existing.id !== clientRequestId)
      throw new RpcRequestRejected("上一条请求尚未确认，请先核对其发送状态。", {
        code: "request_identity_conflict",
        summary: "上一条请求尚未确认，请先核对其发送状态；新输入已保留。",
        recovery: "check",
        severity: "warning",
      })
    if (existing)
      throw new RpcRequestRejected(
        existing.kind === "retry"
          ? "上一条继续请求结果尚未确认。请先核对原继续请求；下一稿和材料已保留，未发送。"
          : "上一条发送结果尚未确认。请先核对发送；当前新草稿会保留。",
        {
          code: "result_pending",
          summary:
            existing.kind === "retry"
              ? "上一条继续请求结果尚未确认。请先核对原继续请求；下一稿和材料已保留，未发送。"
              : "请先核对上一条发送的状态；当前新草稿已保留。",
          recovery: "check",
          severity: "warning",
        }
      )
    const submission = {
      ...structuredClone(value),
      stage: "prepared",
      id: clientRequestId ?? crypto.randomUUID(),
    } as PendingSubmission
    saveConversationRequest(id, submission)
    requests.current.set(id, submission)
    return submission
  }
  async function submit(
    id: string,
    submission: PendingSubmission,
    signal?: AbortSignal
  ) {
    // If this write fails, no request has reached the host. Its original draft
    // is recovered locally instead of being classified as an unknown response.
    try {
      signal?.throwIfAborted()
      submission = { ...submission, stage: "sending" }
      saveConversationRequest(id, submission)
      requests.current.set(id, submission)
    } catch (error) {
      clearReceipt(id, submission, "rejected")
      throw error
    }
    let snapshot: ConversationSnapshot
    try {
      snapshot =
        submission.kind === "send"
          ? await service.send(
              { ...submission.input, clientRequestId: submission.id },
              signal
            )
          : await service.retry({
              ...submission.input,
              clientRequestId: submission.id,
            })
    } catch (error) {
      if (error instanceof RpcRequestRejected) {
        clearReceipt(id, submission, "rejected")
      }
      throw error
    }
    // A rejected readonly lookup only rejects that lookup, not the original
    // send. Keep it outside the send-RPC rejection handler above.
    if (
      snapshot.id === id &&
      snapshot.clientRequestId === submission.id &&
      !snapshot.inputAccepted &&
      ["failed", "interrupted"].includes(snapshot.phase)
    ) {
      const receipt = await readConversationReceipt(
        service,
        id,
        submission.id,
        signal
      )
      const currentSubmission = requests.current.get(id)
      if (
        receipt.state !== "unknown" &&
        currentSubmission?.id === submission.id
      )
        clearReceipt(id, currentSubmission, receipt.state)
      return receipt.snapshot ?? snapshot
    }
    return snapshot
  }
  async function perform(
    id: string,
    action: () => Promise<ConversationSnapshot>,
    kind: ActionKind = "send"
  ) {
    if (locks.current.has(id)) throw new Error("正在处理此会话的操作，请稍候。")
    locks.current.add(id)
    mutations.current.set(id, (mutations.current.get(id) ?? 0) + 1)
    const mutation = mutations.current.get(id)
    setPending((all) => ({ ...all, [id]: true }))
    try {
      const snapshot = await action()
      accept(snapshot)
      if (mutations.current.get(id) === mutation) {
        if (!kind.startsWith("queue-"))
          setActionIssues((all) => ({
            ...all,
            [id]: all[id]?.action === kind ? undefined : all[id],
          }))
      }
      return snapshot
    } catch (error) {
      if (
        mutations.current.get(id) === mutation &&
        !(error instanceof Error && error.name === "AbortError")
      ) {
        const issue = feedbackFromError(error)
        // Queue edits own their draft feedback in QueueDock; other queue writes
        // own immutable recovery metadata in executeQueueOperation below.
        if (!kind.startsWith("queue-")) {
          if (issue.code !== "receipt_cleanup")
            setActionIssues((all) => ({
              ...all,
              [id]: {
                ...issue,
                action: kind as ConversationActionIssue["action"],
              },
            }))
        }
      }
      throw error
    } finally {
      locks.current.delete(id)
      setPending((all) => ({ ...all, [id]: false }))
    }
  }
  async function executeQueueOperation(record: QueueOperationRecord) {
    const identity = queueOperationIdentity(record)
    const id = record.sessionId
    const key = queueOperationIssueKey(record)
    if (queueRecoveries.current.get(identity) !== record)
      throw new Error("原队列操作标识已变化，请重新核对。")
    const kind: ActionKind =
      record.operation === "conversationQueueMode"
        ? "queue-mode"
        : record.operation === "conversationQueueRemove"
          ? "queue-remove"
          : "queue-deliver"
    return perform(
      id,
      async () => {
        queueInFlight.current.add(identity)
        queueRetryAllowed.current.delete(identity)
        publishQueueRecovery()
        try {
          const base = {
            sessionId: id,
            operationRequestId: record.operationRequestId,
            revision: record.revision,
          }
          const snapshot =
            record.operation === "conversationQueueMode"
              ? await service.queueMode({ ...base, mode: record.mode! })
              : record.operation === "conversationQueueRemove"
                ? await service.queueRemove({ ...base, itemId: record.itemId! })
                : await service.queueDeliver({
                    ...base,
                    itemId: record.itemId!,
                  })
          if (snapshot.id !== id)
            throw new Error("队列操作返回的会话标识不一致。")
          // RPC success proves adoption of this original queue intention only;
          // it is not proof that Pi accepted input or completed a reply.
          finishQueueRecovery(record)
          return snapshot
        } catch (error) {
          const issue = feedbackFromError(error)
          if (
            error instanceof RpcRequestRejected &&
            issue.code !== "result_unknown"
          )
            finishQueueRecovery(
              record,
              issue.recovery === "check"
                ? { ...issue, recovery: "reload" }
                : issue
            )
          else if (queueRecoveries.current.get(identity) === record) {
            const originalIssue = unknownQueueIssue(record, issue.message)
            queueRecordIssues.current.set(identity, originalIssue)
            setQueueIssues((all) => ({
              ...all,
              [id]: {
                ...all[id],
                [key]: originalIssue,
              },
            }))
            publishQueueRecovery()
          }
          throw error
        } finally {
          queueInFlight.current.delete(identity)
        }
      },
      kind
    )
  }
  async function startQueueOperation(
    id: string,
    operation: QueueOperationRecord["operation"],
    target: { itemId: string } | { mode: "single" | "all" }
  ) {
    assertQueueRecovered(id)
    if (locks.current.has(id)) throw new Error("正在处理此会话的操作，请稍候。")
    const record = freezeQueueOperation({
      sessionId: id,
      operationRequestId: crypto.randomUUID(),
      operation,
      revision: current.current[id]?.queue?.revision ?? 0,
      ...target,
    })
    try {
      saveQueueOperation(record)
    } catch (error) {
      const issue: FeedbackDescription = {
        code: "queue_recovery_storage",
        message:
          "本机无法保存队列操作的恢复标识，本次修改尚未发送。请恢复本地存储后重试。",
        recovery: "reload",
        severity: "warning",
      }
      setQueueIssues((all) => ({
        ...all,
        [id]: { ...all[id], [queueOperationIssueKey(record)]: issue },
      }))
      throw new RpcRequestRejected(issue.message, {
        code: issue.code,
        summary: issue.message,
        recovery: "reload",
        severity: "warning",
        ...(error instanceof Error
          ? { details: "未调用宿主修改接口，原队列保持不变。" }
          : {}),
      })
    }
    queueRecoveries.current.set(queueOperationIdentity(record), record)
    queueRecordIssues.current.set(queueOperationIdentity(record), undefined)
    setQueueIssues((all) => ({
      ...all,
      [id]: { ...all[id], [queueOperationIssueKey(record)]: undefined },
    }))
    publishQueueRecovery()
    return executeQueueOperation(record)
  }
  async function retryQueueOriginal(
    id: string,
    key: string,
    expectedRequestId?: string
  ) {
    const records = [...queueRecoveries.current.values()].filter(
      (record) =>
        record.sessionId === id &&
        queueOperationIssueKey(record) === key &&
        (!expectedRequestId || record.operationRequestId === expectedRequestId)
    )
    const record = records[0]
    if (
      queueRecoveryFault.current ||
      records.length !== 1 ||
      !queueRetryAllowed.current.has(queueOperationIdentity(record)) ||
      queueKnownResults.current.has(queueOperationIdentity(record)) ||
      queueReceiptReads.current.has(id) ||
      locks.current.has(id)
    )
      throw new Error("原队列操作尚不可恢复，请先完成核对。")
    // Re-persist the same frozen metadata before recovery. No new request ID,
    // current revision, edited text or material can enter this original call.
    try {
      saveQueueOperation(record)
    } catch {
      queueRetryAllowed.current.delete(queueOperationIdentity(record))
      const originalIssue = unknownQueueIssue(
        record,
        "本机恢复标识未能保存；恢复尚未发送，请释放本地存储后重新核对。"
      )
      queueRecordIssues.current.set(
        queueOperationIdentity(record),
        originalIssue
      )
      setQueueIssues((all) => ({
        ...all,
        [id]: {
          ...all[id],
          [key]: originalIssue,
        },
      }))
      publishQueueRecovery()
      throw new Error("本机恢复标识未能保存，原操作没有再次发送。")
    }
    return executeQueueOperation(record)
  }
  async function send(
    id: string,
    draft: HomeDraft,
    connections: ModelConnection[],
    signal?: AbortSignal,
    clientRequestId?: string
  ) {
    // Preflight failures preserve input. Once both copies are durable, the next
    // editable input separates from the frozen message before the host call.
    changeDraft(id, draft)
    assertQueueRecovered(id)
    const snapshot = await perform(id, () => {
      const input = {
        sessionId: id,
        workspaceId: draft.workspaceId,
        text: draft.text.trim(),
        materials: draft.materials.map(materialReference),
        ...resolveConversationModel(connections, draft),
      }
      const submission = submissionFor(
        id,
        {
          kind: "send",
          input,
          signature: JSON.stringify([
            "send",
            draftSignature(draft),
            input.connectionId,
            input.modelId,
            input.thinking,
          ]),
          draft,
        },
        clientRequestId
      )
      try {
        const prepared = prepareConversationSubmission(id, submission)
        requests.current.set(id, prepared.submission)
        draftsRef.current = { ...draftsRef.current, [id]: prepared.draft }
        setDrafts(draftsRef.current)
        setDraftErrors((all) => ({ ...all, [id]: "" }))
        return submit(id, prepared.submission, signal)
      } catch (error) {
        // A local preparation failure never reached the host. Restore once and
        // preserve the immutable receipt until the recovery draft is durable.
        clearReceipt(id, submission, "rejected")
        throw error
      }
    })
    return snapshot
  }
  async function stop(id: string) {
    const snapshot = current.current[id]
    if (!snapshot) return
    const identity = `${id}:${snapshot.runId}`
    if (stopLocks.current.has(identity)) return
    stopLocks.current.add(identity)
    mutations.current.set(id, (mutations.current.get(id) ?? 0) + 1)
    const mutation = mutations.current.get(id)
    try {
      accept(await service.stop(id, snapshot.runId))
      if (mutations.current.get(id) === mutation)
        setActionIssues((all) => ({
          ...all,
          [id]: all[id]?.action === "stop" ? undefined : all[id],
        }))
    } catch (error) {
      if (mutations.current.get(id) === mutation)
        setActionIssues((all) => ({
          ...all,
          [id]: { ...feedbackFromError(error), action: "stop" },
        }))
      throw error
    } finally {
      stopLocks.current.delete(identity)
    }
  }
  async function retry(
    id: string,
    draft: HomeDraft,
    connections: ModelConnection[]
  ) {
    assertQueueRecovered(id)
    await perform(
      id,
      () => {
        const model = resolveConversationModel(connections, draft)
        return submit(
          id,
          submissionFor(id, {
            kind: "retry",
            input: { sessionId: id, ...model },
            signature: JSON.stringify({ retry: true, ...model }),
            draft,
          })
        )
      },
      "retry"
    )
  }
  return {
    snapshots,
    drafts,
    actionIssues,
    readIssues,
    readPending,
    draftErrors,
    queueIssues,
    queueRecoveryReason: Object.fromEntries(
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
    ) as Record<string, string | undefined>,
    queueRecoveryRecords,
    queueOperationPendingByRequest: Object.fromEntries(
      queueRecoveryRecords.map((record) => [
        record.operationRequestId,
        queueInFlight.current.has(queueOperationIdentity(record)),
      ])
    ),
    queueRecoveryIssuesByRequest,
    queueStorageIssue: queueRecoveryError
      ? {
          code: "queue_recovery_storage",
          message: queueRecoveryError.message,
          recovery: "reload" as const,
          severity: "warning" as const,
        }
      : undefined,
    queueOriginalRetryAllowed,
    queueOriginalRetryAllowedByRequest,
    retryQueueOriginal,
    checkQueueReceipts: inspectQueueReceipts,
    receiptIssues,
    cleanReceipt: (id: string) => {
      const submission = receiptCleanups.current.get(id)
      if (submission) clearReceipt(id, submission)
    },
    settleHomeReceipt: (id: string, expected?: string) => {
      const submission = receiptCleanups.current.get(id)
      if (submission && (!expected || submission.id === expected))
        clearReceipt(id, submission)
      if (receiptCleanups.current.has(id))
        throw new Error("消息结果已确认，本地回执尚未清理；草稿仍保留。")
    },
    errors: Object.fromEntries(
      Array.from(
        new Set([
          ...Object.keys(actionIssues),
          ...Object.keys(readIssues),
          ...Object.keys(draftErrors),
        ])
      ).map((id) => [
        id,
        actionIssues[id]?.message ||
          readIssues[id]?.message ||
          draftErrors[id] ||
          "",
      ])
    ),
    pending,
    send,
    stop,
    retry,
    unconfirmed: Object.fromEntries(
      [...requests.current]
        .filter(
          ([, value]) => !["accepted", "rejected"].includes(value.stage ?? "")
        )
        .map(([id]) => [id, true])
    ),
    submissionDraft: (id: string) => requests.current.get(id)?.draft,
    submissionRequestId: (id: string) => requests.current.get(id)?.id,
    submissionEcho: (id: string) =>
      conversationSubmissionEcho(requests.current.get(id)),
    inspectReceipt: async (
      id: string,
      expected?: string,
      signal?: AbortSignal
    ) => {
      // Capture before accepting a snapshot, which may consume the pending receipt.
      const requestId = expected ?? requests.current.get(id)?.id
      const receipt = await readConversationReceipt(
        service,
        id,
        requestId,
        signal
      )
      signal?.throwIfAborted()
      const submission = requests.current.get(id)
      if (
        receipt.state !== "unknown" &&
        submission &&
        submission.id === requestId
      )
        clearReceipt(id, submission, receipt.state)
      if (receipt.snapshot) accept(receipt.snapshot)
      return receipt
    },
    reconcile: (id: string) =>
      perform(
        id,
        async () => {
          const submission = requests.current.get(id)
          if (
            submission &&
            ["accepted", "rejected"].includes(submission.stage ?? "")
          ) {
            clearReceipt(id, submission)
            return service.read(id)
          }
          if (!submission) return service.read(id)
          const receipt = await readConversationReceipt(
            service,
            id,
            submission.id
          )
          if (receipt.state === "unknown")
            throw new RpcRequestRejected(
              "尚未找到此请求的接收回执。请稍后再次核对，原消息和下一条草稿均已保留。",
              {
                code: "result_pending",
                summary:
                  "尚未找到此请求的接收回执；请稍后再次核对，不会重新发送。",
                recovery: "check",
                severity: "warning",
              }
            )
          clearReceipt(id, submission, receipt.state)
          return receipt.snapshot ?? service.read(id)
        },
        "reconcile"
      ),
    reload: () => {
      if (!selectedId || reloadRequested.current === selectedId) return
      queueRestoreRequested.current = true
      reloadRequested.current = selectedId
      setReadPending((all) => ({ ...all, [selectedId]: true }))
      // Coalesce refreshes into the next read; do not abort the current read.
      if (!readOwners.current.has(selectedId)) setReload((value) => value + 1)
    },
    change: changeDraft,
    adoptRecoveredDraft: (id: string, draft: HomeDraft) => {
      const currentDraft = draftsRef.current[id]
      const next =
        draft.homeRecoveryKey &&
        currentDraft?.homeRecoveryKey === draft.homeRecoveryKey
          ? currentDraft
          : draft
      // The source queue edit is removed only after this exact destination survives reload.
      saveConversationDraft(id, next)
      draftsRef.current = { ...draftsRef.current, [id]: next }
      setDrafts(draftsRef.current)
      setDraftErrors((all) => ({ ...all, [id]: "" }))
    },
    adoptHomeDraft,
    saveDraft: (id: string) => {
      if (draftsRef.current[id]) changeDraft(id, draftsRef.current[id])
    },
    queueEdit: async (
      id: string,
      itemId: string,
      text: string,
      materials?: HomeDraft["materials"],
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
