import { readConfigurationDraft } from "@/lib/operations/configuration-draft-store"
import {
  maintenanceWritesFrozen,
  useMaintenanceBlocker,
  useMaintenanceFrozen,
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
import { ArrowLeft, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  SettingsConfirmDialog,
  type SettingsConfirmation,
} from "@/components/operations/settings-confirmation"
import {
  readSettingsWriteReceipt,
  unknownWrite,
  writeIsUnknown,
} from "@/lib/operations/settings-write-recovery"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import {
  ExtensionConfigurationFields,
  extensionConfigurationErrors,
  readExtensionConfiguration,
} from "./extension-configuration-fields"
import type {
  ExtensionConfiguration,
  ExtensionDescriptor,
  ExtensionService,
} from "./extension-service"

type Attempt = {
  operation: "extensionConfigure"
  operationRequestId: string
  targetId: string
  configuration: ExtensionConfiguration
}
type Retained = {
  attempt: Attempt
  descriptor: ExtensionDescriptor
  enabled: boolean
  configuration: string
  issue: FeedbackDescription
}
const unresolved = new WeakMap<ExtensionService, Map<string, Retained>>()
export function retainedExtensionDescriptor(
  service: ExtensionService,
  id: string
) {
  return unresolved.get(service)?.get(id)?.descriptor
}

export function ExtensionEditor({
  descriptor,
  service,
  onClose,
  onSaved,
  registerLeave,
}: {
  descriptor: ExtensionDescriptor
  service: ExtensionService
  onClose(): void
  onSaved(keepOpen?: boolean): void
  registerLeave(guard: ((action: () => void) => void) | null): void
}) {
  const frozen = useMaintenanceFrozen()
  const restoredDraft = readConfigurationDraft<Retained>(
    "extensionConfigure",
    descriptor.id,
    service.evidence === "demo"
  )
  const retained =
    unresolved.get(service)?.get(descriptor.id) ?? restoredDraft.record
  const [restorationFailed] = useState(!!restoredDraft.issue)
  if (retained && !unresolved.get(service)?.has(descriptor.id)) {
    const owner = unresolved.get(service) ?? new Map<string, Retained>()
    owner.set(descriptor.id, retained)
    unresolved.set(service, owner)
  }
  const [baseline, setBaseline] = useState(retained?.descriptor ?? descriptor)
  const [enabled, setEnabled] = useState(
    retained?.enabled ?? descriptor.enabled
  )
  const [configuration, setConfiguration] = useState(
    retained?.configuration ?? descriptor.configuration
  )
  const [failure, setFailure] = useState<FeedbackDescription | undefined>(
    retained?.issue ?? restoredDraft.issue
  )
  const [busy, setBusy] = useState<"save" | "check">()
  const [waiting, setWaiting] = useState(false)
  const [confirmation, setConfirmation] = useState<SettingsConfirmation>()
  const request = useRef<AbortController | null>(null)
  const latest = useRef({ enabled, configuration })
  useLayoutEffect(() => {
    latest.current = { enabled, configuration }
  }, [enabled, configuration])
  const attempt = useRef<Attempt | null>(retained?.attempt ?? null)
  const { hasUnresolved, remember, clearAttempt } = useRetainedWrite<
    ExtensionService,
    Attempt,
    Retained
  >({
    submitted: attempt,
    service,
    recordKey: descriptor.id,
    records: unresolved,
    identity: (a) => ({
      operation: a.operation,
      operationRequestId: a.operationRequestId,
      targetId: a.targetId,
      revision: a.configuration.revision,
    }),
    snapshot: (attempt: Attempt, issue) => ({
      attempt,
      descriptor: baseline,
      ...latest.current,
      issue,
    }),
  })

  const dirty =
    enabled !== baseline.enabled || configuration !== baseline.configuration
  useMaintenanceBlocker(
    "extension-editor:" + descriptor.id,
    "扩展配置有未保存更改或操作仍在进行，请返回配置页处理。",
    dirty || !!busy || restorationFailed || !!restoredDraft.issue
  )
  const pending = hasUnresolved
  const saveBlocked =
    restorationFailed ||
    !!restoredDraft.issue ||
    (failure?.severity !== "info" &&
      (failure?.recovery === "restart" || failure?.recovery === "none"))
  let fields: ReturnType<typeof readExtensionConfiguration> | undefined
  let errors: string[] = []
  try {
    fields = readExtensionConfiguration(
      descriptor.configurationSchema,
      configuration
    )
    errors = extensionConfigurationErrors(fields.schema, fields.configuration)
  } catch {
    errors = ["配置格式无法识别，请检查扩展安装后重启 Moon。"]
  }
  function recoverStorage() {
    const restored = readConfigurationDraft(
      "extensionConfigure",
      descriptor.id,
      service.evidence === "demo"
    )
    if (restored.issue) setFailure(restored.issue)
    else if (service.evidence === "demo" || recheckConfigurationRecoveryStore())
      setFailure(
        restorationFailed
          ? {
              code: "recovery_storage_restored",
              recovery: "reload",
              severity: "warning",
              message:
                "恢复存储已可读取，请返回目录后重新打开原配置，继续处理保留的原请求与副本。",
            }
          : undefined
      )
  }
  const leave = useCallback(
    (action: () => void) => {
      if (busy) {
        setWaiting(true)
        return
      }
      if (dirty || pending)
        setConfirmation({
          title: pending ? "离开扩展配置？" : "放弃扩展配置草稿？",
          description: pending
            ? "原保存结果尚待核对。草稿和原请求保留；离开不撤销可能已完成的全局配置。"
            : "当前修改尚未保存。",
          label: "离开配置",
          action,
        })
      else action()
    },
    [busy, dirty, pending]
  )
  useEffect(() => {
    registerLeave(leave)
    return () => registerLeave(null)
  }, [leave, registerLeave])
  useEffect(() => {
    if (!dirty && !pending) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty, pending])
  useEffect(
    () => () => {
      request.current?.abort()
      request.current = null
      const record = unresolved.get(service)?.get(descriptor.id)
      if (record)
        unresolved
          .get(service)
          ?.set(descriptor.id, { ...record, ...latest.current })
    },
    [service, descriptor.id]
  )
  function acceptSaved(
    saved: ExtensionDescriptor,
    captured: ExtensionConfiguration
  ) {
    const laterDraft =
      latest.current.enabled !== captured.enabled ||
      latest.current.configuration !== captured.configuration
    clearAttempt()
    setBaseline(saved)
    if (laterDraft)
      setFailure({
        code: "write_confirmed",
        severity: "info",
        recovery: "none",
        message: "原保存已确认，当前表单的后续修改仍未保存。",
      })
    else {
      setEnabled(saved.enabled)
      setConfiguration(saved.configuration)
      setFailure(undefined)
    }
    onSaved(laterDraft)
  }
  async function save() {
    if (
      maintenanceWritesFrozen() ||
      request.current ||
      pending ||
      saveBlocked ||
      !dirty ||
      errors.length ||
      failure?.recovery === "reload"
    )
      return
    const current: Attempt = {
      operation: "extensionConfigure",
      operationRequestId: crypto.randomUUID(),
      targetId: descriptor.id,
      configuration: {
        id: descriptor.id,
        revision: baseline.revision,
        enabled,
        configuration,
      },
    }
    const controller = new AbortController()
    request.current = controller
    attempt.current = current
    try {
      remember(current, unknownWrite("正在等待扩展配置提交结果。"))
    } catch (reason) {
      attempt.current = null
      request.current = null
      setFailure(
        feedbackFromError(reason, "恢复身份无法保存，未发起扩展配置写入。")
      )
      return
    }
    setBusy("save")
    setFailure(undefined)
    setWaiting(false)
    try {
      const saved = await service.configure(
        current.configuration,
        controller.signal,
        current.operationRequestId
      )
      controller.signal.throwIfAborted()
      if (request.current !== controller) return
      acceptSaved(saved, current.configuration)
    } catch (reason) {
      if (request.current === controller) {
        const issue = controller.signal.aborted
          ? unknownWrite("保存等待已取消，原提交结果仍待核对。")
          : feedbackFromError(reason, "未能保存扩展配置，草稿保留。")
        if (writeIsUnknown(issue)) remember(current, issue)
        else clearAttempt()
        setFailure(issue)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(undefined)
      }
    }
  }
  async function check() {
    const current = attempt.current
    if (request.current || !current) return
    const controller = new AbortController()
    request.current = controller
    setBusy("check")
    setWaiting(false)
    try {
      const receipt = await readSettingsWriteReceipt(
        service.readWriteReceipt,
        current,
        controller.signal
      )
      if (request.current !== controller) return
      if (receipt.state === "unknown") {
        const issue = unknownWrite(
          "服务仍未确认原扩展配置保存，请稍后重新核对。"
        )
        remember(current, issue)
        setFailure(issue)
        return
      }
      if (receipt.state === "rejected") {
        clearAttempt()
        setFailure(
          receipt.issue
            ? feedbackFromError({ issue: receipt.issue })
            : {
                code: "write_rejected",
                message: "原保存未提交，草稿保留，可重新保存。",
                recovery: "retry",
              }
        )
        return
      }
      const items = await service.list(controller.signal)
      controller.signal.throwIfAborted()
      if (request.current !== controller) return
      const saved = items.find((item) => item.id === current.targetId)
      if (
        !saved ||
        (receipt.revision !== undefined && receipt.revision !== saved.revision)
      ) {
        clearAttempt()
        setFailure({
          code: "revision_changed",
          recovery: "reload",
          message:
            "原保存已提交，但扩展配置随后已改变。草稿保留，请返回目录查看最新版本。",
        })
        return
      }
      acceptSaved(saved, current.configuration)
    } catch (reason) {
      if (!controller.signal.aborted && request.current === controller) {
        const issue = feedbackFromError(reason, "暂时无法核对原扩展配置保存。")
        remember(current, issue)
        setFailure(issue)
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(undefined)
      }
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => leave(onClose)}
      >
        <ArrowLeft data-icon="inline-start" />
        扩展目录
      </Button>
      <h3 className="text-sm font-medium">{descriptor.name}</h3>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="extension-enabled">启用扩展</FieldLabel>
          <Switch
            id="extension-enabled"
            checked={enabled}
            disabled={!!busy || frozen}
            onCheckedChange={(value) => {
              if (!maintenanceWritesFrozen()) setEnabled(value)
            }}
          />
          <FieldDescription>保存后在空闲会话下一轮生效。</FieldDescription>
        </Field>
        {fields && (
          <ExtensionConfigurationFields
            id={descriptor.id}
            schema={fields.schema}
            values={fields.configuration}
            disabled={!!busy || frozen}
            onChange={(values) => {
              if (!maintenanceWritesFrozen())
                setConfiguration(JSON.stringify(values))
            }}
          />
        )}
      </FieldGroup>
      {errors.length > 0 && (
        <OperationFeedback title="请检查扩展配置" message={errors.join(" ")} />
      )}
      {failure && (
        <OperationFeedback
          notify={false}
          title={
            pending
              ? "保存结果待核对"
              : failure.code === "write_confirmed"
                ? "原保存已确认"
                : "未能保存扩展配置"
          }
          {...failure}
          actions={
            <>
              {failure.code === "recovery_storage_unavailable" ? (
                <Button variant="outline" size="sm" onClick={recoverStorage}>
                  重新读取本机恢复记录
                </Button>
              ) : (
                <RecoveryAction
                  issue={failure}
                  onCheck={() => void check()}
                  onRetry={() => void save()}
                  onReload={() => leave(onClose)}
                  disabled={!!busy}
                  labels={{
                    check: "核对原保存",
                    retry: "重新保存",
                    reload: "返回扩展目录",
                  }}
                />
              )}
            </>
          }
        />
      )}
      <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button
          disabled={
            !!busy ||
            frozen ||
            pending ||
            saveBlocked ||
            !dirty ||
            errors.length > 0 ||
            failure?.recovery === "reload"
          }
          onClick={() => void save()}
        >
          {busy && (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          )}
          {busy === "save"
            ? "正在保存…"
            : busy === "check"
              ? "正在核对…"
              : "保存扩展配置"}
        </Button>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() => leave(onClose)}
        >
          取消
        </Button>
        {waiting && (
          <p role="status" className="text-xs text-muted-foreground">
            请等待原操作结束后离开。
          </p>
        )}
      </footer>
      <SettingsConfirmDialog
        value={confirmation}
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => {
          const action = confirmation?.action
          setConfirmation(undefined)
          void action?.()
        }}
      />
    </div>
  )
}
