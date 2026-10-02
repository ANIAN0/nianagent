import { useEffect, useRef, useState } from "react"
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
}: {
  connection: ModelConnection
  service: ModelService
  onComplete: (connection: ModelConnection) => void
  onClose: () => void
}) {
  const [state, setState] = useState<AuthState>()
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const job = useRef<string>(undefined)
  const starting = useRef<Promise<AuthState>>(undefined)
  const complete = useRef(onComplete)
  useEffect(() => {
    complete.current = onComplete
  }, [onComplete])
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const auth = service.auth!
    async function receive(result: AuthState) {
      job.current = result.id
      if (controller.signal.aborted) {
        await auth.cancel(result.id)
        return
      }
      setState(result)
      if (result.status === "complete") {
        complete.current(result.connection)
        return
      }
      if (result.status !== "pending") {
        setError(result.error || "授权未完成。")
        return
      }
      timer = setTimeout(() => {
        void auth.poll(result.id, controller.signal).then(receive).catch(fail)
      }, 800)
    }
    function fail(reason: unknown) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "授权失败。")
    }
    // Do not abort the start transport: always receive the job ID so cleanup can cancel it.
    // StrictMode immediately cleans up its probe effect. Start only after that probe,
    // so it cannot save twice or cancel the real authorization job.
    starting.current = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return auth.start(connection, new AbortController().signal)
    })
    void starting.current.then(receive).catch(fail)
    return () => {
      controller.abort()
      clearTimeout(timer)
      if (job.current) void auth.cancel(job.current).catch(() => {})
    }
  }, [connection, service])
  async function close() {
    setBusy(true)
    try {
      const current = await starting.current
      if (current) await service.auth!.cancel(current.id)
      const saved = (await service.list(new AbortController().signal)).find(
        (item) => item.id === connection.id
      )
      if (saved) {
        complete.current(saved)
        return
      }
    } catch {
      /* A failed start may not have persisted a connection. */
    }
    onClose()
  }
  async function reply() {
    if (!state?.prompt) return
    setBusy(true)
    setError("")
    try {
      setState(
        await service.auth!.reply(
          state.id,
          state.prompt.id,
          value,
          new AbortController().signal
        )
      )
      setValue("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提交失败。")
    } finally {
      setBusy(false)
    }
  }
  async function open(url: string) {
    try {
      if (new URL(url).protocol !== "https:")
        throw new Error("授权链接必须为 HTTPS。")
      if (isTauri()) await invoke("open_authorization_url", { url })
      else window.open(url, "_blank", "noopener,noreferrer")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开授权链接。")
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) void close()
      }}
    >
      <DialogContent
        className="sm:max-w-[520px]"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>订阅账号授权</DialogTitle>
          <DialogDescription>
            {connection.name} · Pi 授权服务。开始授权会先保存此连接。
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-auto text-sm">
          {!state && !error && <p role="status">正在连接授权服务…</p>}
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
                <Select value={value} onValueChange={setValue}>
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
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={state.prompt.placeholder}
                />
              )}
            </Field>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {state?.status === "pending" && (
            <p role="status" className="text-muted-foreground">
              等待授权完成；可随时取消。
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void close()}
          >
            关闭并取消
          </Button>
          {state?.prompt && (
            <Button
              disabled={busy || !value.trim()}
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
