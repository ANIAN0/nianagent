import { useContext, useEffect, useEffectEvent, useRef, useState } from "react"

import { notifyComposer } from "@/components/composer/composer-notification"

import {
  SessionServiceContext,
  type SessionService,
} from "@/features/session/session-service"
import type {
  SessionCatalog,
  SessionConfiguration,
} from "@/contracts/rpc.generated"

import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

import { ExtensionServiceContext } from "@/features/extensions/extension-service"
import { type ToolPickerHandle } from "@/components/composer/tool-picker"

import type { SessionOptions } from "@/lib/composer/types"
import { useNavigationBoundary } from "@/lib/navigation/navigation-boundary"
import {
  useComposerPanel,
  useComposerPanelCloseAutoFocus,
} from "@/components/composer/composer-panel-context"
import type { SessionConfigProps } from "./session-config.types"
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
/** 页面状态与异步所有权在此维护，视图只组合正式组件。 */
export function useSessionConfiguration({
  extensionService: suppliedExtensions,
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
  const [activeTab, setActiveTab] = useState("tools")
  const toolPicker = useRef<ToolPickerHandle>(null)
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
        retainView
          ? {
              ...issue,
              message:
                issue.code === "cancelled"
                  ? "重新读取已取消，上次读取内容和候选修改仍保留。"
                  : "重新读取失败，上次读取内容和候选修改仍保留。",
              details: [issue.message, issue.details]
                .filter(Boolean)
                .join("\n\n"),
              ...(issue.code === "cancelled"
                ? { recovery: "reload" as const }
                : {}),
            }
          : issue.code === "cancelled"
            ? { ...issue, recovery: "reload" }
            : issue
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
  function changeOpen(next: boolean) {
    if (releaseNavigation.current) return
    if (next) {
      setApplied(false)
      setActiveTab("tools")
      setPhase("loading")
    } else {
      rememberSubmission()
      request.current?.abort()
    }
    setOpen(next)
  }
  function preventDismiss(event: { preventDefault: () => void }) {
    if (extensionOpen || releaseNavigation.current) event.preventDefault()
  }
  function handleEscape(event: { preventDefault: () => void }) {
    if (extensionOpen || releaseNavigation.current) {
      event.preventDefault()
      return
    }
    if (activeTab === "tools" && toolPicker.current?.backIfDetail())
      event.preventDefault()
  }
  const reloadCandidate = () => load(keepCandidateOnLoad.current)
  const refreshCapabilities = () => load(true)
  return {
    applied,
    open,
    changeOpen,
    preventDismiss,
    handleEscape,
    selectTab: setActiveTab,
    closeAutoFocus,
    requestBusy,
    extensionOpen,
    activeTab,
    toolPicker,
    extensionService,
    setExtensionOpen,
    reloadCandidate,
    refreshCapabilities,
    phase,
    feedback,
    unavailableSelected,
    displayTools,
    toolsChanged,
    pending,
    updatePending,
    catalog,
    submissionBlocked,
    retrySubmissionReady,
    retrySubmission,
    checkSubmission,
    changed,
    apply,
  }
}
