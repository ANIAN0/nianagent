import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react"
import {
  ChevronDown,
  SlidersHorizontal,
  Puzzle,
  LoaderCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { notifyComposer } from "@/components/composer/composer-notification"
import { DisabledControlReason } from "@/components/composer/disabled-control-reason"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  SessionServiceContext,
  type SessionService,
} from "@/features/session/session-service"
import type {
  SessionCatalog,
  SessionConfiguration,
} from "@/features/models/model-contract.generated"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { Skeleton } from "@/components/ui/skeleton"
import { ExtensionConfig } from "@/features/extensions/extension-config"
import {
  ExtensionServiceContext,
  type ExtensionService,
} from "@/features/extensions/extension-service"
import { ToolPicker } from "./tool-picker"
import { InstructionScopePicker } from "./instruction-scope-picker"
import type { HomeTool, SessionOptions } from "./home-types"
import { useNavigationBoundary } from "./navigation-boundary"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "./composer-panel-context"

export type SessionConfigProps = {
  loading?: boolean
  extensionService?: ExtensionService
  disabled?: boolean
  disabledReason?: string
  sessionId?: string
  tools: HomeTool[]
  value: SessionOptions
  workspacePath: string
  onChange: (value: SessionOptions) => void
}
type SubmittedConfiguration = {
  sessionId: string
  cwd: string
  options: SessionOptions
  revision: number
  catalog: SessionCatalog
  previous: SessionConfiguration | null
  draft: SessionOptions
  retryReady?: boolean
  issue?: FeedbackDescription
  checking?: boolean
}
// Only unresolved local configuration submissions survive panel navigation.
// Service identity isolates preview fixtures from the actual application.
const unresolvedConfigurations = new WeakMap<
  SessionService,
  Map<string, SubmittedConfiguration>
>()
const submissionKey = (sessionId: string, cwd: string) =>
  JSON.stringify([sessionId, cwd])
function retainSubmission(
  service: SessionService,
  key: string,
  attempt: SubmittedConfiguration,
  draft: SessionOptions
) {
  let records = unresolvedConfigurations.get(service)
  if (!records) {
    records = new Map()
    unresolvedConfigurations.set(service, records)
  }
  records.set(key, structuredClone({ ...attempt, draft, checking: false }))
}
function sameOptions(left: SessionOptions, right: SessionOptions) {
  return (
    left.instructionScope === right.instructionScope &&
    left.toolIds.length === right.toolIds.length &&
    left.toolIds.every((id) => right.toolIds.includes(id))
  )
}
function copyOptions(value: SessionOptions): SessionOptions {
  return {
    toolIds: [...value.toolIds],
    instructionScope: value.instructionScope,
  }
}
export function SessionConfig(props: SessionConfigProps) {
  return (
    <SessionConfigPanel
      key={`${props.sessionId ?? "preview"}:${props.workspacePath}`}
      {...props}
    />
  )
}
function SessionConfigPanel({
  loading = false,
  extensionService: suppliedExtensions,
  disabled = false,
  disabledReason = "当前操作完成后可修改会话配置。",
  sessionId,
  tools,
  value,
  workspacePath,
  onChange,
}: SessionConfigProps) {
  const service = useContext(SessionServiceContext)
  const extensions = useContext(ExtensionServiceContext)
  const extensionService = suppliedExtensions ?? extensions
  const [extensionOpen, setExtensionOpen] = useState(false)
  const navigation = useNavigationBoundary()
  const [open, setOpen] = useComposerPanel("config")
  const closeAutoFocus = useComposerPanelCloseAutoFocus("config")
  const [pending, setPending] = useState(value)
  const pendingRef = useRef(value)
  const [baseline, setBaseline] = useState(value)
  const [catalog, setCatalog] = useState<SessionCatalog>()
  const [saved, setSaved] = useState<SessionConfiguration | null>(null)
  const [phase, setPhase] = useState<
    | "ready"
    | "loading"
    | "load-error"
    | "refreshing"
    | "refresh-error"
    | "saving"
    | "checking"
    | "unknown"
  >("ready")
  const [feedback, setFeedback] = useState<FeedbackDescription>()
  const [applied, setApplied] = useState(false)
  const [retrySubmissionReady, setRetrySubmissionReady] = useState(false)
  const request = useRef<AbortController | null>(null)
  const releaseNavigation = useRef<(() => void) | null>(null)
  const submitted = useRef<SubmittedConfiguration | null>(null)
  const keepCandidateOnLoad = useRef(false)
  useEffect(
    () => () => {
      if (service && sessionId && submitted.current)
        retainSubmission(
          service,
          submissionKey(sessionId, workspacePath),
          submitted.current,
          pendingRef.current
        )
      request.current?.abort()
      releaseNavigation.current?.()
      releaseNavigation.current = null
      submitted.current = null
    },
    [service, sessionId, workspacePath]
  )
  function rememberSubmission() {
    if (service && sessionId && submitted.current) {
      submitted.current.draft = copyOptions(pendingRef.current)
      retainSubmission(
        service,
        submissionKey(sessionId, workspacePath),
        submitted.current,
        pendingRef.current
      )
    }
  }
  function updatePending(options: SessionOptions) {
    const next = copyOptions(options)
    pendingRef.current = next
    setPending(next)
    rememberSubmission()
  }
  function releaseNavigationLease() {
    releaseNavigation.current?.()
    releaseNavigation.current = null
  }
  function releaseSubmission() {
    if (service && sessionId)
      unresolvedConfigurations
        .get(service)
        ?.delete(submissionKey(sessionId, workspacePath))
    submitted.current = null
    setRetrySubmissionReady(false)
    releaseNavigationLease()
  }
  function acceptConfiguration(
    result: SessionConfiguration,
    attempt: SubmittedConfiguration
  ) {
    const editedAfterSubmission = !sameOptions(
      pendingRef.current,
      attempt.options
    )
    setSaved(result)
    setBaseline(copyOptions(result))
    onChange(copyOptions(result))
    setPhase("ready")
    setApplied(!editedAfterSubmission)
    setFeedback(
      editedAfterSubmission
        ? {
            message: "上一次配置已确认保存，后续修改尚未应用。",
            code: "configuration_confirmed",
            severity: "info",
            recovery: "none",
          }
        : undefined
    )
    releaseSubmission()
    if (!editedAfterSubmission) {
      setOpen(false)
      notifyComposer("会话配置已应用")
    }
  }
  function acceptNewerConfiguration(snapshot: SessionConfiguration | null) {
    const options = copyOptions(snapshot ?? catalog?.defaults ?? baseline)
    setSaved(snapshot)
    setBaseline(options)
    onChange(options)
    setPhase("ready")
    setApplied(false)
    setFeedback({
      message:
        "已重新读取当前会话的已保存配置。上次提交版本已过期，候选修改仍保留；请检查后再应用。",
      code: "session_revision_conflict",
      severity: "warning",
      recovery: "none",
    })
    releaseSubmission()
  }
  async function checkSubmission() {
    const attempt = submitted.current
    if (!service || !attempt || attempt.checking) return
    attempt.checking = true
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    releaseNavigation.current ??= navigation.acquire()
    setPhase("checking")
    setRetrySubmissionReady(false)
    attempt.retryReady = false
    try {
      // A read alone cannot reject a write that has not reached dispatch yet.
      // A retry must retain the submitted candidate AND its original CAS version.
      const snapshot = await service.read(attempt.sessionId, controller.signal)
      if (controller.signal.aborted || request.current !== controller) return
      if (
        snapshot?.sessionId === attempt.sessionId &&
        snapshot.cwd === attempt.cwd &&
        snapshot.revision === attempt.revision + 1 &&
        sameOptions(snapshot, attempt.options)
      ) {
        acceptConfiguration(snapshot, attempt)
        return
      }
      if (
        (!snapshot || snapshot.sessionId === attempt.sessionId) &&
        (attempt.issue?.code === "session_revision_conflict" ||
          (snapshot && snapshot.revision > attempt.revision))
      ) {
        acceptNewerConfiguration(snapshot)
        return
      }
      setPhase("unknown")
      setRetrySubmissionReady(true)
      attempt.retryReady = true
      setFeedback({
        message:
          "已读取当前会话，但尚未确认本次保存。可按原版本重试上次提交，后续候选修改会保留。",
        details: attempt.issue?.details,
        code: "result_unknown",
        severity: "warning",
        recovery: "check",
      })
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller) return
      const issue = feedbackFromError(cause, "暂时无法读取已保存配置。")
      setPhase("unknown")
      setFeedback({
        message:
          issue.code === "cancelled"
            ? "本次核对已取消，保存结果仍待确认。"
            : "暂时无法核对配置，本次提交和后续候选修改已保留。",
        details: [attempt.issue?.details, issue.message, issue.details]
          .filter(Boolean)
          .join("\n\n"),
        code: "result_unknown",
        severity: "warning",
        recovery: issue.recovery === "restart" ? "restart" : "check",
      })
    } finally {
      attempt.checking = false
      rememberSubmission()
      if (request.current === controller) releaseNavigationLease()
    }
  }
  async function retrySubmission() {
    const attempt = submitted.current
    if (!service || !attempt || attempt.checking || !retrySubmissionReady)
      return
    attempt.checking = true
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    releaseNavigation.current ??= navigation.acquire()
    setRetrySubmissionReady(false)
    attempt.retryReady = false
    setPhase("saving")
    setFeedback(undefined)
    let checkAfterRetry = false
    try {
      // Never reuse the mutable pending/saved values here: B is a later draft.
      // The original expected version makes concurrent A submissions commit once.
      const result = await service.apply(
        {
          sessionId: attempt.sessionId,
          cwd: attempt.cwd,
          ...copyOptions(attempt.options),
          ...(attempt.revision ? { revision: attempt.revision } : {}),
        },
        controller.signal
      )
      if (controller.signal.aborted || request.current !== controller) return
      acceptConfiguration(result, attempt)
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller) return
      const issue = feedbackFromError(cause, "上次提交暂时无法重试。")
      attempt.issue = {
        ...issue,
        details: [attempt.issue?.details, issue.message, issue.details]
          .filter(Boolean)
          .join("\n\n"),
      }
      setPhase("unknown")
      setFeedback({
        ...attempt.issue,
        message: "本次重试未完成，原提交结果仍需核对。",
        code: "result_unknown",
        severity: "warning",
        recovery: issue.recovery === "restart" ? "restart" : "check",
      })
      checkAfterRetry = issue.recovery !== "restart"
    } finally {
      attempt.checking = false
      rememberSubmission()
      if (request.current === controller) releaseNavigationLease()
    }
    if (checkAfterRetry && submitted.current === attempt)
      await checkSubmission()
  }
  async function load(keepCandidate = false) {
    if (submitted.current) return
    keepCandidateOnLoad.current = keepCandidate
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setFeedback(undefined)
    if (!keepCandidate) updatePending(value)
    if (!service) {
      setBaseline(copyOptions(value))
      setPhase("ready")
      return
    }
    if (!sessionId) {
      setPhase("load-error")
      setFeedback({
        message: "会话标识缺失，请重新打开此会话。",
        code: "session_missing",
        recovery: "none",
      })
      return
    }
    const retainView = keepCandidate && !!catalog
    setPhase(retainView ? "refreshing" : "loading")
    try {
      const [nextCatalog, snapshot] = await Promise.all([
        service.catalog(workspacePath, controller.signal),
        service.read(sessionId, controller.signal),
      ])
      if (controller.signal.aborted || request.current !== controller) return
      if (snapshot && snapshot.cwd !== nextCatalog.cwd)
        throw new Error("会话工作目录不匹配，请重新选择工作区。")
      const options = snapshot ?? nextCatalog.defaults
      setCatalog(nextCatalog)
      setSaved(snapshot)
      if (!keepCandidate) updatePending(options)
      setBaseline(copyOptions(options))
      onChange(copyOptions(options))
      setPhase("ready")
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller) return
      setPhase(retainView ? "refresh-error" : "load-error")
      const issue = feedbackFromError(cause, "会话配置暂时无法读取，请重试。")
      setFeedback(
        issue.code === "cancelled" ? { ...issue, recovery: "reload" } : issue
      )
    }
  }
  async function apply() {
    if (releaseNavigation.current) return
    if (!service) {
      onChange(copyOptions(pendingRef.current))
      setApplied(true)
      notifyComposer("会话配置已应用")
      setOpen(false)
      return
    }
    if (!sessionId || !catalog) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const attempt: SubmittedConfiguration = {
      sessionId,
      cwd: catalog.cwd,
      options: copyOptions(pendingRef.current),
      revision: saved?.revision ?? 0,
      catalog: structuredClone(catalog),
      previous: saved ? structuredClone(saved) : null,
      draft: copyOptions(pendingRef.current),
    }
    submitted.current = attempt
    rememberSubmission()
    setRetrySubmissionReady(false)
    releaseNavigation.current = navigation.acquire()
    setPhase("saving")
    setFeedback(undefined)
    try {
      const result = await service.apply(
        {
          sessionId,
          cwd: catalog.cwd,
          ...attempt.options,
          ...(saved ? { revision: saved.revision } : {}),
        },
        controller.signal
      )
      if (controller.signal.aborted || request.current !== controller) return
      acceptConfiguration(result, attempt)
    } catch (cause) {
      if (controller.signal.aborted || request.current !== controller) return
      const issue = feedbackFromError(cause, "配置未能保存，候选选择已保留。")
      if (issue.code === "result_unknown" || issue.recovery === "check") {
        attempt.issue = issue
        rememberSubmission()
        setFeedback({ ...issue, severity: "warning", recovery: "check" })
        setPhase("unknown")
        releaseNavigationLease()
        await checkSubmission()
        return
      }
      releaseSubmission()
      setPhase("ready")
      setFeedback(issue)
    }
  }
  const openPanel = useEffectEvent(() => {
    if (!submitted.current && service && sessionId) {
      const retained = unresolvedConfigurations
        .get(service)
        ?.get(submissionKey(sessionId, workspacePath))
      if (retained) submitted.current = structuredClone(retained)
    }
    const attempt = submitted.current
    if (attempt) {
      setCatalog(structuredClone(attempt.catalog))
      setSaved(attempt.previous ? structuredClone(attempt.previous) : null)
      setBaseline(copyOptions(attempt.previous ?? attempt.catalog.defaults))
      updatePending(attempt.draft)
      setPhase("unknown")
      setRetrySubmissionReady(!!attempt.retryReady)
      setFeedback({
        message:
          "上次保存结果仍待核对。关闭弹窗不会撤销提交，原提交和后续候选修改已保留。",
        code: "result_unknown",
        severity: "warning",
        recovery: "check",
        details: attempt.issue?.details,
      })
      void checkSubmission()
    } else void load()
  })
  useEffect(() => {
    if (open) openPanel()
  }, [open, service, sessionId, workspacePath])
  const availableTools = catalog?.tools ?? tools
  const displayTools = [
    ...availableTools,
    ...pending.toolIds
      .filter((id) => !availableTools.some((tool) => tool.id === id))
      .map((id) => ({
        id,
        name: id,
        description: "此工具已不在当前注册目录中",
        detail: "保存的会话仍引用此工具。请取消选择后应用新的配置。",
        group: "不可用工具",
        available: false,
        unavailableReason: "工具已移除或未注册",
      })),
  ]
  const unavailableSelected = catalog
    ? pending.toolIds.filter(
        (id) => !catalog.tools.some((tool) => tool.id === id && tool.available)
      )
    : []
  const toolsChanged =
    pending.toolIds.length !== baseline.toolIds.length ||
    pending.toolIds.some((id) => !baseline.toolIds.includes(id))
  const scopeChanged = pending.instructionScope !== baseline.instructionScope
  const pendingInstructions = (catalog?.instructions ?? []).filter(
    (file) =>
      pending.instructionScope === "all" ||
      (pending.instructionScope === "directory" && file.source === "directory")
  )
  const instructionsChanged =
    !!saved &&
    JSON.stringify(saved.instructions) !== JSON.stringify(pendingInstructions)
  const changed = toolsChanged || scopeChanged || instructionsChanged
  const submissionBlocked =
    phase === "saving" || phase === "checking" || phase === "unknown"
  const requestBusy = phase === "saving" || phase === "checking"
  const trigger = (
    <Button
      type="button"
      size="composer"
      variant="composer"
      aria-label="打开会话配置"
      disabled={disabled}
    >
      {loading ? (
        <LoaderCircle
          className="animate-spin"
          data-icon="inline-start"
          aria-label="正在读取会话配置"
        />
      ) : (
        <SlidersHorizontal data-icon="inline-start" />
      )}
      <span className="hidden @sm:inline" role={applied ? "status" : undefined}>
        {applied ? "配置已应用" : "会话配置"}
      </span>
      <ChevronDown className="text-caption" data-icon="inline-end" />
    </Button>
  )
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (releaseNavigation.current) return
          if (next) {
            setApplied(false)
            setPhase("loading")
          } else {
            rememberSubmission()
            request.current?.abort()
          }
          setOpen(next)
        }}
      >
        {disabled ? (
          <DisabledControlReason
            label="会话配置暂不可修改"
            reason={disabledReason}
          >
            {trigger}
          </DisabledControlReason>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>{trigger}</DialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">
              {loading ? "正在读取会话配置" : "配置本会话的工具与项目指令"}
            </TooltipContent>
          </Tooltip>
        )}
        <DialogContent
          onCloseAutoFocus={closeAutoFocus}
          showCloseButton={!requestBusy && !extensionOpen}
          onEscapeKeyDown={(event) => {
            if (extensionOpen) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (extensionOpen) event.preventDefault()
          }}
          className="flex h-[560px] max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[640px] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4"
        >
          {extensionOpen && extensionService && (
            <ExtensionConfig
              embedded
              open
              onOpenChange={setExtensionOpen}
              service={extensionService}
              onConfigured={() => void load(true)}
            />
          )}
          <div className={extensionOpen ? "hidden" : "contents"}>
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className="text-base leading-6">
                会话配置
                {phase === "refreshing" && (
                  <LoaderCircle
                    className="ml-2 inline size-3.5 animate-spin"
                    aria-label="正在更新工具目录"
                  />
                )}
              </DialogTitle>
              <DialogDescription className="sr-only">
                选择会话可用工具与项目指令范围。应用成功后保存到当前会话。
              </DialogDescription>
            </DialogHeader>
            {phase === "loading" ? (
              <div
                className="flex flex-1 flex-col gap-4 px-6 py-4"
                role="status"
                aria-label="正在读取会话配置"
              >
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <p className="text-xs text-muted-foreground">
                  正在读取工具与项目指令…
                </p>
              </div>
            ) : phase === "load-error" ? (
              <div className="moon-scrollbar min-h-0 flex-1 overflow-auto px-6 py-4">
                {feedback && (
                  <OperationFeedback
                    title={
                      feedback.code === "cancelled"
                        ? "读取已取消"
                        : "无法读取会话配置"
                    }
                    {...feedback}
                    actions={
                      <RecoveryAction
                        issue={feedback}
                        onRetry={() => void load(keepCandidateOnLoad.current)}
                        onReload={() => void load(keepCandidateOnLoad.current)}
                        onCheck={() => void load(keepCandidateOnLoad.current)}
                        labels={{ retry: "重新读取" }}
                      />
                    }
                  />
                )}
              </div>
            ) : (
              <fieldset
                disabled={phase === "saving" || phase === "refreshing"}
                className="flex min-h-0 flex-1 flex-col border-0 p-0"
              >
                {unavailableSelected.length > 0 && (
                  <div className="mx-6 mb-3">
                    <OperationFeedback
                      title="所选工具不可用"
                      message={`请取消选择后应用：${unavailableSelected.join("、")}`}
                      severity="warning"
                    />
                  </div>
                )}
                <Tabs
                  defaultValue="tools"
                  className="min-h-0 flex-1 gap-4 px-6"
                >
                  <div className="flex shrink-0 items-center justify-between gap-3">
                    <TabsList aria-label="会话配置分类" className="shrink-0">
                      <TabsTrigger value="tools">
                        工具{" "}
                        {toolsChanged && (
                          <span
                            aria-label="已修改"
                            className="size-[5px] rounded-full bg-primary"
                          />
                        )}
                      </TabsTrigger>
                      <TabsTrigger value="instructions">
                        项目指令{" "}
                        {(scopeChanged || instructionsChanged) && (
                          <span
                            aria-label="已修改"
                            className="size-[5px] rounded-full bg-primary"
                          />
                        )}
                      </TabsTrigger>
                    </TabsList>
                    {extensionService && (
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setExtensionOpen(true)}
                      >
                        <Puzzle data-icon="inline-start" />
                        管理扩展
                      </Button>
                    )}
                  </div>
                  <TabsContent
                    forceMount
                    value="tools"
                    className="flex min-h-0 flex-col gap-3 pb-4 data-[state=inactive]:hidden"
                  >
                    <ToolPicker
                      tools={displayTools}
                      value={pending.toolIds}
                      onChange={(toolIds) =>
                        updatePending({ ...pending, toolIds })
                      }
                    />
                  </TabsContent>
                  <TabsContent
                    forceMount
                    value="instructions"
                    className="flex min-h-0 flex-col pb-4 data-[state=inactive]:hidden"
                  >
                    {saved && (
                      <p className="mb-3 text-xs leading-5 text-muted-foreground">
                        已保存 {saved.instructions.length} 个指令文件。
                        {instructionsChanged
                          ? "磁盘内容或所选范围已变化；应用后更新会话快照。"
                          : "本次读取内容与已保存快照一致。"}
                      </p>
                    )}
                    <InstructionScopePicker
                      workspacePath={catalog?.cwd ?? workspacePath}
                      instructions={catalog?.instructions}
                      savedInstructions={saved?.instructions}
                      value={pending.instructionScope}
                      onChange={(instructionScope) =>
                        updatePending({ ...pending, instructionScope })
                      }
                    />
                  </TabsContent>
                </Tabs>
              </fieldset>
            )}
            {feedback && phase !== "load-error" && (
              <div className="moon-scrollbar max-h-[45%] shrink-0 overflow-auto px-6 pb-3">
                <OperationFeedback
                  title={
                    submissionBlocked
                      ? "保存结果待核对"
                      : feedback.code === "session_revision_conflict"
                        ? "当前会话配置已更新"
                        : feedback.code === "configuration_confirmed"
                          ? "配置已确认保存"
                          : feedback.code === "cancelled"
                            ? "应用已取消"
                            : "配置未能保存"
                  }
                  {...feedback}
                  actions={
                    feedback.recovery === "restart" ? (
                      <RecoveryAction issue={feedback} />
                    ) : submissionBlocked ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={phase === "checking" || phase === "saving"}
                        onClick={() =>
                          void (retrySubmissionReady
                            ? retrySubmission()
                            : checkSubmission())
                        }
                      >
                        {phase === "checking"
                          ? "正在核对…"
                          : retrySubmissionReady
                            ? "按原版本重试"
                            : "核对配置"}
                      </Button>
                    ) : feedback.code !== "configuration_confirmed" ? (
                      <RecoveryAction
                        issue={feedback}
                        onRetry={() => void load(true)}
                        onReload={() => void load(true)}
                        onCheck={() => void load(true)}
                        labels={{
                          retry: "读取当前会话已保存配置",
                          reload: "读取当前会话已保存配置",
                          check: "核对配置",
                        }}
                      />
                    ) : undefined
                  }
                />
              </div>
            )}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
              {submissionBlocked && (
                <p
                  role="status"
                  className="mr-auto text-xs text-muted-foreground"
                >
                  {phase === "saving"
                    ? "正在保存，请稍候…"
                    : retrySubmissionReady
                      ? "重试仅使用上次提交，后续修改不会一起发送。"
                      : "关闭不会撤销提交，重开后可继续核对。"}
                </p>
              )}
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={requestBusy}
                  className="h-9 w-[72px]"
                >
                  {submissionBlocked ? "关闭" : "取消"}
                </Button>
              </DialogClose>
              <Button
                type="button"
                className="h-9 w-[72px]"
                disabled={
                  phase !== "ready" ||
                  feedback?.recovery === "restart" ||
                  (feedback?.code === "session_revision_conflict" &&
                    feedback.recovery === "reload") ||
                  unavailableSelected.length > 0 ||
                  !changed
                }
                onClick={() => void apply()}
              >
                {phase === "saving" ? "应用中…" : "应用"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
