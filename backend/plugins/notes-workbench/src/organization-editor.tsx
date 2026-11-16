import { useRef, useState } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { NativeSelect } from "./ui/native-select"
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
      ? (action.item.parentId ?? "")
      : action.kind === "createDirectory"
        ? (action.parentId ?? "")
        : ""
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
    const fields = archived === undefined ? { name: name.trim() } : { archived }
    const signature = JSON.stringify({ action, fields, parentId })
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
          ...(parentId ? { parentId } : {}),
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
          ...(archived === undefined ? { parentId: parentId || null } : {}),
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
    <form
      aria-label={title}
      className="mx-2 mb-3 space-y-3 rounded-lg border bg-card p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onClose()
      }}
    >
      <p className="text-sm font-semibold">{title}</p>
      <Input
        autoFocus
        aria-label="名称"
        value={name}
        maxLength={64}
        disabled={saving}
        onChange={(event) => setName(event.target.value)}
      />
      {projectId && (
        <label className="block text-xs text-muted-foreground">
          父目录
          <NativeSelect
            aria-label="父目录"
            value={parentId}
            disabled={saving}
            onChange={(event) => setParentId(event.target.value)}
          >
            <option value="">项目根目录</option>
            {directories
              .filter(
                (directory) =>
                  directory.projectId === projectId &&
                  !directory.archivedAt &&
                  !descendant(directory)
              )
              .map((directory) => (
                <option key={directory.id} value={directory.id}>
                  {directory.name}
                </option>
              ))}
          </NativeSelect>
        </label>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={saving || !name.trim()}>
          {saving ? "保存中…" : "保存"}
        </Button>
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
      </div>
    </form>
  )
}
