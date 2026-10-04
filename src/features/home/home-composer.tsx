import {
  homeSessionId,
  SessionServiceContext,
} from "@/features/session/session-service"
import { effectiveThinking } from "./model-thinking"
import "./home.css"
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ComposerInputCard } from "@/components/composer/composer-input-card"
import {
  insertComposerText,
  removeComposerMaterial,
} from "@/features/materials/composer-material-edit"
import { Field, FieldGroup } from "@/components/ui/field"
import { WorkspacePicker } from "./workspace-picker"
import { PromptInput } from "./prompt-input"
import { ComposerToolbar } from "./composer-toolbar"
import { SelectedMaterials } from "./selected-materials"
import type {
  HomeData,
  HomeDraft,
  HomeSubmitReceipt,
  SubmitWork,
  Workspace,
} from "./home-types"
import type {
  HomeDraftStore,
  HomeSubmission,
} from "@/features/conversation/conversation-draft-store"
import {
  bindHomeDraftIdentity,
  createHomeSubmission,
  matchesHomeSubmission,
} from "@/features/conversation/conversation-draft-store"
import { Button } from "@/components/ui/button"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import {
  composerDraftEligibility,
  composerDisplayMaterials,
} from "@/components/composer/composer-policy"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import { ComposerPanelProvider } from "./composer-panel-context"
import { HomeSubmissionEcho } from "./home-submission-echo"
import { HomeSubmissionNotice } from "./home-submission-notice"
import {
  observeHomeReceipt,
  sameHomeSubmissionAttempt,
} from "./home-receipt-check"
import {
  followingHomeDraft,
  recoverRejectedHomeDraft,
  homeDraftRecoveryFromError,
  homeDraftRecoveryKey,
} from "./home-submission-draft"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

export type HomeComposerProps = {
  /** Retained operation owner: finish existing preparations without new interaction or focus. */
  inactive?: boolean
  onMaterialSelectionActivity?: (sessionId: string, active: boolean) => void
  draftStore?: HomeDraftStore
  unconfirmedSessionIds?: string[]
  acceptedSubmissionIds?: string[]
  recoverySubmissionIds?: string[]
  pendingSubmission?: HomeSubmission
  restoredSubmission?: {
    submission: HomeSubmission
    feedback: FeedbackDescription
  }
  onRestorationPersisted?: (sessionId: string, clientRequestId?: string) => void
  submissionIssue?: FeedbackDescription
  submissionFeedback?: ReactNode
  onSubmissionPrepare?: (
    submission: HomeSubmission,
    following: HomeDraft
  ) => void
  onCheckSubmission?: (
    sessionId: string,
    signal?: AbortSignal
  ) => Promise<HomeSubmitReceipt | void>
  data: Pick<
    HomeData,
    | "workspaces"
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelInputs"
    | "modelCatalog"
    | "materials"
    | "materialsEnabled"
    | "tools"
  >
  initialDraft?: Partial<HomeDraft>
  onDraftChange?: (draft: HomeDraft) => void
  onSubmit: SubmitWork
  onWorkspaceAdd?: (workspace: Workspace) => void
  onChooseWorkspace?: (signal: AbortSignal) => Promise<Workspace | null>
  onWorkspaceSelect?: (id: string, signal?: AbortSignal) => Promise<void>
  workspaceLoading?: boolean
  workspaceError?: string
  workspaceIssue?: FeedbackDescription
  onWorkspaceRetry?: (signal?: AbortSignal) => void | Promise<void>
}
export function HomeComposer({
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
  submissionFeedback,
  onSubmissionPrepare,
  onCheckSubmission,
  data,
  initialDraft = {},
  onSubmit,
  onDraftChange,
  onWorkspaceAdd,
  onChooseWorkspace,
  onWorkspaceSelect,
  workspaceLoading,
  workspaceError,
  workspaceIssue,
  onWorkspaceRetry,
}: HomeComposerProps) {
  const sessionService = useContext(SessionServiceContext)
  const { models, materials, tools } = data
  const [addedWorkspaces, setWorkspaces] = useState<typeof data.workspaces>([])
  const workspaces = useMemo(
    () => [
      ...data.workspaces,
      ...addedWorkspaces.filter(
        (item) => !data.workspaces.some((workspace) => workspace.id === item.id)
      ),
    ],
    [data.workspaces, addedWorkspaces]
  )
  const bindDraftIdentity = useCallback(
    (candidate: HomeDraft) =>
      bindHomeDraftIdentity(candidate, () => {
        // Legacy nonempty drafts have no evidence tying them to the old cwd map.
        // Give them a fresh identity; a receipt for an earlier input cannot erase them.
        if (candidate.text.trim() || candidate.materials.length)
          return crypto.randomUUID()
        const cwd = workspaces.find(
          (item) => item.id === candidate.workspaceId
        )?.path
        return sessionService && cwd ? homeSessionId(cwd) : crypto.randomUUID()
      }),
    [sessionService, workspaces]
  )
  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)
  const inactiveRef = useRef(inactive)
  useLayoutEffect(() => {
    inactiveRef.current = inactive
  }, [inactive])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [rawDraft, setDraft] = useState<HomeDraft>(() => {
    const workspaceId =
      workspaces.find((item) => item.id === initialDraft.workspaceId)?.id ??
      workspaces[0]?.id ??
      ""
    const provided = Object.fromEntries(
      Object.entries(initialDraft).filter(([, value]) => value !== undefined)
    )
    const candidate = bindDraftIdentity({
      text: initialDraft.text ?? "",
      model: models.includes(initialDraft.model ?? "")
        ? initialDraft.model!
        : (models[0] ?? ""),
      thinking: initialDraft.thinking ?? "中等",
      materials: initialDraft.materials ?? [],
      session: initialDraft.session ?? {
        toolIds: tools.map((tool) => tool.id),
        instructionScope: "all",
      },
      ...draftStore?.read(workspaceId),
      ...provided,
      workspaceId,
    })
    if (pendingSubmission?.draft.workspaceId !== workspaceId) return candidate
    const owned = { ...candidate, sessionId: pendingSubmission.sessionId }
    return matchesHomeSubmission(owned, pendingSubmission)
      ? followingHomeDraft(owned)
      : owned
  })
  const sessionSeed = useRef({
    workspaceId: rawDraft.workspaceId,
    session:
      rawDraft.text.trim() || rawDraft.materials.length
        ? rawDraft.session
        : undefined,
  })
  // Focus only on a new/restored workspace view. A later config/catalog response
  // must never take focus away from the control the user has chosen meanwhile.
  useLayoutEffect(() => {
    if (inactive) return
    const active = document.activeElement
    const focus = requestAnimationFrame(() => {
      if (
        document.activeElement === active ||
        document.activeElement === document.body
      )
        inputRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(focus)
  }, [rawDraft.workspaceId, inactive])
  const [saveError, setSaveError] = useState("")
  const latestDraft = useRef(rawDraft)
  const restorationRef = useRef(restoredSubmission)
  const restorationAck = useRef(onRestorationPersisted)
  useLayoutEffect(() => {
    restorationRef.current = restoredSubmission
    restorationAck.current = onRestorationPersisted
  }, [restoredSubmission, onRestorationPersisted])
  const acknowledgeRestoration = useCallback((saved: HomeDraft) => {
    const restore = restorationRef.current
    if (
      restore &&
      saved.sessionId === restore.submission.sessionId &&
      saved.homeRecoveryKey === homeDraftRecoveryKey(restore.submission)
    )
      restorationAck.current?.(
        restore.submission.sessionId,
        restore.submission.clientRequestId
      )
  }, [])
  const updateDraft = useCallback(
    (apply: (current: HomeDraft) => HomeDraft, persist = true) => {
      const next = bindDraftIdentity(apply(latestDraft.current))
      latestDraft.current = next
      setDraft(next)
      onDraftChange?.(next)
      if (!next.workspaceId || !persist) return true
      try {
        draftStore?.write(next)
        setSaveError("")
        acknowledgeRestoration(next)
        return true
      } catch {
        setSaveError(
          "当前内容仍保留在窗口中，尚未保存到本机。请释放本地存储空间后重试保存。"
        )
        return false
      }
    },
    [
      draftStore,
      bindDraftIdentity,
      onDraftChange,
      setDraft,
      setSaveError,
      acknowledgeRestoration,
    ]
  )
  const draft = {
    ...rawDraft,
    workspaceId:
      rawDraft.workspaceId ||
      data.workspaces.find((item) => item.id === initialDraft.workspaceId)
        ?.id ||
      data.workspaces[0]?.id ||
      "",
    thinking: effectiveThinking(
      rawDraft.thinking,
      data.modelThinking?.[rawDraft.model]
    ),
  }
  const workspacePath =
    workspaces.find((item) => item.id === draft.workspaceId)?.path ?? ""
  const sessionId = rawDraft.sessionId!
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
  const materialController = useComposerMaterials({
    sessionId,
    cwd: workspacePath,
    anchorRef,
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
      const recovery = recoverRejectedHomeDraft(submission, latestDraft.current)
      appliedRestorations.current.add(identity)
      updateDraft(() => recovery.draft)
      setLocalSubmission(undefined)
      setSubmitFeedback({ sessionId: submission.sessionId, feedback })
    })
    return () => {
      alive = false
    }
  }, [restoredSubmission, updateDraft])
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
          const recovery = homeDraftRecoveryFromError(error)
          if (recovery) {
            updateDraft(() => recovery.draft)
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
  }, [automaticReady, automaticKey, updateDraft])
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
  function change(patch: Partial<HomeDraft>) {
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
          const recovery =
            homeDraftRecoveryFromError(error) ??
            recoverRejectedHomeDraft(copy, latestDraft.current)
          updateDraft(() => recovery.draft)
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
    const originalId = pendingCopy?.sessionId ?? sessionId
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
        const recovery = homeDraftRecoveryFromError(error)
        if (recovery) {
          updateDraft(() => recovery.draft)
          setLocalSubmission(undefined)
          if (recovery.merged)
            feedback = {
              ...feedback,
              message: `${feedback.message} 原输入和等待期间的新文字、材料已合并保留。`,
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

  return (
    <section className="home-launch" aria-label="新建工作">
      <h1 className="mb-3 text-center text-[26px] leading-8 font-medium">
        开始一项工作
      </h1>
      <WorkspacePicker
        key={`workspace:${inactive || acceptedSubmission ? "inactive" : "active"}`}
        workspaces={workspaces}
        value={draft.workspaceId}
        loading={workspaceLoading}
        error={workspaceError}
        issue={workspaceIssue}
        onRetry={onWorkspaceRetry}
        disabled={
          submitting ||
          !!pendingCopy ||
          unknownSubmission ||
          acceptedSubmission ||
          inactive
        }
        onChooseDirectory={
          onChooseWorkspace
            ? async (signal) => {
                const item = await onChooseWorkspace(signal)
                if (!item || signal.aborted) return
                setWorkspaces((items) => [
                  ...items.filter((current) => current.id !== item.id),
                  item,
                ])
                onWorkspaceAdd?.(item)
                change({ workspaceId: item.id })
              }
            : undefined
        }
        onChange={async (workspaceId, signal) => {
          await onWorkspaceSelect?.(workspaceId, signal)
          if (!signal?.aborted) change({ workspaceId })
        }}
      />
      {pendingCopy && (
        <HomeSubmissionEcho
          submission={pendingCopy}
          workspacePath={workspacePath}
          accepted={acceptedSubmission}
          inactive={inactive}
          recovering={recoveringSubmission}
          checking={autoChecking || checking}
          unresolved={unknownSubmission && !submitting}
          issue={submissionFailure}
          onSettings={data.modelCatalog?.onOpenSettings}
          onCheck={onCheckSubmission ? () => void checkSubmission() : undefined}
        />
      )}
      {unknownSubmission && !pendingCopy && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground"
        >
          <span>原消息的接收结果暂未确认，当前输入已保留。</span>
          {onCheckSubmission && (
            <RecoveryAction
              issue={
                submissionFailure ?? {
                  code: "result_unknown",
                  message: "原消息的接收结果暂未确认。",
                  recovery: "check",
                  severity: "warning",
                }
              }
              disabled={submitting || checking}
              onCheck={() => void checkSubmission()}
              onSettings={data.modelCatalog?.onOpenSettings}
              labels={{ check: "检查发送状态" }}
            />
          )}
        </div>
      )}
      {(configFailure || saveError) && (
        <div className="mb-3 flex flex-col gap-2">
          {configFailure && (
            <OperationFeedback
              title={
                configFailure.code === "cancelled"
                  ? "会话配置读取已取消"
                  : "会话配置未能读取"
              }
              message={configFailure.message}
              details={configFailure.details}
              severity={configFailure.severity ?? "error"}
              actions={
                <RecoveryAction
                  issue={configFailure}
                  disabled={submitting}
                  onReload={() => {
                    configRequest.current?.abort()
                    setConfigRevision((value) => value + 1)
                  }}
                  onRetry={() => setConfigRevision((value) => value + 1)}
                  onCheck={() => setConfigRevision((value) => value + 1)}
                  onSettings={data.modelCatalog?.onOpenSettings}
                  labels={{ reload: "重新读取配置", check: "核对配置" }}
                />
              }
            />
          )}
          {saveError && (
            <OperationFeedback
              title="草稿未保存"
              message={saveError}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => {
                    try {
                      draftStore?.write(latestDraft.current)
                      setSaveError("")
                      acknowledgeRestoration(latestDraft.current)
                    } catch {
                      /* Keep the visible failure and its draft. */
                    }
                  }}
                >
                  重试保存
                </Button>
              }
            />
          )}
        </div>
      )}
      {configLoading && (
        <p role="status" className="mb-3 text-xs text-muted-foreground">
          正在读取会话配置，草稿可继续编辑…
        </p>
      )}
      {submissionFeedback}
      {!submissionFeedback &&
        submissionFailure &&
        !unknownSubmission &&
        !acceptedSubmission &&
        !recoveringSubmission && (
          <HomeSubmissionNotice
            key={`${sessionId}:${submissionFailure.code}:${submissionFailure.message}`}
            message={submissionFailure.message}
            persistent={["reload", "settings", "restart"].includes(
              submissionFailure.recovery ?? ""
            )}
            actions={
              <RecoveryAction
                issue={submissionFailure}
                onReload={() => setConfigRevision((value) => value + 1)}
                onSettings={data.modelCatalog?.onOpenSettings}
                labels={{ reload: "重新读取配置" }}
              />
            }
          />
        )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <fieldset
          disabled={acceptedSubmission || inactive}
          className="min-w-0 border-0 p-0"
        >
          <ComposerPanelProvider inactive={inactive || acceptedSubmission}>
            <FieldGroup>
              <Field>
                <ComposerInputCard
                  ref={anchorRef}
                  dropActive={materialController.dropActive}
                  dropDisabledReason={
                    !workspacePath
                      ? "请先选择工作目录"
                      : data.materialsEnabled === false ||
                          acceptedSubmission ||
                          inactive
                        ? "当前暂不能添加附件"
                        : undefined
                  }
                >
                  <PromptInput
                    inputRef={inputRef}
                    value={draft.text}
                    onChange={(text) => change({ text })}
                    onSubmit={submit}
                  />
                  <SelectedMaterials
                    key={`${sessionId}:${workspacePath}:${inactive || acceptedSubmission ? "inactive" : "active"}`}
                    materials={composerDisplayMaterials(
                      draft.materials,
                      draft.model,
                      data.modelInputs
                    )}
                    cwd={workspacePath}
                    onRetry={(id) => void materialController.retry(id)}
                    canRetry={(material) =>
                      !(
                        material.type === "image" &&
                        data.modelInputs &&
                        !data.modelInputs[draft.model]?.includes("image")
                      ) && materialController.canRetry(material.id)
                    }
                    retryLabel={(material) =>
                      materialController.retryLabel(material.id)
                    }
                    onRemove={(id) => change(removeComposerMaterial(draft, id))}
                  />
                  <ComposerToolbar
                    disabled={acceptedSubmission || inactive}
                    configurationDisabled={
                      submitting || unknownSubmission || acceptedSubmission
                    }
                    configurationDisabledReason={
                      acceptedSubmission
                        ? "正在打开已接收的会话，请稍候。"
                        : inactive
                          ? "当前输入区已离开。"
                          : unknownSubmission
                            ? "先检查原消息的发送状态，再修改会话配置。"
                            : submitting
                              ? "正在确认当前发送，确认后可修改会话配置。"
                              : undefined
                    }
                    sessionId={sessionId}
                    anchorRef={anchorRef}
                    data={{
                      materialsEnabled: data.materialsEnabled,
                      materials,
                      models,
                      tools,
                      modelLabels: data.modelLabels,
                      modelThinking: data.modelThinking,
                      modelCatalog: data.modelCatalog,
                    }}
                    workspacePath={
                      workspaces.find((item) => item.id === draft.workspaceId)
                        ?.path
                    }
                    draft={draft}
                    canSubmit={canSubmit}
                    onChange={change}
                    onAddMaterial={(item) => {
                      void materialController.prepare(item)
                      setResult("")
                    }}
                    onChooseAttachments={
                      materialController.service
                        ? materialController.choose
                        : undefined
                    }
                    choosingMaterials={materialController.choosing}
                  />
                </ComposerInputCard>
              </Field>
            </FieldGroup>
          </ComposerPanelProvider>
        </fieldset>
      </form>
      {unsupportedCompact && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          请先打开已有会话，再使用 /compact
          压缩其上下文。首页尚未开始对话，这条命令不会发送给模型。
        </p>
      )}
      {materialController.feedback && (
        <div className="mt-2">
          <OperationFeedback
            title={
              materialController.feedback.code === "cancelled"
                ? "材料核对已取消"
                : "材料未能添加"
            }
            message={materialController.feedback.message}
            details={materialController.feedback.details}
            severity={materialController.feedback.severity ?? "error"}
            actions={
              materialController.feedback.code === "cancelled" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={materialController.recheck}
                >
                  重新检查材料
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={materialController.clearError}
                >
                  知道了
                </Button>
              )
            }
          />
        </div>
      )}
      {result && (
        <p
          role="status"
          className="mt-4 rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground"
        >
          {result}
        </p>
      )}
    </section>
  )
}
