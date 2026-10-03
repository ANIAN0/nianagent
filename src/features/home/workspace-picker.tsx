import { useEffect, useId, useRef, useState } from "react"
import {
  Folder,
  ChevronDown,
  Check,
  Plus,
  LoaderCircle,
  CircleAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import type { Workspace } from "./home-types"

export type WorkspacePickerProps = {
  workspaces: Workspace[]
  value: string
  onChange: (id: string, signal?: AbortSignal) => void | Promise<void>
  onChooseDirectory?: (signal: AbortSignal) => Promise<void>
  loading?: boolean
  error?: string
  onRetry?: () => void
  disabled?: boolean
}
export function WorkspacePicker({
  workspaces,
  value,
  onChange,
  onChooseDirectory,
  loading = false,
  error = "",
  onRetry,
  disabled = false,
}: WorkspacePickerProps) {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState("")
  const request = useRef<AbortController | null>(null)
  const [retrySelection, setRetrySelection] = useState<string | null>(null)
  const errorId = useId()
  const workspace = workspaces.find((item) => item.id === value)
  const unavailable =
    workspace?.available === false
      ? workspace.unavailableReason || "当前工作目录不可用，请重新选择。"
      : ""
  const feedback = localError || error || unavailable
  const pending = busy || loading
  useEffect(
    () => () => {
      request.current?.abort()
    },
    []
  )
  async function run(action: (signal: AbortSignal) => void | Promise<void>) {
    if (request.current || disabled || loading) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setLocalError("")
    try {
      await action(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted)
        setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (request.current === controller) request.current = null
    }
  }
  return (
    <div className="mb-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="选择工作目录"
            aria-busy={pending}
            aria-describedby={feedback ? errorId : undefined}
            disabled={pending || disabled}
            variant="ghost"
            className="ml-2 h-7 max-w-[calc(100%-16px)] gap-1 px-2 text-[13px] font-normal"
            title={workspace?.path}
          >
            {pending ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Folder data-icon="inline-start" />
            )}
            <span className="truncate">
              {loading
                ? "读取工作目录…"
                : busy
                  ? "正在选择工作目录…"
                  : (workspace?.name ?? "选择工作目录")}
            </span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          className="w-[220px] max-w-[calc(100vw-32px)] rounded-3xl p-1.5"
        >
          <DropdownMenuGroup className="max-h-64 overflow-y-auto">
            {workspaces.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={item.available === false || pending}
                onSelect={() => {
                  setRetrySelection(item.id)
                  void run((signal) => onChange(item.id, signal))
                }}
                className="min-h-10 gap-2 rounded-xl px-3"
                title={
                  item.available === false
                    ? `${item.path} — ${item.unavailableReason}`
                    : item.path
                }
              >
                <Folder />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.name}</span>
                  {workspaces.some(
                    (other) => other.id !== item.id && other.name === item.name
                  ) && (
                    <span className="truncate text-xs text-muted-foreground">
                      {item.path}
                    </span>
                  )}
                </span>
                {item.available === false ? (
                  <span className="shrink-0 text-xs">不可用</span>
                ) : (
                  workspace?.id === item.id && <Check aria-label="已选择" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {onChooseDirectory && (
            <>
              {!!workspaces.length && (
                <DropdownMenuSeparator className="mx-1" />
              )}
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="h-10 gap-2 rounded-xl px-3"
                  onSelect={() => {
                    setRetrySelection(null)
                    void run(onChooseDirectory)
                  }}
                >
                  <Plus />
                  添加工作区…
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          {!workspaces.length && !onChooseDirectory && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              尚未添加工作区
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {feedback && (
        <Alert id={errorId} variant="destructive" className="mt-2">
          <CircleAlert />
          <AlertDescription>
            <p>{feedback}</p>
            {localError || onRetry ? (
              <Button
                variant="link"
                size="sm"
                disabled={pending || disabled}
                onClick={() => {
                  if (localError && retrySelection)
                    void run((signal) => onChange(retrySelection, signal))
                  else if (localError && onChooseDirectory)
                    void run(onChooseDirectory)
                  else onRetry?.()
                }}
              >
                重试
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
