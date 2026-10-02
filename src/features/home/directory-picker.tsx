import { useState } from "react"
import {
  ArrowRight,
  ChevronRight,
  Folder,
  PencilLine,
  Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { Workspace } from "./home-types"
export type DirectoryPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  directories: Workspace[]
  onSelect: (directory: Workspace) => void
}
export function DirectoryPicker({
  open,
  onOpenChange,
  directories,
  onSelect,
}: DirectoryPickerProps) {
  const [path, setPath] = useState("")
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState("")
  const [hidden, setHidden] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [extra, setExtra] = useState<Workspace[]>([])
  const items = [...directories, ...extra]
    .filter((item) => !path || item.path.startsWith(`${path}/`))
    .filter((item) => hidden || !item.name.startsWith("."))
  const chosen = [...directories, ...extra].find((item) => item.path === path)
  function openPath() {
    const next = input.trim().replaceAll("\\", "/").replace(/\/$/, "")
    if (next) {
      setPath(next)
      setEditing(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[500px] max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-[680px]"
        onOpenAutoFocus={() => {
          setPath("")
          setEditing(false)
          setCreating(false)
          setName("")
        }}
      >
        <DialogTitle className="px-6 pt-5 text-base">选择工作目录</DialogTitle>
        <DialogDescription className="sr-only">
          浏览示例目录；添加的工作区和文件夹只保存在当前页面，不读写磁盘。
        </DialogDescription>
        <div className="flex min-h-12 items-center gap-2 border-b px-6 py-2">
          {editing ? (
            <>
              <Input
                autoFocus
                aria-label="目录路径"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    openPath()
                  }
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="前往目录"
                disabled={!input.trim()}
                onClick={openPath}
              >
                <ArrowRight />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="px-0 font-normal"
                onClick={() => setPath("")}
              >
                主目录
              </Button>
              {path && (
                <>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate text-[13px]"
                    title={path}
                  >
                    {path}
                  </span>
                </>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                aria-label="编辑路径"
                onClick={() => {
                  setInput(path)
                  setEditing(true)
                }}
              >
                <PencilLine className="size-4" />
              </Button>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {creating && (
            <form
              className="mb-2 flex gap-2 px-2"
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const next = name.trim()
                if (!next || /[\\/:*?"<>|]/.test(next)) return
                const nextPath = `${path || "H:/workspace"}/${next}`
                if (
                  ![...directories, ...extra].some(
                    (item) => item.path === nextPath
                  )
                )
                  setExtra([
                    ...extra,
                    { id: nextPath, name: next, path: nextPath },
                  ])
                setCreating(false)
                setName("")
              }}
            >
              <Input
                autoFocus
                aria-label="新文件夹名称"
                placeholder="新文件夹名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!name.trim() || /[\\/:*?"<>|]/.test(name)}
              >
                创建
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreating(false)}
              >
                取消
              </Button>
            </form>
          )}
          {items.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2 font-normal"
              onClick={() => setPath(item.path)}
            >
              <Folder className="size-4 text-muted-foreground" />
              <span className="truncate">{item.name}</span>
              <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />
            </Button>
          ))}
          {!items.length && !creating && (
            <p className="py-12 text-center text-xs text-muted-foreground">
              此示例目录下没有子文件夹
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-6 py-4">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => {
              setCreating(true)
              setName("")
            }}
          >
            <Plus className="size-3.5" />
            新建文件夹
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={hidden}
              onCheckedChange={(value) => setHidden(value === true)}
            />
            显示隐藏文件
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full px-4"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-foreground px-4 text-background hover:bg-foreground/90"
              disabled={!path}
              onClick={() => {
                onSelect(
                  chosen ?? {
                    id: path,
                    name: path.split("/").at(-1) || path,
                    path,
                  }
                )
                onOpenChange(false)
              }}
            >
              打开
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
