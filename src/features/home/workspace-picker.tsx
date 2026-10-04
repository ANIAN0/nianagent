import { useEffect, useId, useRef, useState } from "react"
import {
  Folder,
  FolderOpen,
  ChevronDown,
  Check,
  Plus,
  LoaderCircle,
  CircleAlert,
  Info,
  TriangleAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import { cn } from "@/lib/utils"
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
  issue?: FeedbackDescription
  onRetry?: (signal?: AbortSignal) => void | Promise<void>
  disabled?: boolean
}
export function WorkspacePicker({
  workspaces,
  value,
  onChange,
  onChooseDirectory,
  loading = false,
  error = "",
  issue,
  onRetry,
  disabled = false,
}: WorkspacePickerProps) {
  const [busy, setBusy] = useState(false)
  const [localIssue, setLocalIssue] = useState<FeedbackDescription>()
  const [localRecovery, setLocalRecovery] = useState<"select" | "read">(
    "select"
  )
  const [busyAction, setBusyAction] = useState<"select" | "read">("select")
  const request = useRef<AbortController | null>(null)
  const [retrySelection, setRetrySelection] = useState<string | null>(null)
  const errorId = useId()
  const workspace = workspaces.find((item) => item.id === value)
  const unavailable: FeedbackDescription | undefined =
    workspace?.available === false
      ? {
          message:
            workspace.unavailableReason || "当前工作目录不可用，请重新选择。",
          code: "workspace_unavailable",
          severity: "warning",
          recovery: "reload",
        }
      : undefined
  const feedback =
    localIssue ??
    issue ??
    (error
      ? feedbackFromError(error, "工作目录未能读取，请重新读取。")
      : unavailable)
  const pending = busy || loading
  const missing = !workspace && !pending
  const FeedbackIcon =
    feedback?.severity === "info"
      ? Info
      : feedback?.severity === "warning"
        ? TriangleAlert
        : CircleAlert
  useEffect(
    () => () => {
      request.current?.abort()
    },
    []
  )
  async function run(
    action: (signal: AbortSignal) => void | Promise<void>,
    kind: "select" | "read" = "select"
  ) {
    if (request.current || disabled || loading) return
    const controller = new AbortController()
    request.current = controller
    setBusyAction(kind)
    setBusy(true)
    try {
      await action(controller.signal)
      controller.signal.throwIfAborted()
      if (request.current === controller) setLocalIssue(undefined)
    } catch (error) {
      if (!controller.signal.aborted && request.current === controller) {
        const failure = feedbackFromError(
          error,
          kind === "read"
            ? "工作目录列表未能读取，请重新读取。"
            : "工作目录未能选择，请重试。"
        )
        setLocalRecovery(kind)
        setLocalIssue(
          kind === "read" && failure.code === "cancelled"
            ? { ...failure, recovery: "reload" }
            : failure
        )
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (request.current === controller) request.current = null
    }
  }
  const reread = onRetry
    ? () => void run((signal) => onRetry(signal), "read")
    : undefined
  return (
    <div className="@container mb-3 px-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="选择工作目录"
              aria-busy={pending}
              aria-describedby={feedback ? errorId : undefined}
              disabled={pending || disabled}
              variant="ghost"
              className={cn(
                "h-7 max-w-full gap-1 px-2 text-[13px] leading-5 font-normal text-muted-foreground",
                missing &&
                  "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              )}
              title={workspace?.path ?? "选择工作目录后开始工作"}
            >
              {pending ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : workspace ? (
                <FolderOpen className="size-4" data-icon="inline-start" />
              ) : (
                <Folder className="size-4" data-icon="inline-start" />
              )}
              <span className="truncate">
                {loading || (busy && busyAction === "read")
                  ? "读取工作目录…"
                  : busy
                    ? "正在选择工作目录…"
                    : (workspace?.name ?? "选择工作目录")}
              </span>
              <ChevronDown
                className="size-3 text-caption"
                data-icon="inline-end"
              />
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
                      (other) =>
                        other.id !== item.id && other.name === item.name
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
          <div
            id={errorId}
            role={
              feedback.severity === "info" || feedback.severity === "warning"
                ? "status"
                : "alert"
            }
            className="flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 @lg:flex-1 @lg:basis-auto"
          >
            <FeedbackIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0",
                feedback.severity === "info"
                  ? "text-muted-foreground"
                  : feedback.severity === "warning"
                    ? "text-status-warning"
                    : "text-destructive"
              )}
            />
            <span className="min-w-0 flex-1 text-muted-foreground">
              {feedback.message}
            </span>
            <RecoveryAction
              issue={feedback}
              disabled={pending || disabled}
              className="h-7"
              onRetry={
                localIssue
                  ? localRecovery === "read"
                    ? reread
                    : () => {
                        if (retrySelection)
                          void run((signal) => onChange(retrySelection, signal))
                        else if (onChooseDirectory) void run(onChooseDirectory)
                      }
                  : reread
              }
              onReload={reread}
              onCheck={reread}
              labels={{ reload: "重新读取目录", check: "核对目录" }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
