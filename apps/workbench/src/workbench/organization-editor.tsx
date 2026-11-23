"use client"

import { useRef, useState } from "react"
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select"
import {
  newRequestKey,
  v2Api,
  v2Message,
  type V2Directory,
  type V2Project,
} from "./v2-api"

export type OrganizationAction =
  | { kind: "createProject" }
  | { kind: "createDirectory"; projectId: string; parentId?: string }
  | { kind: "project"; item: V2Project }
  | { kind: "directory"; item: V2Directory }

const ROOT_PARENT = "__root__"

export function OrganizationEditor({
  action,
  directories,
  onRefresh,
  onClose,
}: {
  action: OrganizationAction
  directories: V2Directory[]
  onRefresh: () => Promise<void>
  onClose: () => void
}) {
  const item = "item" in action ? action.item : undefined
  const [name, setName] = useState(item?.name ?? "")
  const [parentId, setParentId] = useState(
    action.kind === "directory"
      ? (action.item.parentId ?? ROOT_PARENT)
      : action.kind === "createDirectory"
        ? (action.parentId ?? ROOT_PARENT)
        : ROOT_PARENT
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const request = useRef({ signature: "", key: "" })
  const title =
    action.kind === "createProject"
      ? "新建项目"
      : action.kind === "createDirectory"
        ? "新建目录"
        : action.kind === "project"
          ? "管理项目"
          : "管理目录"
  const projectId =
    action.kind === "directory"
      ? action.item.projectId
      : action.kind === "createDirectory"
        ? action.projectId
        : null
  const descendant = (directory: V2Directory) => {
    if (action.kind !== "directory") return false
    let current: V2Directory | undefined = directory
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      if (current.id === action.item.id) return true
      visited.add(current.id)
      current = directories.find((value) => value.id === current?.parentId)
    }
    return false
  }
  const submit = async (archived?: boolean) => {
    if (saving) return
    const resolvedParent = parentId === ROOT_PARENT ? "" : parentId
    const fields = archived === undefined ? { name: name.trim() } : { archived }
    const signature = JSON.stringify({
      action,
      fields,
      parentId: resolvedParent,
    })
    if (request.current.signature !== signature)
      request.current = { signature, key: newRequestKey() }
    const requestKey = request.current.key
    setSaving(true)
    setError("")
    try {
      if (action.kind === "createProject")
        await v2Api.createProject({ name: name.trim(), requestKey })
      else if (action.kind === "createDirectory")
        await v2Api.createDirectory({
          projectId: action.projectId,
          ...(resolvedParent ? { parentId: resolvedParent } : {}),
          name: name.trim(),
          requestKey,
        })
      else if (action.kind === "project")
        await v2Api.updateProject({
          projectId: action.item.id,
          ...fields,
          requestKey,
        })
      else
        await v2Api.updateDirectory({
          directoryId: action.item.id,
          ...fields,
          ...(archived === undefined
            ? { parentId: resolvedParent || null }
            : {}),
          requestKey,
        })
      await onRefresh()
      onClose()
    } catch (cause) {
      setError(v2Message(cause))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          aria-label={title}
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="org-editor-name"
                className="text-xs font-medium text-muted-foreground"
              >
                名称
              </label>
              <Input
                id="org-editor-name"
                autoFocus
                aria-label="名称"
                placeholder="输入名称…"
                value={name}
                maxLength={64}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            {projectId && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  父目录
                </span>
                <Select
                  value={parentId}
                  disabled={saving}
                  onValueChange={setParentId}
                >
                  <SelectTrigger aria-label="父目录" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT_PARENT}>项目根目录</SelectItem>
                    {directories
                      .filter(
                        (directory) =>
                          directory.projectId === projectId &&
                          !directory.archivedAt &&
                          !descendant(directory)
                      )
                      .map((directory) => (
                        <SelectItem key={directory.id} value={directory.id}>
                          {directory.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            {item && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void submit(!item.archivedAt)}
              >
                {item.archivedAt ? "恢复" : "归档"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </Button>
            <Button size="sm" type="submit" disabled={saving || !name.trim()}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
