import { useContext, useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import type { MaterialPreview as Preview } from "@/features/models/model-contract.generated"
import type { Material } from "@/features/home/home-types"
import { MaterialServiceContext } from "./material-service"

export function MaterialPreviewDialog({ material, cwd, history = false, onClose }: { material: Material | null; cwd: string; history?: boolean; onClose: () => void }) {
  const service = useContext(MaterialServiceContext)
  const [result, setResult] = useState<{ key: string; data?: Preview; error?: string }>()
  const [revision, setRevision] = useState(0)
  const key = `${cwd}:${material?.id}`
  useEffect(() => {
    if (!material || !service) return
    const controller = new AbortController()
    void service.preview(cwd, material.id, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : String(error) })
    })
    return () => controller.abort()
  }, [service, cwd, material, key, revision])
  const current = result?.key === key ? result : undefined
  const label = material?.type === "image" ? history ? "发送时的图片" : "待发送图片" : material?.type === "skill" ? "本次 Skill 内容" : "当前文件"
  return <Dialog open={!!material} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[85dvh] max-w-[min(760px,calc(100vw-32px))] flex-col">
      <DialogHeader>
        <DialogTitle>{material?.name ?? "材料预览"}</DialogTitle>
        <DialogDescription className="break-all">{label} · {material?.source ?? material?.description}</DialogDescription>
      </DialogHeader>
      <div className="moon-scrollbar min-h-24 min-w-0 overflow-auto">
        {!service ? <p className="text-sm text-muted-foreground">展示环境未连接真实材料服务。</p> : current?.error ? <Alert variant="destructive"><AlertDescription>{current.error}<Button variant="link" onClick={() => { setResult(undefined); setRevision((value) => value + 1) }}>重新读取</Button></AlertDescription></Alert> : !current?.data ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在读取材料…</p> : current.data.data ? <img src={`data:${current.data.mimeType};base64,${current.data.data}`} alt={current.data.name} className="mx-auto max-h-[65dvh] max-w-full rounded-lg object-contain" /> : <pre className="whitespace-pre-wrap break-words text-sm leading-6">{current.data.content}</pre>}
      </div>
      {current?.data?.truncated && <p className="text-xs text-muted-foreground">已读取前128KiB，此处不是全文。</p>}
      {material?.type === "file" && <p className="text-xs text-muted-foreground">展示磁盘当前内容，文件引用不代表 Agent 已经读取。</p>}
    </DialogContent>
  </Dialog>
}
