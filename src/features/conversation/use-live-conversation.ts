import { useQueueRecovery } from "./use-queue-recovery"
import { ConversationSnapshotCache } from "./conversation-snapshot-cache"
import { useCallback, useEffect, useRef, useState } from "react"
import type { ComposerDraft } from "@/lib/composer/types"
import { adoptFollowingHomeDraft } from "@/features/home/home-submission-draft"
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
import { materialReference } from "@/features/materials/material-service"
import { readConversationReceipt } from "./conversation-receipt"
import { queueOperationIdentity } from "./queue-operation-recovery"
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
  runId?: string
  epoch?: string
}
type ActionKind =
  | ConversationActionIssue["action"]
  | "queue-edit"
  | "queue-remove"
  | "queue-mode"
  | "queue-deliver"
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
  providedService?: ConversationService
) {
  // The service belongs to this hook owner; replacing it requires a new owner.
  const [service] = useState(
    () => providedService ?? createConversationService()
  )
  const [restored] = useState(restoreConversationDrafts)
  const [snapshots, setSnapshots] = useState<
    Record<string, ConversationSnapshot>
  >({})
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>(
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
  const homeHandoffs = useRef(new Set<string>())
  const inputReceiptListeners = useRef(
    new Set<(snapshot: ConversationSnapshot) => void>()
  )
  const handoffInputReceipts = useRef(
    new Map<string, Map<string, ConversationSnapshot>>()
  )
  const reloadRequested = useRef<string | undefined>(undefined)
  const [receiptIssues, setReceiptIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const receiptCleanups = useRef(new Map<string, PendingSubmission>())
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [stopRequests, setStopRequests] = useState<
    Record<string, string | undefined>
  >({})
  const [reload, setReload] = useState(0)
  const current = useRef(snapshots)
  const snapshotCache = useRef(new ConversationSnapshotCache())
  const selectedOwner = useRef(selectedId)
  useEffect(() => {
    selectedOwner.current = selectedId
  }, [selectedId])
  const publishInputReceipt = useCallback((snapshot: ConversationSnapshot) => {
    if (
      !snapshot.clientRequestId ||
      (!snapshot.inputAccepted && snapshot.inputDisposition !== "handled")
    )
      return
    if (homeHandoffs.current.has(snapshot.id)) {
      // Keep the original ACK until the initial Home owner finishes, even if a
      // newer display snapshot belongs to a different input by that time.
      const receipts =
        handoffInputReceipts.current.get(snapshot.id) ?? new Map()
      receipts.set(snapshot.clientRequestId, snapshot)
      handoffInputReceipts.current.set(snapshot.id, receipts)
      return
    }
    for (const listener of inputReceiptListeners.current) listener(snapshot)
  }, [])
  const subscribeInputReceipts = useCallback(
    (listener: (snapshot: ConversationSnapshot) => void) => {
      inputReceiptListeners.current.add(listener)
      queueMicrotask(() => {
        if (!inputReceiptListeners.current.has(listener)) return
        for (const snapshot of Object.values(current.current)) {
          if (
            !homeHandoffs.current.has(snapshot.id) &&
            snapshot.clientRequestId &&
            (snapshot.inputAccepted || snapshot.inputDisposition === "handled")
          )
            listener(snapshot)
        }
      })
      return () => {
        inputReceiptListeners.current.delete(listener)
      }
    },
    []
  )
  const requests = useRef(restored.requests)
  const locks = useRef(new Set<string>())
  const stopLocks = useRef(new Set<string>())
  const unknownStops = useRef(new Set<string>())
  const mutations = useRef(new Map<string, number>())
  const clearReceipt = useCallback(
    (
      id: string,
      submission: PendingSubmission,
      outcome: "accepted" | "handled" | "rejected" = submission.stage ===
      "rejected"
        ? "rejected"
        : "accepted"
    ) => {
      // Local receipt consumption also releases handled input. The official
      // snapshot continues to distinguish it from a persisted Pi user message.
      const resolvedOutcome = outcome === "handled" ? "accepted" : outcome
      const draft = resolvedConversationDraft(
        id,
        submission,
        resolvedOutcome,
        draftsRef.current[id]
      )
      const resolved = { ...submission, stage: resolvedOutcome }
      // Retain both copies in memory on any storage failure. A resolved receipt
      // cannot be resent, including after a window reload.
      requests.current.set(id, resolved)
      draftsRef.current = { ...draftsRef.current, [id]: draft }
      setDrafts(draftsRef.current)
      try {
        persistConversationResolution(id, resolved, resolvedOutcome, draft)
        requests.current.delete(id)
        receiptCleanups.current.delete(id)
        setDraftErrors((all) => ({ ...all, [id]: "" }))
        setReceiptIssues((all) => ({ ...all, [id]: undefined }))
        setActionIssues((all) => ({
          ...all,
          [id]:
            all[id]?.code === "receipt_cleanup" ||
            (resolvedOutcome === "accepted" &&
              ["send", "retry", "reconcile"].includes(all[id]?.action ?? "") &&
              ["result_unknown", "result_pending"].includes(
                all[id]?.code ?? ""
              ))
              ? undefined
              : all[id],
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
  const changeDraft = useCallback((id: string, draft: ComposerDraft) => {
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
    (submission: HomeSubmission, following: ComposerDraft) => {
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
            (snapshot.inputAccepted ||
              snapshot.inputDisposition === "handled")))
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
      // Acceptance belongs to the request, independently of display ordering.
      publishInputReceipt(snapshot)
      const previous = current.current[snapshot.id]
      if (
        previous?.epoch === snapshot.epoch &&
        previous.version > snapshot.version
      )
        return
      current.current = snapshotCache.current.accept(
        snapshot,
        new Set([
          ...(selectedOwner.current ? [selectedOwner.current] : []),
          ...requests.current.keys(),
          ...homeHandoffs.current,
          ...locks.current,
          ...stopLocks.current,
          ...readOwners.current.keys(),
        ])
      )
      setSnapshots(current.current)
      setReadIssues((all) => ({ ...all, [snapshot.id]: undefined }))
      if (
        previous?.runId !== snapshot.runId ||
        previous?.epoch !== snapshot.epoch ||
        snapshot.phase !== "running"
      ) {
        if (previous)
          unknownStops.current.delete(
            `${previous.id}:${previous.epoch}:${previous.runId}`
          )
        setActionIssues((all) => ({
          ...all,
          [snapshot.id]:
            all[snapshot.id]?.action === "stop" ? undefined : all[snapshot.id],
        }))
      }
      // Interrupted metadata without Pi input is not proof of rejection;
      // only the formal per-request lookup or an explicit RPC rejection is.
    },
    [clearReceipt, publishInputReceipt]
  )
  const {
    queueRestoreRequested,
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
    const hasFollow = typeof service.follow === "function"
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      if (homeHandoffs.current.has(selectedId!)) {
        timer = setTimeout(read, 100)
        return
      }
      let failedRead = false
      ownedReads.set(selectedId!, controller)
      if (!current.current[selectedId!])
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
        const snapshot = hasFollow
          ? await service.follow(
              selectedId!,
              current.current[selectedId!],
              controller.signal
            )
          : await service.read(selectedId!, controller.signal)
        if (
          !controller.signal.aborted &&
          !locks.current.has(selectedId!) &&
          before === (mutations.current.get(selectedId!) ?? 0)
        )
          accept(snapshot)
      } catch (error) {
        failedRead = true
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
              : hasFollow
                ? current.current[selectedId!] && !failedRead
                  ? 0
                  : 1000
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
  }, [
    selectedId,
    service,
    reload,
    accept,
    clearReceipt,
    inspectQueueReceipts,
    queueRecoveryFault,
    queueRestoreRequested,
  ])
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
  async function send(
    id: string,
    draft: ComposerDraft,
    connections: ModelConnection[],
    signal?: AbortSignal,
    clientRequestId?: string,
    delivery: "followUp" | "steer" = "followUp",
    preserveFollowing = false
  ) {
    // Preflight failures preserve input. Once both copies are durable, the next
    // editable input separates from the frozen message before the host call.
    if (!preserveFollowing) changeDraft(id, draft)
    assertQueueRecovered(id)
    const snapshot = await perform(id, () => {
      const input = {
        sessionId: id,
        workspaceId: draft.workspaceId,
        text: draft.text.trim(),
        materials: draft.materials.map(materialReference),
        delivery,
        ...resolveConversationModel(connections, draft),
      }
      const submission = submissionFor(
        id,
        {
          kind: "send",
          input,
          placement:
            current.current[id]?.phase === "running" && delivery === "followUp"
              ? "queued"
              : "transcript",
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
        const editing = preserveFollowing ? draftsRef.current[id] : undefined
        const prepared = prepareConversationSubmission(id, submission)
        if (editing) {
          prepared.draft = editing
          saveConversationDraft(id, editing)
        }
        requests.current.set(id, prepared.submission)
        draftsRef.current = { ...draftsRef.current, [id]: prepared.draft }
        setDrafts(draftsRef.current)
        setDraftErrors((all) => ({ ...all, [id]: "" }))
        setActionIssues((all) => {
          const issue = all[id]
          if (
            !issue ||
            !["send", "reconcile"].includes(issue.action) ||
            issue.recovery === "check" ||
            [
              "result_unknown",
              "result_pending",
              "receipt_cleanup",
              "queue_recovery_storage",
            ].includes(issue.code)
          )
            return all
          return { ...all, [id]: undefined }
        })
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
    if (!snapshot || snapshot.phase !== "running" || !snapshot.runId) return
    const identity = `${id}:${snapshot.epoch}:${snapshot.runId}`
    if (stopLocks.current.has(identity) || unknownStops.current.has(identity))
      return
    stopLocks.current.add(identity)
    setStopRequests((all) => ({ ...all, [id]: identity }))
    setActionIssues((all) =>
      all[id]?.action === "stop" ? { ...all, [id]: undefined } : all
    )
    const ownsRun = () => {
      const latest = current.current[id]
      return (
        latest?.epoch === snapshot.epoch &&
        latest.runId === snapshot.runId &&
        latest.phase === "running"
      )
    }
    try {
      accept(await service.stop(id, snapshot.runId))
      unknownStops.current.delete(identity)
      if (ownsRun())
        setActionIssues((all) => ({
          ...all,
          [id]: all[id]?.action === "stop" ? undefined : all[id],
        }))
    } catch (error) {
      if (ownsRun()) {
        const issue = feedbackFromError(error)
        if (["result_unknown", "result_pending"].includes(issue.code))
          unknownStops.current.add(identity)
        setActionIssues((all) => ({
          ...all,
          [id]: {
            ...issue,
            action: "stop",
            runId: snapshot.runId,
            epoch: snapshot.epoch,
          },
        }))
      }
      throw error
    } finally {
      stopLocks.current.delete(identity)
      setStopRequests((all) =>
        all[id] === identity ? { ...all, [id]: undefined } : all
      )
    }
  }
  async function retry(
    id: string,
    draft: ComposerDraft,
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
    stopPending: Object.fromEntries(
      Object.entries(stopRequests).map(([id, identity]) => [
        id,
        identity === `${id}:${snapshots[id]?.epoch}:${snapshots[id]?.runId}` &&
          snapshots[id]?.phase === "running",
      ])
    ),
    stopUnconfirmed: Object.fromEntries(
      Object.values(snapshots).map((snapshot) => [
        snapshot.id,
        unknownStops.current.has(
          `${snapshot.id}:${snapshot.epoch}:${snapshot.runId}`
        ),
      ])
    ),
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
    beginHomeHandoff: (id: string, draft: ComposerDraft) => {
      homeHandoffs.current.add(id)
      draftsRef.current = { ...draftsRef.current, [id]: draft }
      setDrafts(draftsRef.current)
      setReadIssues((all) => ({ ...all, [id]: undefined }))
    },
    endHomeHandoff: (id: string) => {
      homeHandoffs.current.delete(id)
      const receipts = handoffInputReceipts.current.get(id)
      handoffInputReceipts.current.delete(id)
      for (const snapshot of receipts?.values() ?? [])
        publishInputReceipt(snapshot)
      const snapshot = current.current[id]
      if (snapshot && !receipts?.has(snapshot.clientRequestId ?? ""))
        publishInputReceipt(snapshot)
    },
    subscribeInputReceipts,
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
          // A restored unknown request may not have an in-memory action issue.
          // Keep its same recovery visible while inspecting, without exposing
          // an unknown prompt during an ordinary first submission.
          setActionIssues((all) =>
            all[id]
              ? all
              : {
                  ...all,
                  [id]: {
                    action: "reconcile",
                    code: "result_pending",
                    message:
                      submission.kind === "retry"
                        ? "继续请求结果待核对。"
                        : "发送结果待核对。",
                    recovery: "check",
                    severity: "warning",
                  },
                }
          )
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
    adoptRecoveredDraft: (id: string, draft: ComposerDraft) => {
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
