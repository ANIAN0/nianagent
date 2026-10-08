import { useHomeDraftOwner } from "./use-home-draft-owner"

import "./home.css"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { insertComposerText } from "@/features/materials/composer-material-edit"

import type { ComposerDraft, HomeSubmitReceipt } from "@/lib/composer/types"
import type { HomeSubmission } from "@/features/conversation/conversation-draft-store"
import { createHomeSubmission } from "@/features/conversation/conversation-draft-store"

import { useMaterialPreparation } from "@/features/materials/use-material-preparation"
import { composerDraftEligibility } from "@/components/composer/composer-policy"

import {
  observeHomeReceipt,
  sameHomeSubmissionAttempt,
} from "./home-receipt-check"
import {
  followingHomeDraft,
  recoverRejectedHomeDraft,
  homeDraftRecoveryFromError,
} from "./home-submission-draft"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import type { HomeComposerProps } from "./home-composer.types"

/** 页面状态与异步所有权在此维护，视图只组合正式组件。 */
export function useHomeComposer({
  inactive = false,
  onMaterialSelectionActivity,
  draftStore,
  unconfirmedSessionIds = [],
  acceptedSubmissionIds = [],
  recoverySubmissionIds = [],
  pendingSubmission,
  restoredSubmission,
  onRestorationPersisted,
  submissionIssue,
  onSubmissionPrepare,
  onCheckSubmission,
  data,
  initialDraft = {},
  onSubmit,
  onDraftChange,
}: HomeComposerProps) {
  const {
    rawDraft,
    sessionId,
    workspacePath,
    anchorRef,
    anchorNode,
    bindAnchor,
    draft,
    updateDraft,
    latestDraft,
    mounted,
    inputRef,
    inactiveRef,
    sessionService,
    sessionSeed,
    saveError,
    workspaces,
    models,
    materials,
    tools,
    setWorkspaces,
    setSaveError,
    acknowledgeRestoration,
  } = useHomeDraftOwner({
    data,
    inactive,
    initialDraft,
    draftStore,
    pendingSubmission,
    restoredSubmission,
    onRestorationPersisted,
    onDraftChange,
  })

  useEffect(() => {
    if (!rawDraft.workspaceId) return
    onDraftChange?.({ ...rawDraft, sessionId })
  }, [rawDraft, sessionId, onDraftChange])
  const [result, setResult] = useState("")
  const [submitFeedback, setSubmitFeedback] = useState<{
    sessionId: string
    feedback: FeedbackDescription
  }>()
  const [submitting, setSubmitting] = useState(false)
  const [localSubmission, setLocalSubmission] = useState<HomeSubmission>()
  const [checking, setChecking] = useState(false)
  const [autoChecking, setAutoChecking] = useState(false)
  const automaticAttempts = useRef(new Set<string>())
  const automaticObserver = useRef<AbortController | null>(null)
  const receiptReader = useRef(onCheckSubmission)
  useLayoutEffect(() => {
    receiptReader.current = onCheckSubmission
  }, [onCheckSubmission])
  const acceptedSubmission = acceptedSubmissionIds.includes(sessionId)
  const recoveringSubmission = recoverySubmissionIds.includes(sessionId)
  const reportSelectionActivity = useCallback(
    (active: boolean) => onMaterialSelectionActivity?.(sessionId, active),
    [sessionId, onMaterialSelectionActivity]
  )
  const materialController = useMaterialPreparation({
    sessionId,
    cwd: workspacePath,
    materials: draft.materials,
    disabled: data.materialsEnabled === false || acceptedSubmission || inactive,
    onSelectionActivity: reportSelectionActivity,
    onPasteText: (text, start, end) =>
      updateDraft((current) => ({
        ...current,
        text: insertComposerText(current.text, text, start, end),
      })),
    update: (apply) =>
      updateDraft((current) => ({
        ...current,
        materials: apply(current.materials),
      })),
  })
  const submitRequest = useRef<AbortController | null>(null)
  const configRequest = useRef<AbortController | null>(null)
  const [readySession, setReadySession] = useState("")
  const [configRevision, setConfigRevision] = useState(0)
  const configKey = `${sessionId}:${workspacePath}:${configRevision}`
  const [configFeedback, setConfigFeedback] = useState<{
    key: string
    feedback: FeedbackDescription
  }>()
  const configFailure =
    configFeedback?.key === configKey ? configFeedback.feedback : undefined
  const pendingCopy =
    localSubmission?.sessionId === sessionId
      ? localSubmission
      : pendingSubmission?.sessionId === sessionId
        ? pendingSubmission
        : undefined
  const submissionFailure =
    submitFeedback?.sessionId === sessionId
      ? submitFeedback.feedback
      : submissionIssue
  const unknownSubmission =
    !acceptedSubmission &&
    !recoveringSubmission &&
    (!!pendingCopy ||
      unconfirmedSessionIds.includes(sessionId) ||
      submissionFailure?.code === "result_unknown" ||
      submissionFailure?.recovery === "check")
  const copyRef = useRef(pendingCopy)
  useLayoutEffect(() => {
    copyRef.current = pendingCopy
  }, [pendingCopy])
  const applyHomeRecovery = useCallback(
    (submission: HomeSubmission) => {
      const current = latestDraft.current
      const original = submission.originalDraft ?? submission.draft
      const currentCopy = copyRef.current
      if (
        !mounted.current ||
        current.sessionId !== submission.sessionId ||
        current.workspaceId !== original.workspaceId ||
        submission.draft.workspaceId !== original.workspaceId ||
        (currentCopy && !sameHomeSubmissionAttempt(currentCopy, submission))
      )
        return
      // Error metadata may predate more typing. Merge the immutable original
      // with the live owner now, never with a previously merged recovery draft.
      const recovery = recoverRejectedHomeDraft(submission, current)
      const input = inputRef.current
      if (
        !inactiveRef.current &&
        input?.isConnected &&
        input.isContentEditable &&
        document.activeElement === input &&
        input.value === current.text &&
        recovery.draft.text !== current.text
      ) {
        if (!current.text.trim())
          input.setSelectionAfterChange(
            recovery.draft.text,
            recovery.draft.text.length,
            recovery.draft.text.length,
            { requireFocus: true }
          )
        else if (recovery.draft.text.endsWith(current.text)) {
          const prefix = recovery.draft.text.length - current.text.length
          input.setSelectionAfterChange(
            recovery.draft.text,
            input.selectionStart + prefix,
            input.selectionEnd + prefix,
            { requireFocus: true }
          )
        }
      }
      updateDraft(() => recovery.draft)
      return recovery
    },
    [updateDraft, inactiveRef, inputRef, latestDraft, mounted]
  )
  // A page-level recovery must reach the same live material owner. Changing
  // initialDraft cannot update that editor, and remounting would cancel Files.
  const appliedRestorations = useRef(new Set<string>())
  useEffect(() => {
    if (!restoredSubmission) return
    const { submission, feedback } = restoredSubmission
    const identity = submission.clientRequestId ?? submission.sessionId
    if (appliedRestorations.current.has(identity)) return
    let alive = true
    queueMicrotask(() => {
      if (!alive || latestDraft.current.sessionId !== submission.sessionId)
        return
      const currentCopy = copyRef.current
      if (currentCopy && !sameHomeSubmissionAttempt(currentCopy, submission))
        return
      // Merge with the owner's latest edits, including material completions
      // that happened after the page-level durable recovery.
      const recovery = applyHomeRecovery(submission)
      if (!recovery) return
      appliedRestorations.current.add(identity)
      setLocalSubmission(undefined)
      setSubmitFeedback({ sessionId: submission.sessionId, feedback })
    })
    return () => {
      alive = false
    }
  }, [restoredSubmission, applyHomeRecovery, latestDraft])
  const automaticKey =
    localSubmission?.clientRequestId ?? localSubmission?.sessionId
  const automaticReady =
    !!onCheckSubmission &&
    !!automaticKey &&
    unknownSubmission &&
    !submitting &&
    !checking &&
    !inactive &&
    !acceptedSubmission &&
    !recoveringSubmission &&
    submitFeedback?.feedback.code === "result_unknown"
  useEffect(() => {
    if (
      !automaticReady ||
      !automaticKey ||
      automaticAttempts.current.has(automaticKey)
    )
      return
    const copy = copyRef.current
    if (!copy) return
    const controller = new AbortController()
    automaticObserver.current = controller
    let alive = true
    queueMicrotask(async () => {
      if (!alive) return
      automaticAttempts.current.add(automaticKey)
      setAutoChecking(true)
      let terminalError: unknown
      const observedReceipt: { current?: HomeSubmitReceipt } = {}
      try {
        await observeHomeReceipt(
          async () => {
            try {
              if (!receiptReader.current)
                throw new DOMException("核对入口已关闭", "AbortError")
              const receipt = await receiptReader.current(
                copy.sessionId,
                controller.signal
              )
              observedReceipt.current = receipt ?? undefined
            } catch (error) {
              const recovery = homeDraftRecoveryFromError(error)
              const feedback = feedbackFromError(error)
              if (
                recovery ||
                ["restart", "settings", "none"].includes(
                  feedback.recovery ?? ""
                )
              ) {
                terminalError = error
                return
              }
              throw error
            }
          },
          () => sameHomeSubmissionAttempt(copyRef.current, copy),
          controller.signal
        )
        if (terminalError) throw terminalError
        if (alive && !controller.signal.aborted) {
          setLocalSubmission(undefined)
          setSubmitFeedback(undefined)
          if (!observedReceipt.current)
            updateDraft((current) =>
              current.sessionId === copy.sessionId
                ? { ...current, sessionId: undefined }
                : current
            )
        }
      } catch (error) {
        if (alive && !controller.signal.aborted) {
          if (homeDraftRecoveryFromError(error)) {
            const recovery = applyHomeRecovery(copy)
            if (!recovery) return
            setLocalSubmission(undefined)
          }
          setSubmitFeedback({
            sessionId: copy.sessionId,
            feedback: feedbackFromError(
              error,
              "发送状态暂时无法读取，原副本与下一条输入均已保留。"
            ),
          })
        }
      } finally {
        if (automaticObserver.current === controller) {
          automaticObserver.current = null
          if (mounted.current) setAutoChecking(false)
        }
      }
    })
    return () => {
      alive = false
      controller.abort()
      if (automaticObserver.current === controller) {
        automaticObserver.current = null
        setAutoChecking(false)
      }
    }
  }, [automaticReady, automaticKey, updateDraft, applyHomeRecovery, mounted])
  const unsupportedCompact = /^\/compact(?:\s|$)/.test(draft.text.trim())
  const configLoading =
    !!sessionService &&
    !!workspacePath &&
    readySession !== configKey &&
    !configFailure
  useEffect(() => {
    const controller = new AbortController()
    configRequest.current = controller
    if (sessionService && workspacePath) {
      Promise.all([
        sessionService.catalog(workspacePath, controller.signal),
        sessionService.read(sessionId, controller.signal),
      ])
        .then(([catalog, saved]) => {
          if (controller.signal.aborted) return
          const options =
            saved ??
            (sessionSeed.current.workspaceId === rawDraft.workspaceId
              ? sessionSeed.current.session
              : undefined) ??
            catalog.defaults
          updateDraft((draft) => ({
            ...draft,
            session: {
              toolIds: [...options.toolIds],
              instructionScope: options.instructionScope,
            },
          }))
          setReadySession(configKey)
          setConfigFeedback(undefined)
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            const feedback = feedbackFromError(
              error,
              "会话配置未能读取，当前草稿已保留。"
            )
            setConfigFeedback({
              key: configKey,
              feedback:
                feedback.code === "cancelled"
                  ? {
                      ...feedback,
                      message: "配置读取已取消，重新读取后才能开始会话。",
                      recovery: "reload",
                    }
                  : feedback,
            })
          }
        })
    }
    return () => {
      controller.abort()
      submitRequest.current?.abort()
    }
  }, [
    sessionService,
    sessionId,
    workspacePath,
    rawDraft.workspaceId,
    updateDraft,
    configKey,
    sessionSeed,
  ])
  const eligibility = composerDraftEligibility(
    draft,
    data,
    materialController.ready,
    materialController.choosing
  )
  const canSubmit =
    !inactive &&
    !submitting &&
    !pendingCopy &&
    !saveError &&
    !acceptedSubmission &&
    !unknownSubmission &&
    !materialController.choosing &&
    (!sessionService || readySession === configKey) &&
    !unsupportedCompact &&
    eligibility.canSend &&
    !!workspacePath &&
    workspaces.some(
      (item) => item.id === draft.workspaceId && item.available !== false
    ) &&
    models.includes(draft.model)
  function change(patch: Partial<ComposerDraft>) {
    if (inactive || acceptedSubmission) return
    // Keep an outstanding Home request and its material operations on one cwd.
    // Switching pages is owned by App and creates/reuses a separate view owner.
    if (
      patch.workspaceId !== undefined &&
      (submitting || pendingCopy || unknownSubmission)
    )
      return
    if (
      patch.workspaceId !== undefined &&
      patch.workspaceId !== rawDraft.workspaceId
    ) {
      setReadySession("")
      configRequest.current?.abort()
      submitRequest.current?.abort()
    }
    updateDraft((current) =>
      patch.workspaceId !== undefined &&
      patch.workspaceId !== current.workspaceId
        ? {
            ...current,
            text: "",
            materials: [],
            sessionId: undefined,
            ...draftStore?.read(patch.workspaceId),
            ...patch,
          }
        : { ...current, ...patch }
    )
    setResult("")
    if (submissionFailure && !unknownSubmission) setSubmitFeedback(undefined)
    if (patch.session) {
      configRequest.current?.abort()
      setReadySession(configKey)
      setConfigFeedback(undefined)
    }
  }
  async function submit() {
    if (!canSubmit || submitRequest.current) return
    const original = structuredClone(latestDraft.current)
    const submitted = structuredClone({
      ...draft,
      sessionId,
      text: draft.text.trim(),
      modelLabel:
        data.modelLabels?.[draft.model] ?? draft.modelLabel ?? draft.model,
    })
    const copy: HomeSubmission = {
      ...createHomeSubmission(submitted, original),
      cwd: workspacePath,
      followingDraft: true,
    }
    const following = followingHomeDraft(submitted)
    const controller = new AbortController()
    submitRequest.current = controller
    setSubmitting(true)
    setSubmitFeedback(undefined)
    let prepared = false
    try {
      if (onSubmissionPrepare) onSubmissionPrepare(copy, following)
      else {
        draftStore?.write(submitted)
        draftStore?.write(following)
      }
      // Only the immutable copy crosses the submission boundary. This editor
      // now owns the next input; its text and materials do not mutate that copy.
      updateDraft(() => following, false)
      setLocalSubmission(copy)
      prepared = true
      const active = document.activeElement
      requestAnimationFrame(() => {
        if (
          mounted.current &&
          !inactiveRef.current &&
          (document.activeElement === active ||
            document.activeElement === document.body)
        )
          inputRef.current?.focus({ preventScroll: true })
      })
      const receipt = await onSubmit(submitted, controller.signal, original)
      if (!controller.signal.aborted && mounted.current) {
        setLocalSubmission(undefined)
        setResult(
          typeof receipt === "string" ? receipt : (receipt.message ?? "")
        )
        // The App has already handed this editor to the accepted conversation.
        // A late Home callback must not write the accepted ID back into Home.
        if (typeof receipt === "string")
          updateDraft((current) =>
            current.sessionId === copy.sessionId
              ? { ...current, sessionId: undefined }
              : current
          )
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) {
        let feedback = feedbackFromError(
          error,
          "消息未能开始，当前草稿已保留。"
        )
        const unknown =
          feedback.code === "result_unknown" || feedback.recovery === "check"
        if (prepared && !unknown) {
          const recovery = applyHomeRecovery(copy)
          if (!recovery) return
          setLocalSubmission(undefined)
          if (recovery.merged)
            feedback = {
              ...feedback,
              message: `${feedback.message} 原输入和等待期间的新文字、材料已合并保留。`,
            }
        }
        if (feedback.code !== "cancelled")
          setSubmitFeedback({ sessionId: submitted.sessionId!, feedback })
      }
    } finally {
      if (submitRequest.current === controller) {
        submitRequest.current = null
        if (mounted.current) setSubmitting(false)
      }
    }
  }
  async function checkSubmission() {
    if (!onCheckSubmission || submitting || autoChecking) return
    const previous = structuredClone(latestDraft.current)
    const originalCopy = pendingCopy ?? copyRef.current
    const originalId = originalCopy?.sessionId ?? sessionId
    setSubmitting(true)
    setChecking(true)
    try {
      const receipt = await onCheckSubmission(originalId)
      if (mounted.current) {
        setResult("")
        setSubmitFeedback(undefined)
        setLocalSubmission(undefined)
        if (!receipt)
          updateDraft((current) =>
            current.sessionId === originalId
              ? { ...current, sessionId: undefined }
              : current
          )
      }
    } catch (error) {
      if (
        mounted.current &&
        latestDraft.current.sessionId === previous.sessionId
      ) {
        let feedback = feedbackFromError(
          error,
          "发送结果未能核对，请保留草稿后再检查。"
        )
        if (homeDraftRecoveryFromError(error)) {
          if (originalCopy) {
            const recovery = applyHomeRecovery(originalCopy)
            if (!recovery) return
            setLocalSubmission(undefined)
            if (recovery.merged)
              feedback = {
                ...feedback,
                message: `${feedback.message} 原输入和等待期间的新文字、材料已合并保留。`,
              }
          } else
            feedback = {
              ...feedback,
              message:
                "当前窗口缺少可核对的原提交副本，不能安全合并恢复。当前输入保留，请继续核对原提交。",
              recovery: "check",
            }
        }
        if (feedback.code !== "cancelled")
          setSubmitFeedback({ sessionId: previous.sessionId!, feedback })
      }
    } finally {
      if (mounted.current) {
        setSubmitting(false)
        setChecking(false)
      }
    }
  }
  return {
    models,
    materials,
    tools,
    acceptedSubmission,
    workspaces,
    draft,
    submitting,
    pendingCopy,
    unknownSubmission,
    setWorkspaces,
    change,
    submit,
    checking,
    autoChecking,
    recoveringSubmission,
    sessionId,
    workspacePath,
    submissionFailure,
    checkSubmission,
    anchorRef,
    anchorNode,
    bindAnchor,
    materialController,
    inputRef,
    configLoading,
    canSubmit,
    unsupportedCompact,
    eligibility,
    setResult,
    configFailure,
    saveError,
    setConfigRevision,
    latestDraft,
    setSaveError,
    acknowledgeRestoration,
    result,
  }
}
