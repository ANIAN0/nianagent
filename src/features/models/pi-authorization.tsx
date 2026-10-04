import {
  retainConfigurationAttempt,
  finishConfigurationAttempt,
} from "./configuration-recovery-store"
import { useEffect, useRef, useState } from "react"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import type { AuthState, ModelConnection, ModelService } from "./model-types"
export function PiAuthorization({
  connection,
  service,
  onComplete,
  onClose,
  onCancelled,
}: {
  connection: ModelConnection
  service: ModelService
  onComplete: (connection: ModelConnection, issue?: FeedbackDescription) => void
  onClose: () => void
  onCancelled?: (
    connection: ModelConnection,
    issue?: FeedbackDescription
  ) => void
}) {
  const [state, setState] = useState<AuthState>()
  const [value, setValue] = useState("")
  const [failure, setFailure] = useState<FeedbackDescription>()
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const closingRef = useRef(false)
  const cancelIntent = useRef(false)
  const owner = useRef<AbortController | null>(null)
  const replyRequest = useRef<AbortController | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const job = useRef<string | undefined>(undefined)
  const receiveRef = useRef<(result: AuthState) => void>(() => {})
  const complete = useRef(onComplete)
  const cancelled = useRef(onCancelled)
  useEffect(() => {
    complete.current = onComplete
    cancelled.current = onCancelled
  }, [onComplete, onCancelled])
  useEffect(() => {
    const controller = new AbortController()
    owner.current = controller
    const auth = service.auth!
    let epoch = 0
    let started = false
    let retained = false
    // The client knows the job ID before start crosses the transport.
    const operationRequestId = crypto.randomUUID()
    job.current = undefined
    function fail(reason: unknown) {
      if (
        !controller.signal.aborted &&
        owner.current === controller &&
        !closingRef.current &&
        !cancelIntent.current
      ) {
        const issue = feedbackFromError(
          reason,
          retained ? "订阅授权未完成。" : "恢复身份无法保存，未启动授权。"
        )
        if (
          retained &&
          issue.code !== "result_unknown" &&
          issue.recovery !== "check"
        ) {
          finishConfigurationAttempt(
            "authStart",
            operationRequestId,
            service.evidence === "demo"
          )
          job.current = undefined
        }
        setFailure(issue)
      }
    }
    function receive(result: AuthState) {
      if (controller.signal.aborted || owner.current !== controller) {
        void auth.cancel(result.id).catch(() => {})
        return
      }
      job.current = result.id
      if (closingRef.current || cancelIntent.current) return
      clearTimeout(timer.current)
      epoch += 1
      setFailure(undefined)
      setState(result)
      if (result.status === "complete" && result.issue?.recovery !== "check") {
        finishConfigurationAttempt(
          "authStart",
          result.id,
          service.evidence === "demo"
        )
        complete.current(
          result.connection,
          result.issue ? feedbackFromError({ issue: result.issue }) : undefined
        )
        return
      }
      if (result.status !== "pending") {
        if (result.issue?.recovery !== "check")
          finishConfigurationAttempt(
            "authStart",
            result.id,
            service.evidence === "demo"
          )
        setFailure(
          result.issue
            ? feedbackFromError({ issue: result.issue })
            : result.status === "cancelled"
              ? {
                  code: "cancelled",
                  message: "授权已取消，连接草稿保留。",
                  severity: "info",
                  recovery: "none",
                }
              : feedbackFromError(
                  result.error,
                  "服务未能完成授权，请关闭后重新开始。"
                )
        )
        return
      }
      const currentEpoch = epoch
      timer.current = setTimeout(() => {
        void auth
          .poll(result.id, controller.signal)
          .then((next) => {
            if (currentEpoch === epoch) receive(next)
          })
          .catch(fail)
      }, 800)
    }
    receiveRef.current = receive
    // Preparation and start share one asynchronous lifecycle. Persist identity
    // before the RPC, and let StrictMode/close abort before any preparation.
    const starting = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      if (cancelIntent.current || closingRef.current)
        throw new DOMException("授权准备已取消。", "AbortError")
      retainConfigurationAttempt(
        {
          operation: "authStart",
          operationRequestId,
          targetId: connection.id,
          revision: connection.revision,
        },
        service.evidence === "demo"
      )
      retained = true
      job.current = operationRequestId
      started = true
      return auth.start(
        connection,
        new AbortController().signal,
        operationRequestId
      )
    })
    void starting.then(receive).catch(fail)
    return () => {
      controller.abort()
      if (owner.current === controller) {
        owner.current = null
        replyRequest.current?.abort()
        clearTimeout(timer.current)
      }
      if (retained) {
        // The effect owns this exact identity, never a later owner's ref.
        if (!started)
          finishConfigurationAttempt(
            "authStart",
            operationRequestId,
            service.evidence === "demo"
          )
        else
          void auth
            .cancel(operationRequestId)
            .then(() =>
              finishConfigurationAttempt(
                "authStart",
                operationRequestId,
                service.evidence === "demo"
              )
            )
            .catch(() => {})
      }
    }
  }, [connection, service])
  async function close() {
    if (closingRef.current) return
    closingRef.current = true
    cancelIntent.current = true
    setCancelRequested(true)
    setClosing(true)
    setFailure(undefined)
    clearTimeout(timer.current)
    replyRequest.current?.abort()
    replyRequest.current = null
    setBusy(false)
    const scope = owner.current
    try {
      if (job.current) await service.auth!.cancel(job.current)
      if (!scope || scope.signal.aborted || owner.current !== scope) return
      // Cancellation settles the exact job, including a start still preparing.
      const final = job.current
        ? await service.auth!.poll(job.current, scope.signal)
        : undefined
      if (
        final?.issue?.code === "result_unknown" ||
        final?.issue?.recovery === "check"
      )
        throw { issue: final.issue }
      if (final?.status === "pending")
        throw Object.assign(new Error("授权任务仍在结束处理中。"), {
          issue: {
            code: "result_unknown",
            summary: "授权任务仍在结束处理中，请稍后核对原任务。",
            recovery: "check",
            severity: "warning",
          },
        })
      if (job.current)
        finishConfigurationAttempt(
          "authStart",
          job.current,
          service.evidence === "demo"
        )
      const saved =
        final?.connection.revision !== undefined
          ? final.connection
          : (await service.list(scope.signal)).find(
              (item) => item.id === connection.id
            )
      if (scope.signal.aborted || owner.current !== scope) return
      if (saved) {
        ;(cancelled.current ?? complete.current)(
          saved,
          final?.issue ? feedbackFromError({ issue: final.issue }) : undefined
        )
        return
      }
      onClose()
    } catch (reason) {
      if (scope && !scope.signal.aborted && owner.current === scope) {
        closingRef.current = false
        setClosing(false)
        setFailure(
          feedbackFromError(
            reason,
            "未能确认授权取消后的连接状态，请保留此窗口并再次关闭。"
          )
        )
      }
    }
  }
  async function checkJob() {
    // A close intent never becomes another login or a prompt submission.
    // Repeat cancellation and read the exact original job until it has settled.
    if (cancelIntent.current) {
      await close()
      return
    }
    const scope = owner.current
    if (!scope || !job.current || closingRef.current) return
    try {
      const next = await service.auth!.poll(job.current, scope.signal)
      if (!scope.signal.aborted && owner.current === scope)
        receiveRef.current(next)
    } catch (reason) {
      if (!scope.signal.aborted && owner.current === scope)
        setFailure(feedbackFromError(reason, "暂时无法核对原授权任务。"))
    }
  }
  async function reply() {
    if (!state?.prompt || busy || closingRef.current || cancelIntent.current)
      return
    const request = new AbortController()
    replyRequest.current = request
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await service.auth!.reply(
        state.id,
        state.prompt.id,
        value,
        request.signal
      )
      request.signal.throwIfAborted()
      if (replyRequest.current !== request || closingRef.current) return
      setValue("")
      receiveRef.current(result)
    } catch (reason) {
      if (
        !request.signal.aborted &&
        replyRequest.current === request &&
        !closingRef.current
      )
        setFailure(feedbackFromError(reason, "未能提交授权信息，输入已保留。"))
    } finally {
      if (replyRequest.current === request && !request.signal.aborted) {
        replyRequest.current = null
        setBusy(false)
      }
    }
  }
  async function open(url: string) {
    const scope = owner.current
    try {
      if (new URL(url).protocol !== "https:")
        throw new Error("授权链接必须为 HTTPS。")
      if (isTauri()) await invoke("open_authorization_url", { url })
      else window.open(url, "_blank", "noopener,noreferrer")
    } catch (reason) {
      if (scope && !scope.signal.aborted && owner.current === scope)
        setFailure(
          feedbackFromError(reason, "未能打开授权页面，请检查系统浏览器。")
        )
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !closingRef.current) void close()
      }}
    >
      <DialogContent
        className="sm:max-w-[520px]"
        showCloseButton={!closing}
        onEscapeKeyDown={(event) => {
          if (closing) event.preventDefault()
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>订阅账号授权</DialogTitle>
          <DialogDescription>
            {connection.name} ·{" "}
            {service.evidence === "demo"
              ? "示例授权，不连接真实账号"
              : "Pi 授权服务"}
            。开始授权会先保存此连接；取消授权不撤销该保存。
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-auto text-sm">
          {!state && !failure && !closing && (
            <p role="status">正在连接授权服务…</p>
          )}
          {state?.events.map((event, index) => (
            <div key={index} className="flex flex-col gap-2">
              {event.message && <p>{event.message}</p>}
              {event.instructions && <p>{event.instructions}</p>}
              {event.userCode && (
                <p>
                  设备码：
                  <strong className="select-all">{event.userCode}</strong>
                </p>
              )}
              {(event.url || event.verificationUri) && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void open((event.url || event.verificationUri)!)
                  }
                >
                  打开授权页面
                </Button>
              )}
              {event.links?.map((link) => (
                <Button
                  key={link.url}
                  variant="link"
                  onClick={() => void open(link.url)}
                >
                  {link.label || "打开服务链接"}
                </Button>
              ))}
            </div>
          ))}
          {state?.prompt && (
            <Field>
              <FieldLabel htmlFor="pi-auth-input">
                {state.prompt.message}
              </FieldLabel>
              {state.prompt.type === "select" ? (
                <Select
                  value={value}
                  onValueChange={setValue}
                  disabled={busy || closing || cancelRequested}
                >
                  <SelectTrigger id="pi-auth-input">
                    <SelectValue placeholder="请选择" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {state.prompt.options?.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="pi-auth-input"
                  type={state.prompt.type === "secret" ? "password" : "text"}
                  autoComplete="off"
                  disabled={busy || closing || cancelRequested}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={state.prompt.placeholder}
                />
              )}
            </Field>
          )}
          {failure && (
            <OperationFeedback
              title={
                failure.code === "cancelled"
                  ? "授权已取消"
                  : cancelRequested
                    ? "原授权的结束状态待核对"
                    : "授权未完成"
              }
              {...failure}
              actions={
                <RecoveryAction
                  issue={failure}
                  onRetry={() => void checkJob()}
                  onReload={() => void checkJob()}
                  onCheck={() => void checkJob()}
                  disabled={closing || busy}
                  labels={{
                    retry: cancelRequested
                      ? "核对并结束原授权"
                      : "核对原授权任务",
                    reload: cancelRequested
                      ? "核对并结束原授权"
                      : "核对原授权任务",
                    check: cancelRequested
                      ? "核对并结束原授权"
                      : "核对原授权任务",
                  }}
                />
              }
            />
          )}
          {closing && (
            <p role="status" className="text-muted-foreground">
              正在取消授权并读取连接状态…
            </p>
          )}
          {state?.status === "pending" && !closing && !cancelRequested && (
            <p role="status" className="text-muted-foreground">
              {state.stage === "preparing"
                ? "正在保存连接并准备授权；可随时取消。"
                : state.stage === "settling"
                  ? "正在完成授权清理；原任务仍保留，可取消并核对。"
                  : "等待授权完成；可随时取消。"}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={closing}
            onClick={() => void close()}
          >
            {closing ? "正在取消…" : "关闭并取消"}
          </Button>
          {state?.prompt && (
            <Button
              disabled={busy || closing || cancelRequested || !value.trim()}
              onClick={() => void reply()}
            >
              提交
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
