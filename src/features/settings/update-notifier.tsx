import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { notifyToast } from "@/components/ui/notification-toast"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useOptionalDesktopService,
  useOptionalDesktopView,
} from "./desktop-service"

export function UpdateNotifier({
  onOpenUpdates,
  viewingUpdates,
}: {
  onOpenUpdates: () => void
  viewingUpdates: boolean
}) {
  const service = useOptionalDesktopService()
  const { snapshot } = useOptionalDesktopView()
  const notifiedReleaseRef = useRef<string | null>(null)
  const acknowledgedRef = useRef(false)
  const [stopping, setStopping] = useState(false)

  const update = snapshot?.update
  const release = update?.release
  const canInstall = Boolean(snapshot?.capabilities.installUpdates)

  // 新版本首次启动：弹出一次更新成功轻提示并清除标记
  useEffect(() => {
    if (!service || !snapshot || !update?.justUpdatedFrom) return
    if (acknowledgedRef.current) return
    acknowledgedRef.current = true
    notifyToast(`已更新至 Moon ${snapshot.version}`, {
      id: "moon-update-succeeded",
      tone: "success",
    })
    void service.call("update_acknowledge_updated", undefined).catch(() => {})
  }, [service, snapshot, update?.justUpdatedFrom])

  // 后台下载就绪：非打扰轻提示（4s 自动淡出），用户已在更新设置页时不重复提示
  useEffect(() => {
    if (!service || !update || update.phase !== "ready" || !release) return
    if (viewingUpdates) {
      notifiedReleaseRef.current = release.releaseId
      return
    }
    if (notifiedReleaseRef.current === release.releaseId) return
    notifiedReleaseRef.current = release.releaseId

    const toastId = `moon-update-ready-${release.releaseId}`
    notifyToast(`Moon ${release.version} 已准备就绪`, {
      id: toastId,
      tone: "info",
      actions: (
        <>
          {canInstall && (
            <button
              type="button"
              onClick={() => {
                toast.dismiss(toastId)
                void service
                  .call("update_install", {
                    releaseId: release.releaseId,
                    forceStop: false,
                  })
                  .catch(() => {
                    onOpenUpdates()
                  })
              }}
            >
              重启更新
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              toast.dismiss(toastId)
              onOpenUpdates()
            }}
          >
            查看
          </button>
        </>
      ),
    })
  }, [service, update, release, canInstall, viewingUpdates, onOpenUpdates])

  const activeSessionsError =
    update?.phase === "error" && update.error?.code === "activeSessions"
      ? update.error
      : null
  const hasActiveSessions = Boolean(
    activeSessionsError && activeSessionsError.activeSessions.length > 0
  )

  async function handleForceInstall() {
    if (!service || !release || stopping) return
    setStopping(true)
    try {
      await service.call("update_install", {
        releaseId: release.releaseId,
        forceStop: true,
      })
    } finally {
      setStopping(false)
    }
  }

  function handleDismiss() {
    if (!service || stopping) return
    void service.call("update_dismiss_error", undefined).catch(() => {})
  }

  return (
    <AlertDialog
      open={Boolean(activeSessionsError)}
      onOpenChange={(open) => {
        if (!open) handleDismiss()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {hasActiveSessions
              ? `停止运行中的会话并更新至 Moon ${release?.version ?? ""}？`
              : `无法确认当前工作已保存，仍要更新至 Moon ${release?.version ?? ""}？`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {hasActiveSessions
              ? "以下会话仍在运行，重启更新会先停止这些会话并保存已生成内容。"
              : (activeSessionsError?.message ??
                "当前无法确认会话与草稿已保存。你可以稍后重试，或选择仍然重启更新。")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {hasActiveSessions && activeSessionsError && (
          <ul className="max-h-40 space-y-1.5 overflow-auto rounded-lg border bg-muted/40 px-3 py-2 text-[13px] leading-5">
            {activeSessionsError.activeSessions.map((session) => (
              <li key={session.id} className="truncate">
                {session.title}
              </li>
            ))}
          </ul>
        )}
        {!hasActiveSessions && activeSessionsError?.detail && (
          <p className="max-h-32 overflow-auto rounded-lg border bg-muted/40 px-3 py-2 text-xs break-all whitespace-pre-wrap text-muted-foreground">
            {activeSessionsError.detail}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={stopping}>稍后</AlertDialogCancel>
          <Button disabled={stopping} onClick={() => void handleForceInstall()}>
            {stopping && <Spinner data-icon="inline-start" />}
            {hasActiveSessions ? "停止会话并重启更新" : "仍然重启更新"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
