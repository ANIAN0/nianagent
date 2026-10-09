import { readConfigurationDraft } from "@/lib/operations/configuration-draft-store"
import {
  maintenanceWritesFrozen,
  useMaintenanceBlocker,
} from "@/lib/maintenance/maintenance-coordinator"
import { useRetainedWrite } from "@/lib/operations/use-retained-write"
import { recheckConfigurationRecoveryStore } from "@/lib/operations/configuration-recovery-store"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { feedbackFromError } from "@/lib/operation-issue"
import {
  readSettingsWriteReceipt,
  unknownWrite,
  writeIsUnknown,
} from "@/lib/operations/settings-write-recovery"
import type { SettingsConfirmation } from "@/components/operations/settings-confirmation"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import {
  blankMcpConfiguration,
  type McpConfiguration,
  type McpServer,
  type McpService,
  type McpTestResult as TestResult,
} from "./mcp-service"
import type { McpServerEditorProps } from "./mcp-server-editor"
type SaveAttempt = {
  operation: "mcpSave"
  operationRequestId: string
  targetId: string
  configuration: McpConfiguration
  revision?: number
}
type RetainedSave = {
  attempt: SaveAttempt
  value: McpConfiguration
  original: string
  revision?: number
  issue: ReturnType<typeof feedbackFromError>
}
const retainedSaves = new WeakMap<McpService, Map<string, RetainedSave>>()
export function useMcpEditor({
  initial,
  service,
  cwd = "",
  onSaved,
  registerLeave,
}: McpServerEditorProps) {
  const recordKey = initial?.configuration.name || "new"
  const restoredDraft = readConfigurationDraft<RetainedSave>(
    "mcpSave",
    recordKey,
    service.evidence === "demo"
  )
  const retained =
    retainedSaves.get(service)?.get(recordKey) ?? restoredDraft.record
  const [restorationFailed] = useState(!!restoredDraft.issue)
  if (retained && !retainedSaves.get(service)?.has(recordKey)) {
    const owner = retainedSaves.get(service) ?? new Map<string, RetainedSave>()
    owner.set(recordKey, retained)
    retainedSaves.set(service, owner)
  }
  const [value, setValue] = useState<McpConfiguration>(() =>
    structuredClone(
      retained?.value || initial?.configuration || blankMcpConfiguration()
    )
  )
  const [original, setOriginal] = useState(
    () =>
      retained?.original ??
      JSON.stringify(initial?.configuration || blankMcpConfiguration())
  )
  const [revision, setRevision] = useState(
    retained?.revision ?? initial?.revision
  )
  const [persisted, setPersisted] = useState(!!initial)
  const [saveNotice, setSaveNotice] = useState("")
  const latestValue = useRef(value)
  useLayoutEffect(() => {
    latestValue.current = value
  }, [value])
  const [result, setResult] = useState<TestResult | undefined>(initial?.test)
  const [tested, setTested] = useState(initial?.test ? original : "")
  const [busy, setBusy] = useState<"save" | "test" | "check">()
  const [saveFailure, setSaveFailure] = useState<
    ReturnType<typeof feedbackFromError> | undefined
  >(retained?.issue ?? restoredDraft.issue)
  const [testFailure, setTestFailure] =
    useState<ReturnType<typeof feedbackFromError>>()
  const [validation, setValidation] = useState(false)
  const [testNotice, setTestNotice] = useState("")
  const [waitingToLeave, setWaitingToLeave] = useState(false)
  const [confirm, setConfirm] = useState<SettingsConfirmation>()
  const controller = useRef<AbortController | null>(null)
  const latestBaseline = useRef({ original, revision })
  useLayoutEffect(() => {
    latestBaseline.current = { original, revision }
  }, [original, revision])
  const submitted = useRef<SaveAttempt | null>(retained?.attempt ?? null)
  const { hasUnresolved, remember, clearAttempt } = useRetainedWrite<
    McpService,
    SaveAttempt,
    RetainedSave
  >({
    submitted: submitted,
    service,
    recordKey,
    records: retainedSaves,
    identity: (a) => ({
      operation: a.operation,
      operationRequestId: a.operationRequestId,
      targetId: a.targetId,
      revision: a.revision,
    }),
    snapshot: (attempt: SaveAttempt, issue) => ({
      attempt,
      value: structuredClone(latestValue.current),
      ...latestBaseline.current,
      issue,
    }),
  })

  function recoverStorage() {
    const restored = readConfigurationDraft(
      "mcpSave",
      recordKey,
      service.evidence === "demo"
    )
    if (restored.issue) setSaveFailure(restored.issue)
    else if (service.evidence === "demo" || recheckConfigurationRecoveryStore())
      setSaveFailure(
        restorationFailed
          ? {
              code: "recovery_storage_restored",
              recovery: "reload",
              severity: "warning",
              message:
                "恢复存储已可读取，请返回列表后重新打开原配置，继续处理保留的原请求与副本。",
            }
          : undefined
      )
  }
  const validName = /^[a-zA-Z0-9_-]{1,64}$/.test(value.name)
  const validTimeout =
    Number.isSafeInteger(value.timeout) &&
    value.timeout >= 1 &&
    value.timeout <= 120
  const dirty = JSON.stringify(value) !== original
  useMaintenanceBlocker(
    "mcp-editor:" + recordKey,
    "MCP 配置有未保存更改或操作仍在进行，请返回配置页处理。",
    dirty || !!busy || restorationFailed || !!restoredDraft.issue
  )
  const leave = useCallback<LeaveGuard>(
    (action) => {
      if (busy) {
        setWaitingToLeave(true)
        return
      }
      if (!dirty && !hasUnresolved) {
        action()
        return
      }
      setConfirm({
        title: hasUnresolved ? "离开配置页？" : "放弃未保存的配置？",
        description: hasUnresolved
          ? "原保存结果尚待核对。草稿和原请求会保留；离开不撤销可能已经完成的保存。"
          : "服务的已保存配置保持不变。",
        label: hasUnresolved ? "离开配置" : "放弃修改",
        action: async () => action(),
      })
    },
    [busy, dirty, hasUnresolved]
  )
  useEffect(() => {
    registerLeave?.(leave)
    return () => registerLeave?.(null)
  }, [registerLeave, leave])
  useEffect(() => {
    if (!dirty && !hasUnresolved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, hasUnresolved])
  useEffect(
    () => () => {
      controller.current?.abort()
      controller.current = null
      const records = retainedSaves.get(service)
      const record = records?.get(recordKey)
      if (record)
        records?.set(recordKey, {
          ...record,
          value: structuredClone(latestValue.current),
        })
    },
    [service, recordKey]
  )
  const patch = (update: Partial<McpConfiguration>) => {
    if (maintenanceWritesFrozen()) return
    setValue((old) => ({ ...old, ...update }))
    setValidation(false)
    setTestNotice("")
  }
  function acceptSaved(saved: McpServer, captured: McpConfiguration) {
    const current = latestValue.current
    const keepOpen = JSON.stringify(current) !== JSON.stringify(captured)
    setOriginal(JSON.stringify(saved.configuration))
    // A new service may have been renamed in the later draft. Its next save is
    // a creation; a revision from the confirmed service must never target it.
    const sameService = current.name === saved.configuration.name
    setRevision(sameService ? saved.revision : undefined)
    setPersisted(sameService)
    setSaveFailure(undefined)
    clearAttempt()
    setSaveNotice(
      keepOpen ? "上次提交已确认保存，后续修改仍留在表单中，尚未保存。" : ""
    )
    onSaved(saved, keepOpen)
  }
  const saveBlocked =
    restorationFailed ||
    !!restoredDraft.issue ||
    (saveFailure?.severity !== "info" &&
      (saveFailure?.recovery === "restart" || saveFailure?.recovery === "none"))
  const testBlocked =
    testFailure?.severity !== "info" &&
    (testFailure?.recovery === "restart" || testFailure?.recovery === "none")
  async function request(kind: "save" | "test") {
    if (
      controller.current ||
      busy ||
      submitted.current ||
      (kind === "save" ? saveBlocked : testBlocked)
    )
      return
    if (
      !validName ||
      !validTimeout ||
      (value.transport === "stdio" ? !value.command.trim() : !value.url.trim())
    ) {
      setValidation(true)
      return
    }
    const current = new AbortController()
    controller.current = current
    setBusy(kind)
    setValidation(false)
    if (kind === "save") setSaveFailure(undefined)
    else setTestFailure(undefined)
    setTestNotice("")
    if (kind === "save") setSaveNotice("")
    setWaitingToLeave(false)
    const captured = structuredClone(value)
    const attempt: SaveAttempt = {
      operation: "mcpSave",
      operationRequestId: crypto.randomUUID(),
      targetId: captured.name,
      configuration: captured,
      revision,
    }
    if (kind === "save") {
      submitted.current = attempt
      try {
        remember(attempt, unknownWrite("正在等待此服务的保存结果。"))
      } catch (reason) {
        submitted.current = null
        controller.current = null
        setBusy(undefined)
        setSaveFailure(
          feedbackFromError(reason, "恢复身份无法保存，未发起服务写入。")
        )
        return
      }
    } else {
      setResult(undefined)
      setTested(JSON.stringify(captured))
    }
    try {
      if (kind === "save") {
        const saved = await service.save(
          captured,
          revision,
          current.signal,
          attempt.operationRequestId
        )
        if (!current.signal.aborted && controller.current === current)
          acceptSaved(saved, captured)
      } else {
        const response = await service.test(captured, cwd, current.signal)
        if (!current.signal.aborted && controller.current === current) {
          setResult(response)
          setTested(JSON.stringify(captured))
        }
      }
    } catch (reason) {
      if (controller.current === current) {
        const issue = feedbackFromError(
          reason,
          kind === "save"
            ? "未能保存服务，草稿已保留。"
            : "未能完成连接测试，请检查参数后重试。"
        )
        if (kind === "save") {
          if (writeIsUnknown(issue) || current.signal.aborted) {
            const unknown = current.signal.aborted
              ? unknownWrite("保存等待已取消，最终结果仍待核对。")
              : issue
            remember(attempt, unknown)
            setSaveFailure(unknown)
          } else {
            clearAttempt()
            setSaveFailure(issue)
          }
        } else if (!current.signal.aborted) setTestFailure(issue)
      }
    } finally {
      if (controller.current === current) {
        controller.current = null
        setBusy(undefined)
      }
    }
  }
  async function checkSaved() {
    if (controller.current || busy || !submitted.current) return
    const attempt = submitted.current
    const current = new AbortController()
    controller.current = current
    setBusy("check")
    setWaitingToLeave(false)
    try {
      const receipt = await readSettingsWriteReceipt(
        service.readWriteReceipt,
        attempt,
        current.signal
      )
      if (current.signal.aborted || controller.current !== current) return
      if (receipt.state === "unknown") {
        const issue = unknownWrite(
          "服务仍未确认原保存请求。草稿已保留，请稍后核对。"
        )
        remember(attempt, issue)
        setSaveFailure(issue)
        return
      }
      if (receipt.state === "rejected") {
        clearAttempt()
        setSaveFailure(
          receipt.issue
            ? feedbackFromError({ issue: receipt.issue })
            : {
                code: "write_rejected",
                message: "原保存请求未提交。草稿已保留，可修正后重新保存。",
                recovery: "retry",
              }
        )
        return
      }
      const servers = await service.list(current.signal)
      if (current.signal.aborted || controller.current !== current) return
      const saved = servers.find(
        (item) => item.configuration.name === attempt.targetId
      )
      if (
        !saved ||
        (receipt.revision !== undefined && saved.revision !== receipt.revision)
      ) {
        clearAttempt()
        setSaveFailure({
          code: "revision_changed",
          recovery: "reload",
          message:
            "原保存已确认提交，但服务随后又被修改或删除。草稿保留，请返回目录查看最新状态。",
        })
        return
      }
      acceptSaved(saved, attempt.configuration)
    } catch (reason) {
      if (!current.signal.aborted && controller.current === current) {
        const issue = feedbackFromError(reason, "暂时无法核对原保存请求。")
        remember(attempt, issue)
        setSaveFailure(issue)
      }
    } finally {
      if (controller.current === current) {
        controller.current = null
        setBusy(undefined)
      }
    }
  }
  const saveUnknown = hasUnresolved
  const saveConflict = !saveUnknown && saveFailure?.recovery === "reload"
  function cancelTest() {
    if (busy === "test") {
      controller.current?.abort()
      setTestNotice("连接测试已取消，草稿保留。")
    }
  }
  return {
    value,
    persisted,
    validName,
    validTimeout,
    validation,
    patch,
    dirty,
    busy,
    waitingToLeave,
    testNotice,
    testFailure,
    result,
    tested,
    saveFailure,
    recoverStorage,
    saveUnknown,
    saveConflict,
    saveBlocked,
    testBlocked,
    saveNotice,
    request,
    checkSaved,
    cancelTest,
    leave,
    confirm,
    setConfirm,
  }
}
