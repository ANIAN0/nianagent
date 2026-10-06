import { useCallback, useEffect, useRef, useState } from "react"
import type { HomeComposerProps } from "./home-composer"
import type { HomeDraft, HomeSubmitReceipt } from "./home-types"
import { useHomeSubmissionNavigation } from "./use-home-submission-navigation"
import { feedbackFromError } from "@/lib/operation-issue"
import { RpcRequestRejected } from "@/features/models/model-service"
import type { useLiveConversation } from "@/features/conversation/use-live-conversation"
import type { ModelConnection } from "@/features/models/model-types"
import type { ConversationSnapshot } from "@/features/models/model-contract.generated"
import type { useWorkspaces } from "@/features/workspaces/use-workspaces"
import type { SessionService } from "@/features/session/session-service"
import { consumeHomeSession } from "@/features/session/session-service"
import {
  acceptHomeDraftCache,
  createHomeSubmission,
  finishHomeSubmission,
  homeDraftSignature,
  matchesHomeSubmission,
  removeHomeSubmission,
  restoreHomeDraft,
  restoreHomeSubmissions,
  prepareHomeSubmission as persistHomeSubmission,
  recoverRejectedHomeSubmission,
  recordHomeTransfer,
  saveHomeSubmission,
  type HomeSubmission,
  type HomeDraftCache,
} from "@/features/conversation/conversation-draft-store"
import { sameHomeSubmissionAttempt } from "@/features/home/home-receipt-check"
import {
  followingHomeDraft,
  homeDraftRecoveryKey,
  withHomeDraftRecovery,
} from "@/features/home/home-submission-draft"
import {
  changeOwnedHomeCache,
  hasPreparingHomeMaterials,
  homePreflightError,
  nextHomeViewKey,
  retainPreparingHomeView,
  type RetainedHomeViews,
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
  const [notice, setNotice] = useState("")
  const [homeDraft, setHomeDraft] = useState<HomeDraftCache>({ key: 0 })
  const homeNavigation = useHomeSubmissionNavigation(homeDraft.key)
  const [homeSubmissions, setHomeSubmissions] = useState(restoreHomeSubmissions)
  const homeSubmissionsRef = useRef(homeSubmissions)
  const homeSubmissionEditing = useRef(new Map<string, HomeDraft>())
  const [retainedHomeViews, setRetainedHomeViews] = useState<RetainedHomeViews>(
    {}
  )
  const [homeRestorations, setHomeRestorations] = useState<
    Record<string, NonNullable<HomeComposerProps["restoredSubmission"]>>
  >({})
  const homeRestorationsRef = useRef(homeRestorations)
  const persistedHomeRestorations = useRef(new Set<string>())
  const retainedHomeViewsRef = useRef<RetainedHomeViews>({})
  const waitingHomeMaterials = useRef(
    new Map<string, { cwd: string; ownsPage: () => boolean }>()
  )
  const homeSelectionActivities = useRef(new Map<string, number>())
  const resumeHomeHandoff = useRef<(id: string) => void>(() => {})
  const acceptLiveHomeReceipt = useRef<
    (snapshot: ConversationSnapshot) => void
  >(() => {})
  const [homeCleanupErrors, setHomeCleanupErrors] = useState<
    Record<
      string,
      { message: string; accepted: boolean; waitingMaterials?: boolean }
    >
  >(() =>
    Object.fromEntries(
      Object.values(homeSubmissions)
        .filter(
          (submission) =>
            !!submission.transfer ||
            ["prepared", "rejected", "accepted"].includes(
              submission.stage ?? ""
            )
        )
        .map((submission) => [
          submission.sessionId,
          {
            accepted: !!submission.transfer || submission.stage === "accepted",
            message:
              submission.transfer || submission.stage === "accepted"
                ? "原提交结果已确认，下一条草稿保留。请完成本地交接后继续。"
                : "消息尚未接受，原副本与输入保留。请完成本地草稿恢复后继续。",
          },
        ])
    )
  )
  const [homeReconcileErrors, setHomeReconcileErrors] = useState<
    Record<string, string>
  >({})
  const saveHomeDraft = useCallback((draft: HomeDraft, viewKey: number) => {
    const restoration = draft.sessionId
      ? homeRestorationsRef.current[draft.sessionId]
      : undefined
    const awaitingRecovery = !!restoration
    if (
      draft.sessionId &&
      (homeSubmissionsRef.current[draft.sessionId] ||
        retainedHomeViewsRef.current[viewKey])
    )
      homeSubmissionEditing.current.set(draft.sessionId, draft)
    const retained = retainPreparingHomeView(
      retainedHomeViewsRef.current,
      draft,
      viewKey,
      !!draft.sessionId && !!homeSubmissionsRef.current[draft.sessionId],
      !!draft.sessionId && homeSelectionActivities.current.has(draft.sessionId),
      awaitingRecovery
    )
    if (retained !== retainedHomeViewsRef.current) {
      retainedHomeViewsRef.current = retained
      setRetainedHomeViews(retained)
    }
    if (
      draft.sessionId &&
      !homeSubmissionsRef.current[draft.sessionId] &&
      !awaitingRecovery &&
      !retained[viewKey] &&
      !homeSelectionActivities.current.has(draft.sessionId)
    )
      homeSubmissionEditing.current.delete(draft.sessionId)
    setHomeDraft((previous) => {
      const changed = changeOwnedHomeCache(previous, draft, viewKey)
      if (changed === previous) return previous
      return {
        ...changed,
        issue:
          previous.draft &&
          homeDraftSignature(previous.draft) !== homeDraftSignature(draft)
            ? undefined
            : previous.issue,
      }
    })
    if (
      draft.sessionId &&
      waitingHomeMaterials.current.has(draft.sessionId) &&
      !hasPreparingHomeMaterials(draft)
    ) {
      const id = draft.sessionId
      // updateDraft writes its source immediately after this callback. Continue
      // after that write, and verify the same original ID again in the handler.
      queueMicrotask(() => resumeHomeHandoff.current(id))
    }
  }, [])
  const saveHomeSelectionActivity = useCallback(
    (id: string, active: boolean, viewKey: number) => {
      if (active) homeSelectionActivities.current.set(id, viewKey)
      else if (homeSelectionActivities.current.get(id) === viewKey)
        homeSelectionActivities.current.delete(id)
      const draft = homeSubmissionEditing.current.get(id)
      if (!draft) return
      const retained = retainPreparingHomeView(
        retainedHomeViewsRef.current,
        draft,
        viewKey,
        !!homeSubmissionsRef.current[id],
        active,
        !!homeRestorationsRef.current[id]
      )
      if (retained !== retainedHomeViewsRef.current) {
        retainedHomeViewsRef.current = retained
        setRetainedHomeViews(retained)
      }
      if (
        !active &&
        waitingHomeMaterials.current.has(id) &&
        !hasPreparingHomeMaterials(draft)
      )
        queueMicrotask(() => resumeHomeHandoff.current(id))
      if (!active && !homeSubmissionsRef.current[id] && !retained[viewKey])
        homeSubmissionEditing.current.delete(id)
    },
    []
  )
  function forgetHomeSubmission(
    id: string,
    remove = true,
    preserveOwner = false
  ) {
    if (remove) removeHomeSubmission(id)
    if (!preserveOwner) homeSubmissionEditing.current.delete(id)
    waitingHomeMaterials.current.delete(id)
    if (!preserveOwner) homeSelectionActivities.current.delete(id)
    const next = { ...homeSubmissionsRef.current }
    delete next[id]
    homeSubmissionsRef.current = next
    setHomeSubmissions(next)
    setHomeCleanupErrors((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }
  function acknowledgeHomeRestoration(id: string, clientRequestId?: string) {
    const restore = homeRestorationsRef.current[id]
    if (!restore || restore.submission.clientRequestId !== clientRequestId)
      return
    const current = homeSubmissionsRef.current[id]
    if (current && !sameHomeSubmissionAttempt(current, restore.submission))
      return
    const editing = homeSubmissionEditing.current.get(id)
    if (editing?.homeRecoveryKey !== homeDraftRecoveryKey(restore.submission))
      return
    // Home calls this only after its latest merged draft was written to storage.
    persistedHomeRestorations.current.add(clientRequestId ?? id)
    try {
      forgetHomeSubmission(
        id,
        true,
        homeSelectionActivities.current.has(id) ||
          hasPreparingHomeMaterials(editing)
      )
    } catch {
      setHomeCleanupErrors((previous) => ({
        ...previous,
        [id]: {
          accepted: false,
          message:
            "原输入已恢复保存，提交副本暂未清理。请重试清理，消息不会重新发送。",
        },
      }))
      return
    }
    persistedHomeRestorations.current.delete(clientRequestId ?? id)
    const next = { ...homeRestorationsRef.current }
    delete next[id]
    homeRestorationsRef.current = next
    setHomeRestorations(next)
    let retained = retainedHomeViewsRef.current
    for (const view of Object.values(retained)) {
      if (view.draft.sessionId === id)
        retained = retainPreparingHomeView(
          retained,
          editing,
          view.key,
          false,
          homeSelectionActivities.current.has(id),
          false
        )
    }
    if (retained !== retainedHomeViewsRef.current) {
      retainedHomeViewsRef.current = retained
      setRetainedHomeViews(retained)
    }
  }
  function prepareHomeSubmission(
    submission: HomeSubmission,
    following: HomeDraft
  ) {
    try {
      persistHomeSubmission(submission, following)
    } catch (error) {
      const retained = restoreHomeSubmissions()[submission.sessionId]
      if (retained) {
        homeSubmissionEditing.current.set(
          submission.sessionId,
          submission.originalDraft ?? submission.draft
        )
        homeSubmissionsRef.current = {
          ...homeSubmissionsRef.current,
          [submission.sessionId]: retained,
        }
        setHomeSubmissions(homeSubmissionsRef.current)
        setHomeCleanupErrors((previous) => ({
          ...previous,
          [submission.sessionId]: {
            accepted: false,
            message: "消息尚未发送，草稿保存未完成。原输入仍保留，请重试恢复。",
          },
        }))
      }
      throw error
    }
    homeSubmissionsRef.current = {
      ...homeSubmissionsRef.current,
      [submission.sessionId]: submission,
    }
    homeSubmissionEditing.current.set(submission.sessionId, following)
    setHomeSubmissions(homeSubmissionsRef.current)
  }
  function rejectHomeSubmission(submission: HomeSubmission, error: unknown) {
    const refused = { ...submission, stage: "rejected" as const }
    homeSubmissionsRef.current = {
      ...homeSubmissionsRef.current,
      [submission.sessionId]: refused,
    }
    setHomeSubmissions(homeSubmissionsRef.current)
    try {
      saveHomeSubmission(refused)
      const recovery = recoverRejectedHomeSubmission(
        submission,
        currentHomeEditing(submission)
      )
      const preserveOwner =
        homeSelectionActivities.current.has(submission.sessionId) ||
        hasPreparingHomeMaterials(recovery.draft)
      if (preserveOwner)
        homeSubmissionEditing.current.set(submission.sessionId, recovery.draft)
      chat.settleHomeReceipt(submission.sessionId, submission.clientRequestId)
      const issue = feedbackFromError(error, "消息未被接受，原输入已恢复。")
      if (recovery.merged)
        issue.message += " 原输入和等待期间的新文字、材料已合并保留。"
      if (preserveOwner) {
        const next = {
          ...homeRestorationsRef.current,
          [submission.sessionId]: { submission, feedback: issue },
        }
        homeRestorationsRef.current = next
        setHomeRestorations(next)
      }
      // Keep a live material owner until it acknowledges the recovered draft.
      // Recovery is durable before removing the only immutable copy.
      if (!preserveOwner) forgetHomeSubmission(submission.sessionId)
      else
        setHomeCleanupErrors((previous) => ({
          ...previous,
          [submission.sessionId]: {
            accepted: false,
            message: "原消息未接受，正在恢复输入与仍在处理的材料。",
          },
        }))
      setHomeDraft((previous) =>
        previous.draft?.sessionId === submission.sessionId
          ? {
              ...previous,
              key: preserveOwner
                ? previous.key
                : nextHomeViewKey(previous, retainedHomeViewsRef.current),
              draft: recovery.draft,
              issue,
            }
          : previous
      )
      return withHomeDraftRecovery(error, recovery)
    } catch {
      setHomeCleanupErrors((previous) => ({
        ...previous,
        [submission.sessionId]: {
          accepted: false,
          message:
            "原消息未接受，但草稿恢复尚未完成。原副本与新输入均已保留，请重试恢复。",
        },
      }))
      return Object.assign(
        new Error("消息未被接受，草稿恢复尚未完成，请重试恢复。"),
        {
          issue: {
            code: "home_recovery_pending",
            summary: "消息未被接受，草稿恢复尚未完成；原副本与新输入保留。",
            recovery: "retry",
            severity: "warning",
          },
        }
      )
    }
  }
  function retainedHomeSubmissionError(error: unknown, summary: string) {
    return Object.assign(new Error(summary), {
      issue: {
        code: "result_unknown",
        summary,
        details: feedbackFromError(error).message,
        recovery: "check",
        severity: "warning",
      },
    })
  }
  function currentHomeEditing(submission: HomeSubmission) {
    // Another Home view may now own the active editor. Pending original IDs keep
    // their unsaved next draft until recovery or durable handoff succeeds.
    const editing = homeSubmissionEditing.current.get(submission.sessionId)
    return editing?.sessionId === submission.sessionId &&
      editing.workspaceId === submission.draft.workspaceId
      ? editing
      : undefined
  }
  function acceptHomeSubmission(
    submission: HomeSubmission,
    cwd: string,
    ownsPage: () => boolean = () => false
  ) {
    try {
      const acceptedSubmission = {
        ...submission,
        stage: "accepted" as const,
        cwd,
      }
      homeSubmissionsRef.current = {
        ...homeSubmissionsRef.current,
        [submission.sessionId]: acceptedSubmission,
      }
      setHomeSubmissions(homeSubmissionsRef.current)
      saveHomeSubmission(acceptedSubmission)
      if (
        homeSelectionActivities.current.has(submission.sessionId) ||
        hasPreparingHomeMaterials(currentHomeEditing(submission))
      ) {
        if (!waitingHomeMaterials.current.has(submission.sessionId))
          waitingHomeMaterials.current.set(submission.sessionId, {
            cwd,
            ownsPage,
          })
        setHomeCleanupErrors((previous) => ({
          ...previous,
          [submission.sessionId]: {
            accepted: true,
            waitingMaterials: true,
            message:
              "原输入已处理，正在完成下一条草稿已开始的材料准备。完成后会自动带入本会话。",
          },
        }))
        return false
      }
      const handoff = recordHomeTransfer(
        acceptedSubmission,
        currentHomeEditing(submission)
      )
      homeSubmissionsRef.current = {
        ...homeSubmissionsRef.current,
        [submission.sessionId]: handoff,
      }
      setHomeSubmissions(homeSubmissionsRef.current)
      chat.adoptHomeDraft(handoff, handoff.transfer!.draft)
      chat.settleHomeReceipt(submission.sessionId, submission.clientRequestId)
      finishHomeSubmission(
        handoff,
        () => consumeHomeSession(cwd, true, submission.sessionId),
        true
      )
      forgetHomeSubmission(submission.sessionId, false)
      setHomeDraft((previous) => {
        const accepted = acceptHomeDraftCache(previous, handoff, true)
        return accepted === previous
          ? previous
          : {
              ...accepted,
              key: nextHomeViewKey(previous, retainedHomeViewsRef.current),
            }
      })
      return true
    } catch {
      setHomeCleanupErrors((previous) => ({
        ...previous,
        [submission.sessionId]: {
          accepted: true,
          message:
            "原提交结果已确认，但下一条草稿尚未完整保存到会话。原副本与新稿保留；暂缓编辑，请重试完成交接。",
        },
      }))
      return false
    }
  }
  useEffect(() => {
    acceptLiveHomeReceipt.current = (snapshot) => {
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
    }
    resumeHomeHandoff.current = (id) => {
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
    }
  })
  useEffect(
    () =>
      chat.subscribeInputReceipts((snapshot) =>
        acceptLiveHomeReceipt.current(snapshot)
      ),
    [chat.subscribeInputReceipts]
  )
  async function submitHome(
    draft: HomeDraft,
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
      homeSubmissionsRef.current = {
        ...homeSubmissionsRef.current,
        [id]: sending,
      }
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
      homeSubmissionsRef.current = {
        ...homeSubmissionsRef.current,
        [id]: submission,
      }
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
        homeSubmissionsRef.current = {
          ...homeSubmissionsRef.current,
          [id]: submission,
        }
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
  const homeViews: { key: number; draft?: HomeDraft; workspaceId?: string }[] =
    Object.values(retainedHomeViews).filter(
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
    changeFollowingDraft: (draft: HomeDraft) => {
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
