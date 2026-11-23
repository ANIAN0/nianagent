import { SessionValueStore } from "./session-value-store"
import { useCallback, useRef, useState, type MutableRefObject } from "react"
import {
  frontendBlocker,
  useMaintenanceSave,
} from "@/lib/maintenance/maintenance-coordinator"
import {
  maintenanceBlockedQueueEdits,
  saveRetainedQueueEdits,
} from "./queue-edit-store"
import { materialsBlockMaintenance } from "@/lib/composer/upload-retry-sources"
import {
  materialReference,
  type MaterialService,
} from "@/lib/composer/material-service-port"
import type { ComposerDraft } from "@/lib/composer/types"
import {
  adoptFollowingHomeDraft,
  draftSignature,
  type HomeSubmission,
} from "@/lib/submission/home-draft-rules"
import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import type { ConversationService } from "./conversation-service"
import { RpcRequestRejected } from "@/lib/rpc/client"
import { readConversationReceipt } from "./conversation-receipt"
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
  restoreConversationDrafts,
  saveConversationDraft,
  saveConversationRequest,
  type PendingSubmission,
} from "./conversation-draft-store"

export type ConversationActionIssue = FeedbackDescription & {
  action: "send" | "stop" | "retry" | "reconcile"
  runId?: string
  epoch?: string
}

export type ActionKind =
  | ConversationActionIssue["action"]
  | "queue-edit"
  | "queue-remove"
  | "queue-mode"
  | "queue-deliver"

export type ResolvedConversationModel = {
  connectionId: string
  modelId: string
  thinking: ConversationSnapshot["thinking"]
}

export function useConversationSubmission<TConnection>({
  service,
  materialService,
  current,
  accept,
  assertQueueRecovered,
  resolveModel,
}: {
  service: ConversationService
  materialService?: MaterialService
  current: MutableRefObject<Record<string, ConversationSnapshot>>
  accept: (snapshot: ConversationSnapshot) => void
  assertQueueRecovered: (id: string) => void
  resolveModel: (
    connections: TConnection[],
    draft: ComposerDraft
  ) => ResolvedConversationModel
}) {
  const [restored] = useState(restoreConversationDrafts)
  const [draftStore] = useState(() => new SessionValueStore(restored.drafts))
  const currentDraft = draftStore.read
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({})
  const [actionIssues, setActionIssues] = useState<
    Record<string, ConversationActionIssue | undefined>
  >({})
  const [receiptIssues, setReceiptIssues] = useState<
    Record<string, FeedbackDescription | undefined>
  >({})
  const receiptCleanups = useRef(new Map<string, PendingSubmission>())
  const [pending, setPending] = useState<
    Record<string, ActionKind | undefined>
  >({})
  const [stopRequests, setStopRequests] = useState<
    Record<string, string | undefined>
  >({})

  const requests = useRef(restored.requests)
  const [unconfirmed, setUnconfirmed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...restored.requests]
        .filter(
          ([, value]) => !["accepted", "rejected"].includes(value.stage ?? "")
        )
        .map(([id]) => [id, true])
    )
  )
  const syncUnconfirmed = useCallback(() => {
    setUnconfirmed(
      Object.fromEntries(
        [...requests.current]
          .filter(
            ([, value]) => !["accepted", "rejected"].includes(value.stage ?? "")
          )
          .map(([id]) => [id, true])
      )
    )
  }, [])
  const locks = useRef(new Set<string>())
  const stopLocks = useRef(new Set<string>())
  const unknownStops = useRef(new Set<string>())
  const [unknownStopIds, setUnknownStopIds] = useState<Record<string, boolean>>(
    {}
  )
  const mutations = useRef(new Map<string, number>())

  useMaintenanceSave(() => {
    for (const [id, draft] of draftStore.entries())
      saveConversationDraft(id, draft)
    for (const [id, submission] of requests.current)
      saveConversationRequest(id, submission)
    saveRetainedQueueEdits()
    const preparingConversations = new Set(
      draftStore
        .entries()
        .filter(([id, draft]) =>
          materialsBlockMaintenance(materialService, id, draft.materials)
        )
        .map(([id]) => id)
    )
    for (const [id, submission] of requests.current)
      if (
        materialsBlockMaintenance(
          materialService,
          id,
          submission.draft.materials
        )
      )
        preparingConversations.add(id)
    return [
      ...[...preparingConversations].map((id) =>
        frontendBlocker(
          "conversation-materials:" + id,
          "会话材料仍在准备，或粘贴图片仅保存在窗口中，请完成准备或移除后再维护。"
        )
      ),
      ...maintenanceBlockedQueueEdits(materialService).map((record) =>
        frontendBlocker(
          "queue-materials:" + record.sessionId + ":" + record.id,
          "排队编辑材料仍在准备，或粘贴图片仅保存在窗口中，请完成准备或移除后再维护。"
        )
      ),
    ]
  })

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
        currentDraft(id)
      )
      const resolved = { ...submission, stage: resolvedOutcome }
      // Retain both copies in memory on any storage failure. A resolved receipt
      // cannot be resent, including after a window reload.
      requests.current.set(id, resolved)
      syncUnconfirmed()
      draftStore.write(id, draft)
      try {
        persistConversationResolution(id, resolved, resolvedOutcome, draft)
        requests.current.delete(id)
        syncUnconfirmed()
        receiptCleanups.current.delete(id)
        setDraftErrors((all) => (all[id] ? { ...all, [id]: "" } : all))
        setReceiptIssues((all) => ({ ...all, [id]: undefined }))
        setActionIssues((all) => ({
          ...all,
          [id]:
            all[id]?.code === "receipt_cleanup" ||
            (["send", "retry", "reconcile"].includes(all[id]?.action ?? "") &&
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
    [currentDraft, draftStore, syncUnconfirmed]
  )

  const changeDraft = useCallback(
    (id: string, draft: ComposerDraft) => {
      draftStore.write(id, draft)
      try {
        saveConversationDraft(id, draft)
        setDraftErrors((all) => (all[id] ? { ...all, [id]: "" } : all))
      } catch {
        setDraftErrors((all) => ({
          ...all,
          [id]: "草稿未保存，请释放本地存储空间后重试。",
        }))
      }
    },
    [draftStore]
  )

  const adoptHomeDraft = useCallback(
    (submission: HomeSubmission, following: ComposerDraft) => {
      const id = submission.sessionId
      const next = adoptFollowingHomeDraft(
        submission,
        following,
        currentDraft(id)
      )
      // Handoff is durable before Home may remove its source. Unlike normal edits,
      // a persistence failure must propagate to the explicit Home cleanup state.
      saveConversationDraft(id, next)
      draftStore.write(id, next)
      setDraftErrors((all) => (all[id] ? { ...all, [id]: "" } : all))
    },
    [currentDraft, draftStore]
  )

  const onAcceptSnapshot = useCallback(
    (
      snapshot: ConversationSnapshot,
      previous: ConversationSnapshot | undefined
    ) => {
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
      if (
        !(
          previous?.epoch === snapshot.epoch &&
          previous.version > snapshot.version
        ) &&
        (previous?.runId !== snapshot.runId ||
          previous?.epoch !== snapshot.epoch ||
          snapshot.phase !== "running")
      ) {
        if (previous) {
          const id = `${previous.id}:${previous.epoch}:${previous.runId}`
          unknownStops.current.delete(id)
          setUnknownStopIds((all) => {
            if (!all[id]) return all
            const next = { ...all }
            delete next[id]
            return next
          })
        }
        setActionIssues((all) =>
          all[snapshot.id]?.action === "stop"
            ? { ...all, [snapshot.id]: undefined }
            : all
        )
      }
    },
    [clearReceipt]
  )

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
    syncUnconfirmed()
    return submission
  }

  async function submit(
    id: string,
    submission: PendingSubmission,
    signal?: AbortSignal,
    onRequestBoundary?: (boundary: "dispatch" | "not-started") => void
  ) {
    // If this write fails, no request has reached the host. Its original draft
    // is recovered locally instead of being classified as an unknown response.
    try {
      signal?.throwIfAborted()
      submission = { ...submission, stage: "sending" }
      saveConversationRequest(id, submission)
      requests.current.set(id, submission)
      syncUnconfirmed()
    } catch (error) {
      clearReceipt(id, submission, "rejected")
      throw error
    }
    let snapshot: ConversationSnapshot
    try {
      onRequestBoundary?.("dispatch")
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
        // These direct send-RPC refusals precede conversationStart. A later
        // readonly lookup can return the same codes, so only classify here.
        if (
          ["maintenance_busy", "host_version"].includes(error.issue?.code ?? "")
        )
          onRequestBoundary?.("not-started")
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
    setPending((all) => ({ ...all, [id]: kind }))
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
      setPending((all) => ({ ...all, [id]: undefined }))
    }
  }

  async function send(
    id: string,
    draft: ComposerDraft,
    connections: TConnection[],
    signal?: AbortSignal,
    clientRequestId?: string,
    delivery: "followUp" | "steer" = "followUp",
    preserveFollowing = false,
    onRequestBoundary?: (boundary: "dispatch" | "not-started") => void
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
        ...resolveModel(connections, draft),
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
        const editing = preserveFollowing ? currentDraft(id) : undefined
        const prepared = prepareConversationSubmission(id, submission)
        if (editing) {
          prepared.draft = editing
          saveConversationDraft(id, editing)
        }
        requests.current.set(id, prepared.submission)
        syncUnconfirmed()
        draftStore.write(id, prepared.draft)
        setDraftErrors((all) => (all[id] ? { ...all, [id]: "" } : all))
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
        return submit(id, prepared.submission, signal, onRequestBoundary)
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
      setUnknownStopIds((all) => {
        if (!all[identity]) return all
        const next = { ...all }
        delete next[identity]
        return next
      })
      if (ownsRun())
        setActionIssues((all) => ({
          ...all,
          [id]: all[id]?.action === "stop" ? undefined : all[id],
        }))
    } catch (error) {
      if (ownsRun()) {
        const issue = feedbackFromError(error)
        if (["result_unknown", "result_pending"].includes(issue.code)) {
          unknownStops.current.add(identity)
          setUnknownStopIds((all) => ({ ...all, [identity]: true }))
        }
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
    connections: TConnection[]
  ) {
    assertQueueRecovered(id)
    await perform(
      id,
      () => {
        const model = resolveModel(connections, draft)
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
    draftStore,
    currentDraft,
    draftErrors,
    actionIssues,
    receiptIssues,
    pending,
    stopPending: (snapshot: ConversationSnapshot | undefined) =>
      snapshot?.phase === "running" &&
      stopRequests[snapshot.id] ===
        `${snapshot.id}:${snapshot.epoch}:${snapshot.runId}`,
    stopUnconfirmed: (snapshot: ConversationSnapshot | undefined) =>
      !!snapshot &&
      !!unknownStopIds[`${snapshot.id}:${snapshot.epoch}:${snapshot.runId}`],
    unconfirmed,
    setHandoffDraft: (id: string, draft: ComposerDraft) => {
      draftStore.write(id, draft)
    },
    requests,
    locks,
    stopLocks,
    mutations,
    clearReceipt,
    onAcceptSnapshot,
    perform,
    send,
    stop,
    retry,
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
          if (!submission) {
            const snapshot = await service.read(id)
            accept(snapshot)
            if (
              snapshot.issue?.code !== "result_unknown" ||
              !snapshot.clientRequestId
            )
              return snapshot
            const receipt = await readConversationReceipt(
              service,
              id,
              snapshot.clientRequestId
            )
            if (receipt.state === "unknown")
              throw new RpcRequestRejected(
                "原请求的接受结果仍未确认，请保留输入，不要重复发送。",
                {
                  code: "result_pending",
                  summary:
                    "原请求的接受结果仍未确认；本次只核对原请求，不会重新发送。",
                  recovery: "check",
                  severity: "warning",
                }
              )
            return receipt.snapshot ?? service.read(id)
          }
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
    change: changeDraft,
    updateDraft: (
      id: string,
      fallback: ComposerDraft,
      update: (draft: ComposerDraft) => ComposerDraft
    ) => {
      const next = update(currentDraft(id) ?? fallback)
      changeDraft(id, next)
      return next
    },
    adoptRecoveredDraft: (id: string, draft: ComposerDraft) => {
      const active = currentDraft(id)
      const next =
        draft.homeRecoveryKey &&
        active?.homeRecoveryKey === draft.homeRecoveryKey
          ? active
          : draft
      // The source queue edit is removed only after this exact destination survives reload.
      saveConversationDraft(id, next)
      draftStore.write(id, next)
      setDraftErrors((all) => (all[id] ? { ...all, [id]: "" } : all))
    },
    adoptHomeDraft,
    saveDraft: (id: string) => {
      const draft = currentDraft(id)
      if (draft) changeDraft(id, draft)
    },
    readStoredDraft: (id: string) => restoreConversationDrafts().drafts[id],
    saveStoredDraft: saveConversationDraft,
  }
}
