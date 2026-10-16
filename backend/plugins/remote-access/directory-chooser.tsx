import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { callPlugin } from "@/features/plugins/plugin-service"
import type { WorkspaceRecord } from "@/contracts/rpc.generated"

type Listing = {
  path: string
  parent: string
  entries: { name: string; path: string }[]
  truncated: boolean
}
function DirectoryChooser({
  add,
  finish,
  signal,
}: {
  add: (path: string, signal?: AbortSignal) => Promise<WorkspaceRecord>
  finish: (value: WorkspaceRecord | null) => void
  signal: AbortSignal
}) {
  const [path, setPath] = useState("")
  const [listing, setListing] = useState<Listing>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(true)
  const [committing, setCommitting] = useState(false)
  const reading = useRef<AbortController | null>(null)
  async function browse(value: string) {
    reading.current?.abort()
    const controller = new AbortController()
    reading.current = controller
    setBusy(true)
    setError("")
    setPath(value)
    try {
      const result = await callPlugin<{ value: Listing }>(
        "remote-access",
        "directories",
        { path: value },
        undefined,
        AbortSignal.any([controller.signal, signal])
      )
      if (!controller.signal.aborted && !signal.aborted) {
        setListing(result.value)
        setPath(result.value.path)
      }
    } catch (error) {
      if (!controller.signal.aborted && !signal.aborted)
        setError(error instanceof Error ? error.message : "目录读取失败。")
    } finally {
      if (reading.current === controller && !signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    reading.current = controller
    void callPlugin<{ value: Listing }>("remote-access", "directories", { path: "" }, undefined, AbortSignal.any([controller.signal, signal]))
      .then((result) => {
        if (!controller.signal.aborted && !signal.aborted) {
          setListing(result.value)
          setPath(result.value.path)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && !signal.aborted) setError(error instanceof Error ? error.message : "目录读取失败。")
      })
      .finally(() => {
        if (reading.current === controller && !signal.aborted) setBusy(false)
      })
    return () => reading.current?.abort()
  }, [signal])
  async function confirm() {
    setBusy(true)
    setCommitting(true)
    setError("")
    try {
      const workspace = await add(path, signal)
      if (!signal.aborted) finish(workspace)
    } catch (error) {
      if (!signal.aborted)
        setError(error instanceof Error ? error.message : "主机目录未登记。")
    } finally {
      if (!signal.aborted) { setBusy(false); setCommitting(false) }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !committing) finish(null)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>选择Moon主机目录</DialogTitle>
          <DialogDescription>
            浏览电脑上的已有目录，登记后仅改变此网页的当前选择。
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="remote-directory">主机绝对路径</FieldLabel>
          <Input
            id="remote-directory"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void browse(path)
              }
            }}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void browse(path)}
          >
            浏览此目录
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void browse(listing?.parent || "")}
          >
            上一级 / 磁盘
          </Button>
        </div>
        <div
          className="flex max-h-64 flex-col overflow-auto"
          aria-label="主机目录列表"
        >
          {listing?.entries.map((item) => (
            <Button
              variant="ghost"
              className="justify-start"
              key={item.path}
              disabled={busy}
              onClick={() => void browse(item.path)}
            >
              {item.name}
            </Button>
          ))}
        </div>
        {listing?.truncated && <p>本层仅列出1000个目录，可输入完整路径。</p>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" disabled={committing} onClick={() => finish(null)}>
            取消
          </Button>
          <Button
            disabled={busy || !path.trim()}
            onClick={() => void confirm()}
          >
            登记并选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function chooseRemoteDirectory(
  add: (path: string, signal?: AbortSignal) => Promise<WorkspaceRecord>,
  signal?: AbortSignal
): Promise<WorkspaceRecord | null> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container),
      controller = new AbortController()
    let done = false
    const close = () => {
      controller.abort()
      signal?.removeEventListener("abort", abort)
      queueMicrotask(() => {
        root.unmount()
        container.remove()
      })
    }
    const finish = (value: WorkspaceRecord | null) => {
      if (!done) {
        done = true
        close()
        resolve(value)
      }
    }
    const abort = () => {
      if (!done) {
        done = true
        close()
        reject(signal?.reason ?? new DOMException("已取消选择。", "AbortError"))
      }
    }
    signal?.addEventListener("abort", abort, { once: true })
    root.render(
      <DirectoryChooser add={add} signal={controller.signal} finish={finish} />
    )
  })
}
