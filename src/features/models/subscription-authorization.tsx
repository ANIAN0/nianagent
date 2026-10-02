import { useEffect, useRef, useState } from "react"
import { LoaderCircle, Copy, CircleCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import type { ModelConnection, ModelService } from "./model-types"

export function SubscriptionAuthorization({
  name,
  service,
  expiresAfter = 180,
  onComplete,
  onClose,
}: {
  name: string
  service: ModelService
  expiresAfter?: number
  onComplete: (account: NonNullable<ModelConnection["account"]>) => void
  onClose: () => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [seconds, setSeconds] = useState(expiresAfter)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [step, setStep] = useState<"device" | "prompt" | "select">("device")
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [scope, setScope] = useState("")
  const request = useRef<AbortController | null>(null)
  const complete = useRef(onComplete)
  useEffect(() => {
    complete.current = onComplete
  }, [onComplete])
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    let remaining = expiresAfter
    const timer = setInterval(() => {
      remaining -= 1
      setSeconds(Math.max(0, remaining))
      if (remaining <= 0) {
        controller.abort()
        clearInterval(timer)
        setBusy(false)
        setError("设备码已过期，请重新开始。")
      }
    }, 1000)
    service
      .authorize(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.kind === "complete") complete.current(result.account)
        else setStep(result.kind)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          clearInterval(timer)
          setError(
            reason instanceof Error ? reason.message : "授权失败，请重试。"
          )
        }
      })
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [attempt, expiresAfter, service])
  async function advance() {
    const controller = request.current
    if (!controller || controller.signal.aborted) return
    setBusy(true)
    try {
      const result = await service.authorize(controller.signal, {
        confirmation,
        scope,
      })
      if (controller.signal.aborted) return
      if (result.kind === "complete") complete.current(result.account)
      else setStep(result.kind)
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "授权失败，请重试。"
        )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="sm:max-w-[480px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>订阅账号授权</DialogTitle>
          <DialogDescription>{name} · 订阅服务</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : step === "device" ? (
            <>
              <p>在服务授权页面输入设备码。</p>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">设备码</span>
                <strong className="text-lg tracking-widest">A6K9-4821</strong>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="复制设备码"
                  onClick={() => {
                    navigator.clipboard
                      .writeText("A6K9-4821")
                      .then(() => setCopied(true))
                      .catch(() => setError("无法复制，请手动选择设备码。"))
                  }}
                >
                  {copied ? <CircleCheck /> : <Copy />}
                </Button>
              </div>
              <p role="status" className="flex items-center gap-2">
                <LoaderCircle className="size-4 motion-safe:animate-spin" />
                等待授权服务响应…
              </p>
            </>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="oauth-confirmation">
                  {step === "prompt"
                    ? "输入服务要求的确认信息"
                    : "选择授权范围"}
                </FieldLabel>
                {step === "prompt" ? (
                  <Input
                    id="oauth-confirmation"
                    autoFocus
                    autoComplete="off"
                    value={confirmation}
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                ) : (
                  <Select
                    value={scope}
                    onValueChange={setScope}
                    disabled={busy}
                  >
                    <SelectTrigger aria-label="授权范围" className="w-full">
                      <SelectValue placeholder="选择范围" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="models">访问模型目录</SelectItem>
                        <SelectItem value="models-profile">
                          访问模型目录与账号资料
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                <FieldDescription>
                  本地演示，请使用任意示例文字，不要填写真实凭据。
                </FieldDescription>
              </Field>
            </FieldGroup>
          )}
          {!error && (
            <p className="text-xs text-muted-foreground">
              有效期剩余 {seconds} 秒
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            此流程使用模拟授权服务，不连接真实账号。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消授权
          </Button>
          {error ? (
            <Button
              onClick={() => {
                setError("")
                setSeconds(expiresAfter)
                setStep("device")
                setConfirmation("")
                setScope("")
                setAttempt((value) => value + 1)
              }}
            >
              重新开始
            </Button>
          ) : (
            step !== "device" && (
              <Button
                disabled={
                  busy || (step === "prompt" ? !confirmation.trim() : !scope)
                }
                onClick={() => void advance()}
              >
                {busy
                  ? "正在确认…"
                  : step === "prompt"
                    ? "提交确认信息"
                    : "确认授权范围"}
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
