"use client"

import { useState } from "react"
import { Button } from "@/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import { Input } from "@/ui/input"
import { Textarea } from "@/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ui/select"
import { api, type SkillDetail } from "./api"

export type PromptDialogConfig = {
  title: string
  placeholder: string
  defaultValue?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: (value: string) => void
}

export function CreateSkillDialog({
  open,
  onOpenChange,
  onSubmit,
  error,
}: {
  error: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: {
    slug: string
    name: string
    description: string
    reason: string
  }) => Promise<boolean>
}) {
  const [slug, setSlug] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [reason, setReason] = useState("初始化 Skill")
  const [pending, setPending] = useState(false)
  const canSubmit = Boolean(slug.trim() && name.trim() && description.trim()) && !pending

  const handleConfirm = async () => {
    if (!canSubmit) return
    setPending(true)
    try {
      const saved = await onSubmit({
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim(),
        reason: reason.trim() || "初始化 Skill",
      })
      if (!saved) return
      setSlug("")
      setName("")
      setDescription("")
      setReason("初始化 Skill")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建 Skill</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <Input
            aria-label="英文标识"
            disabled={pending}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="英文标识 slug（如 api-contract-review）"
            className="h-8 font-mono text-xs"
          />
          <Input
            aria-label="Skill 显示名称"
            disabled={pending}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill 显示名称"
            className="h-8 text-xs"
          />
          <Textarea
            aria-label="触发描述"
            disabled={pending}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="触发描述（写入 SKILL.md frontmatter description）"
            className="text-xs"
          />
          <Input
            aria-label="创建原因"
            disabled={pending}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="创建原因"
            className="h-8 text-xs"
          />
        </div>
        {error && <p role="alert" className="break-all text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            onClick={() => void handleConfirm()}
          >
            {pending ? "创建中…" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


export function ExportSkillDialog({
  detail,
  onClose,
  onExported,
}: {
  detail: SkillDetail
  onClose: () => void
  onExported: (notice: string) => void
}) {
  const [targetDir, setTargetDir] = useState(detail.skill.exportDir)
  const [version, setVersion] = useState("0")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const parent = targetDir.trim()
  const separator = parent.includes("\\") ? "\\" : "/"
  const skillDir = parent
    ? parent.replace(/[/\\]+$/, "") + separator + detail.skill.slug
    : detail.skill.slug

  const handleExport = async () => {
    if (!parent || pending) return
    setPending(true)
    setError("")
    try {
      const result = await api<{ skillDir: string; cleanupPending: boolean }>(
        "/api/skills/" + encodeURIComponent(detail.skill.id) + "/export",
        { method: "POST", body: JSON.stringify({ targetDir: parent, versionNumber: Number(version) }) }
      )
      const cleanup = result.cleanupPending ? "。导出清理待完成，下次向此路径导出时可重试。" : "。"
      onExported("已导出至 " + result.skillDir + cleanup)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出 Skill</DialogTitle>
          <DialogDescription>将整体替换目标目录，清除选定版本中不存在的文件。</DialogDescription>
        </DialogHeader>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(event) => {
          event.preventDefault()
          void handleExport()
        }}>
          <Select value={version} onValueChange={setVersion} disabled={pending}>
            <SelectTrigger aria-label="导出版本">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="0">当前草稿</SelectItem>
                {detail.versions.map(({ versionNumber }) => (
                  <SelectItem key={versionNumber} value={String(versionNumber)}>V{versionNumber}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            aria-label="导出父目录"
            placeholder="导出父目录绝对路径"
            value={targetDir}
            disabled={pending}
            onChange={(event) => setTargetDir(event.target.value)}
          />
          {parent && <p className="break-all text-xs text-muted-foreground">{skillDir}</p>}
          {error && <p role="alert" className="break-all text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onClose}>取消</Button>
            <Button type="submit" size="sm" disabled={!parent || pending}>
              {pending ? "导出中…" : "导出并替换"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PromptReasonDialog({
  config,
  onClose,
}: {
  config: PromptDialogConfig | null
  onClose: () => void
}) {
  const [value, setValue] = useState(() => config?.defaultValue ?? "")

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || !config) return
    const handler = config.onConfirm
    onClose()
    handler(trimmed)
  }

  return (
    <Dialog open={Boolean(config)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{config?.title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder={config?.placeholder}
          className="h-8 text-xs"
        />
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            variant={config?.destructive ? "destructive" : "default"}
            disabled={!value.trim()}
            onClick={handleSubmit}
          >
            {config?.confirmLabel || "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDeleteSkillDialog({
  skillName,
  onClose,
  onConfirm,
}: {
  skillName: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(skillName)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>删除 Skill</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-muted-foreground">
          确定要删除「<span className="font-medium text-foreground">{skillName}</span>
          」及其全部版本和历史记录吗？此操作不可撤销。
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
