import { ConfigurationRecoveryPanel } from "@/features/models/configuration-recovery-panel"
import { useConfigurationRecoveries } from "@/features/models/configuration-recovery-store"
import { useCallback, useEffect, useRef, useState } from "react"
import { Puzzle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { RecoveryAction } from "@/components/feedback/recovery-action"
import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"
import type { ExtensionDescriptor, ExtensionService } from "./extension-service"
import {
  ExtensionEditor,
  retainedExtensionDescriptor,
} from "./extension-editor"

export type ExtensionConfigProps = {
  open: boolean
  onOpenChange(open: boolean): void
  service: ExtensionService
  onConfigured?(): void
}
export function ExtensionConfig({
  open,
  onOpenChange,
  service,
  onConfigured,
}: ExtensionConfigProps) {
  if (!open) return null
  return (
    <ExtensionConfigDialog
      onClose={() => onOpenChange(false)}
      service={service}
      onConfigured={onConfigured}
    />
  )
}
function ExtensionConfigDialog({
  onClose,
  service,
  onConfigured,
}: {
  onClose(): void
  service: ExtensionService
  onConfigured?(): void
}) {
  const recovery = useConfigurationRecoveries(service.evidence === "demo")
  const restoredIds = recovery.records
    .filter((record) => record.operation === "extensionConfigure")
    .map((record) => record.targetId)
  const [listing, setListing] = useState<{
    service: ExtensionService
    items: ExtensionDescriptor[]
    loading: boolean
    failure?: FeedbackDescription
  }>({ service, items: [], loading: true })
  const [editorState, setEditorState] = useState<{
    service: ExtensionService
    descriptor: ExtensionDescriptor
  }>()
  const [revision, refresh] = useState(0)
  const items = listing.service === service ? listing.items : []
  const loading = listing.service !== service || listing.loading
  const failure = listing.service === service ? listing.failure : undefined
  const editor =
    editorState?.service === service ? editorState.descriptor : undefined
  const setEditor = (descriptor?: ExtensionDescriptor) =>
    setEditorState(descriptor ? { service, descriptor } : undefined)
  const leaveGuard = useRef<{
    service: ExtensionService
    guard: (action: () => void) => void
  } | null>(null)
  const leave = (action: () => void) =>
    leaveGuard.current?.service === service
      ? leaveGuard.current.guard(action)
      : action()
  const registerLeave = useCallback(
    (guard: ((action: () => void) => void) | null) => {
      leaveGuard.current = guard ? { service, guard } : null
    },
    [service]
  )
  const reload = () => {
    setListing((old) => ({
      service,
      items: old.service === service ? old.items : [],
      loading: true,
    }))
    refresh((value) => value + 1)
  }
  useEffect(() => {
    const controller = new AbortController()
    void service
      .list(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setListing({ service, items: next, loading: false })
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setListing((old) => ({
            service,
            items: old.service === service ? old.items : [],
            loading: false,
            failure: feedbackFromError(reason, "无法读取扩展能力。"),
          }))
        }
      })
    return () => controller.abort()
  }, [service, revision])
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) leave(onClose)
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-32px)] flex-col gap-4 sm:max-w-[600px]"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>扩展能力</DialogTitle>
          <DialogDescription>
            应用级设置。保存后在空闲会话下一轮生效，不随本次会话配置的取消回滚。
          </DialogDescription>
        </DialogHeader>
        <div className="moon-scrollbar min-h-0 overflow-auto px-0.5">
          {!editor && (
            <ConfigurationRecoveryPanel
              service={service}
              operations={["extensionConfigure"]}
              onResolved={() => {
                reload()
                onConfigured?.()
              }}
            />
          )}
          {editor ? (
            <ExtensionEditor
              key={editor.id}
              descriptor={editor}
              service={service}
              registerLeave={registerLeave}
              onClose={() => setEditor(undefined)}
              onSaved={(keepOpen) => {
                if (!keepOpen) setEditor(undefined)
                reload()
                onConfigured?.()
              }}
            />
          ) : loading ? (
            <div
              role="status"
              aria-label="正在读取扩展能力"
              className="flex flex-col gap-3"
            >
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : failure ? (
            <OperationFeedback
              title="无法读取扩展能力"
              {...failure}
              actions={
                <RecoveryAction
                  issue={failure}
                  onRetry={reload}
                  onReload={reload}
                  labels={{ retry: "重新读取" }}
                />
              }
            />
          ) : !items.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>尚无扩展能力</EmptyTitle>
                <EmptyDescription>
                  已安装且兼容的应用扩展会显示在这里。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {items.map((item) => (
                <section
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <Puzzle
                          aria-hidden="true"
                          className="size-4 shrink-0"
                        />
                        {item.name}
                      </h3>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {item.state === "failed"
                        ? "加载失败"
                        : item.enabled
                          ? "已启用"
                          : "未启用"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.version} · {item.tools.length} 个工具 ·{" "}
                    {item.activeSessions} 个活动会话
                  </p>
                  {item.issue && (
                    <OperationFeedback
                      title="扩展需要处理"
                      {...feedbackFromError({ issue: item.issue })}
                      actions={
                        <RecoveryAction
                          issue={feedbackFromError({ issue: item.issue })}
                        />
                      }
                    />
                  )}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        item.state === "failed" || restoredIds.includes(item.id)
                      }
                      onClick={() =>
                        setEditor(
                          retainedExtensionDescriptor(service, item.id) ?? item
                        )
                      }
                    >
                      {retainedExtensionDescriptor(service, item.id)
                        ? "核对原保存"
                        : "配置"}
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        {!editor && (
          <div className="flex justify-end border-t pt-3">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
