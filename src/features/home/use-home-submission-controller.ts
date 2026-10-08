import { useHomeSubmissionOwnership } from "./use-home-submission-ownership"
import { useEffect } from "react"

import type { ComposerDraft, HomeSubmitReceipt } from "@/lib/composer/types"

import { feedbackFromError } from "@/lib/operation-issue"
import { RpcRequestRejected } from "@/lib/rpc/client"
import type { useLiveConversation } from "@/features/conversation/use-live-conversation"
import type { ModelConnection } from "@/features/models/model-types"

import type { useWorkspaces } from "@/features/workspaces/use-workspaces"
import type { SessionService } from "@/features/session/session-service"

import {
  createHomeSubmission,
  matchesHomeSubmission,
  restoreHomeDraft,
  recoverRejectedHomeSubmission,
  saveHomeSubmission,
} from "@/features/conversation/conversation-draft-store"
import { sameHomeSubmissionAttempt } from "@/features/home/home-receipt-check"
import { followingHomeDraft } from "@/features/home/home-submission-draft"
import {
  hasPreparingHomeMaterials,
  homePreflightError,
  nextHomeViewKey,
} from "@/features/home/home-submission-lifecycle"

export type HomeSubmissionControllerOptions = {
  chat: ReturnType<typeof useLiveConversation>
  connections: ModelConnection[]
  workspaces: ReturnType<typeof useWorkspaces>
  sessionService: SessionService
  selected?: string
  selectConversation: (id?: string) => void
  refreshCatalog: (background?: boolean) => Promise<unknown>
}

/** Owns Home submission transactions, retained material editors and durable handoff.
 * Pi/Conversation owns acceptance; this controller never replays an unknown request.
 */
export function useHomeSubmissionController({
  chat,
  connections,
  workspaces,
  sessionService,
  selected,
  selectConversation,
  refreshCatalog,
}: HomeSubmissionControllerOptions) {
  const subscribeInputReceipts = chat.subscribeInputReceipts
  const {
    setReceiptListener,
    setResumeHomeHandoff,
    replaceSubmissions,
    notifyInputReceipt,
    homeSubmissionsRef,
    acceptHomeSubmission,
    waitingHomeMaterials,
    homeSelectionActivities,
    currentHomeEditing,
    homeNavigation,
    prepareHomeSubmission,
    setHomeSubmissions,
    rejectHomeSubmission,
    retainedHomeSubmissionError,
    setNotice,
    homeDraft,
    homeSubmissions,
    retainedHomeViews,
    retainedHomeViewsRef,
    setHomeDraft,
    homeCleanupErrors,
    persistedHomeRestorations,
    acknowledgeHomeRestoration,
    setHomeReconcileErrors,
    homeRestorations,
    homeReconcileErrors,
    notice,
    saveHomeDraft,
    saveHomeSelectionActivity,
    homeSubmissionEditing,
  } = useHomeSubmissionOwnership({
    chat: {
      adoptHomeDraft: chat.adoptHomeDraft,
      settleHomeReceipt: chat.settleHomeReceipt,
    },
  })

  useEffect(() => {
    setReceiptListener((snapshot) => {
      const submission = homeSubmissionsRef.current[snapshot.id]
      if (
        submission?.stage !== "sending" ||
        submission.sessionId !== snapshot.id ||
        submission.clientRequestId !== snapshot.clientRequestId ||
        (!snapshot.inputAccepted && snapshot.inputDisposition !== "handled") ||
        !snapshot.cwd
      )
        return
      if (acceptHomeSubmission(submission, snapshot.cwd))
        void refreshCatalog(true)
    })
    setResumeHomeHandoff((id) => {
      const waiting = waitingHomeMaterials.current.get(id)
      const submission = homeSubmissionsRef.current[id]
      if (
        !waiting ||
        !submission ||
        homeSelectionActivities.current.has(id) ||
        hasPreparingHomeMaterials(currentHomeEditing(submission))
      )
        return
      if (acceptHomeSubmission(submission, waiting.cwd, waiting.ownsPage)) {
        if (waiting.ownsPage()) selectConversation(id)
        void refreshCatalog(true)
      }
    })
  })
  useEffect(
    () => subscribeInputReceipts((snapshot) => notifyInputReceipt(snapshot)),
    [subscribeInputReceipts, notifyInputReceipt]
  )
  async function submitHome(
    draft: ComposerDraft,
    signal?: AbortSignal,
    original = draft
  ): Promise<HomeSubmitReceipt> {
    const ownsPage = homeNavigation.capture()
    const id = draft.sessionId ?? crypto.randomUUID()
    const workspace = workspaces.items.find(
      (item) => item.id === draft.workspaceId
    )
    const submission = homeSubmissionsRef.current[id] ?? {
      ...createHomeSubmission({ ...draft, sessionId: id }, original),
      cwd: workspace?.path,
      followingDraft: true as const,
    }
    if (!homeSubmissionsRef.current[id])
      prepareHomeSubmission(submission, followingHomeDraft(submission.draft))
    // The immutable original is durable. Render it immediately in the selected
    // conversation while expensive configuration/model preparation continues.
    chat.beginHomeHandoff(
      id,
      currentHomeEditing(submission) ?? followingHomeDraft(submission.draft)
    )
    if (!signal?.aborted && ownsPage()) selectConversation(id)
    const ownsConversation = homeNavigation.capture()
    let started = false
    let preflightPhase: "read" | "apply" = "read"
    let cleaned: boolean
    try {
      if (!workspace || workspace.available === false)
        throw new Error("工作目录不可用，请重新选择工作区。")
      const saved = await sessionService.read(id, signal)
      preflightPhase = "apply"
      const configuration =
        saved ??
        (await sessionService.apply(
          { sessionId: id, cwd: workspace.path, ...draft.session },
          signal
        ))
      signal?.throwIfAborted()
      if (configuration.unavailableToolIds.length)
        throw new Error("请在会话配置中取消不可用工具后再发送。")
      // Persist the side-effect boundary before a model request is possible.
      const sending = { ...submission, stage: "sending" as const }
      saveHomeSubmission(sending)
      replaceSubmissions({
        ...homeSubmissionsRef.current,
        [id]: sending,
      })
      setHomeSubmissions(homeSubmissionsRef.current)
      started = true
      const accepted = await chat.send(
        id,
        submission.draft,
        connections,
        signal,
        submission.clientRequestId,
        "followUp",
        true
      )
      if (!accepted.inputAccepted && accepted.inputDisposition !== "handled")
        throw new RpcRequestRejected(
          accepted.error || "消息未能开始，请检查模型配置后重试。",
          accepted.issue
        )
      // Acceptance is irreversible even if the originating view was cancelled.
      cleaned = acceptHomeSubmission(
        submission,
        workspace.path,
        () => !signal?.aborted && ownsPage()
      )
    } catch (error) {
      if (!started || !chat.submissionDraft(id)) {
        const recovered = recoverRejectedHomeSubmission(
          submission,
          currentHomeEditing(submission) ?? chat.drafts[id]
        )
        const rejected = rejectHomeSubmission(
          submission,
          !started ? homePreflightError(error, preflightPhase) : error
        )
        chat.adoptRecoveredDraft(id, recovered.draft)
        if (!signal?.aborted && ownsConversation()) selectConversation()
        throw rejected
      }
      throw retainedHomeSubmissionError(
        error,
        "尚未确认原提交结果。正在核对的副本和下一条草稿均已保留。"
      )
    } finally {
      chat.endHomeHandoff(id)
    }
    if (cleaned && !signal?.aborted && ownsPage()) selectConversation(id)
    void refreshCatalog(true)
    return { disposition: "conversation" }
  }
  async function checkHomeSubmission(
    id: string,
    navigate = true,
    signal?: AbortSignal
  ) {
    const ownsPage = homeNavigation.capture()
    const submitted = chat.submissionDraft(id)
    let submission = homeSubmissionsRef.current[id]
    if (!submission && submitted) {
      // A legacy recovery must bind its persisted request ID, never a new UUID.
      submission = {
        ...createHomeSubmission({ ...submitted, sessionId: id }),
        clientRequestId: chat.submissionRequestId(id),
        stage: "sending",
      }
      saveHomeSubmission(submission)
      replaceSubmissions({
        ...homeSubmissionsRef.current,
        [id]: submission,
      })
      setHomeSubmissions(homeSubmissionsRef.current)
    }
    if (!submission) throw new Error("没有可核对的原提交，当前输入保留。")
    const original = submission
    if (["prepared", "rejected"].includes(submission.stage ?? ""))
      throw rejectHomeSubmission(
        submission,
        new Error("消息未被接受，原输入已恢复。")
      )
    let cwd = submission.cwd
    if (!submission.transfer && submission.stage !== "accepted") {
      const receipt = await chat.inspectReceipt(
        id,
        submission.clientRequestId,
        signal
      )
      signal?.throwIfAborted()
      if (!sameHomeSubmissionAttempt(homeSubmissionsRef.current[id], original))
        throw new DOMException(
          "原提交已完成或已更换，旧核对不再生效。",
          "AbortError"
        )
      if (!submission.clientRequestId && receipt.clientRequestId) {
        submission = { ...submission, clientRequestId: receipt.clientRequestId }
        saveHomeSubmission(submission)
        replaceSubmissions({
          ...homeSubmissionsRef.current,
          [id]: submission,
        })
        setHomeSubmissions(homeSubmissionsRef.current)
      }
      if (receipt.state === "rejected")
        throw rejectHomeSubmission(
          submission,
          new RpcRequestRejected(
            receipt.issue?.summary ||
              receipt.snapshot?.error ||
              "消息未被接受，原输入已恢复。",
            receipt.issue ?? receipt.snapshot?.issue
          )
        )
      if (receipt.state !== "accepted" && receipt.state !== "handled")
        throw retainedHomeSubmissionError(
          undefined,
          "仍未确认原提交结果，副本和下一条输入均已保留。"
        )
      cwd = receipt.snapshot?.cwd
    }
    if (!cwd) throw new Error("原提交的工作目录尚未确认，草稿保留。")
    const candidate = restoreHomeDraft(submission.draft.workspaceId)
    const preserved =
      !!(candidate.text?.trim() || candidate.materials?.length) &&
      !matchesHomeSubmission(candidate, submission)
    if (
      !acceptHomeSubmission(
        submission,
        cwd,
        () => navigate && !signal?.aborted && ownsPage()
      )
    ) {
      if (waitingHomeMaterials.current.has(id))
        return { disposition: "conversation" as const }
      throw new Error("原提交结果已确认，下一条草稿尚未完整交接。请重试清理。")
    }
    if (navigate && !signal?.aborted && ownsPage()) {
      selectConversation(id)
      if (preserved)
        setNotice("原输入已处理，等待期间的下一条草稿已带入本会话输入区。")
    }
    void refreshCatalog(true)
    return { disposition: "conversation" as const }
  }
  const visibleHomeWorkspace =
    homeDraft.draft?.workspaceId ||
    homeDraft.workspaceId ||
    workspaces.selectedId ||
    workspaces.items[0]?.id
  const visibleHomeSubmission = Object.values(homeSubmissions).find(
    (submission) =>
      submission.draft.workspaceId === visibleHomeWorkspace &&
      (!homeDraft.draft?.sessionId ||
        submission.sessionId === homeDraft.draft.sessionId)
  )
  const homeViews: {
    key: number
    draft?: ComposerDraft
    workspaceId?: string
  }[] = Object.values(retainedHomeViews).filter(
    (view) => selected || view.key !== homeDraft.key
  )
  const activeHomeSubmission = homeDraft.draft?.sessionId
    ? homeSubmissions[homeDraft.draft.sessionId]
    : undefined
  // Keep the original submit owner mounted during early navigation. Its
  // configuration-effect cleanup aborts the request if this view disappears.
  if (
    (!selected ||
      (activeHomeSubmission &&
        ["prepared", "sending"].includes(activeHomeSubmission.stage ?? ""))) &&
    !workspaces.initialLoading &&
    !homeViews.some((view) => view.key === homeDraft.key)
  )
    homeViews.push({
      key: homeDraft.key,
      draft: homeDraft.draft,
      workspaceId: homeDraft.workspaceId ?? workspaces.selectedId,
    })

  function openHome(workspaceId?: string) {
    const requested =
      workspaceId ?? workspaces.selectedId ?? workspaces.items[0]?.id
    const retained = Object.values(retainedHomeViewsRef.current).find(
      (view) => view.draft.workspaceId === requested
    )
    setHomeDraft((value) =>
      retained
        ? { key: retained.key, workspaceId: requested, draft: retained.draft }
        : {
            key: nextHomeViewKey(value, retainedHomeViewsRef.current),
            workspaceId: requested,
          }
    )
  }
  function retryCleanup(id: string) {
    const submission = homeSubmissionsRef.current[id]
    const cleanup = homeCleanupErrors[id]
    if (!submission || !cleanup) return
    if (cleanup.accepted) {
      const workspace = workspaces.items.find(
        (item) => item.id === submission.draft.workspaceId
      )
      const cwd = submission.cwd ?? workspace?.path
      if (
        cwd &&
        acceptHomeSubmission(submission, cwd, homeNavigation.capture())
      )
        selectConversation(id)
    } else if (
      persistedHomeRestorations.current.has(submission.clientRequestId ?? id)
    ) {
      acknowledgeHomeRestoration(id, submission.clientRequestId)
    } else
      rejectHomeSubmission(
        submission,
        new Error("原消息未被接受，输入已恢复。")
      )
  }
  function checkRetained(id: string) {
    void checkHomeSubmission(id, false).catch((error: unknown) => {
      setHomeReconcileErrors((previous) => ({
        ...previous,
        [id]: feedbackFromError(error).message,
      }))
    })
  }

  return {
    homeDraft,
    homeSubmissions,
    homeRestorations,
    homeCleanupErrors,
    homeReconcileErrors,
    visibleHomeSubmission,
    homeViews,
    homeNavigation,
    notice,
    clearNotice: () => setNotice(""),
    saveHomeDraft,
    saveHomeSelectionActivity,
    acknowledgeHomeRestoration,
    prepareHomeSubmission,
    submitHome,
    checkHomeSubmission,
    openHome,
    retryCleanup,
    checkRetained,
    changeFollowingDraft: (draft: ComposerDraft) => {
      if (draft.sessionId && homeSubmissionsRef.current[draft.sessionId])
        homeSubmissionEditing.current.set(draft.sessionId, draft)
    },
    submissionEcho: (id: string) => {
      const submission = homeSubmissions[id]
      return submission &&
        !["accepted", "rejected"].includes(submission.stage ?? "")
        ? {
            id: submission.clientRequestId ?? id,
            kind: "send" as const,
            stage:
              submission.stage === "sending"
                ? ("sending" as const)
                : ("prepared" as const),
            draft: submission.draft,
          }
        : undefined
    },
  }
}
