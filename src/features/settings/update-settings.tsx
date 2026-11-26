import { useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  ChevronDown,
  Download,
  ExternalLink,
  RefreshCw,
  RotateCcw,
} from "lucide-react"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import type { DesktopIssue } from "@/contracts/desktop.generated"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useDesktopService, useDesktopView } from "./desktop-service"
import { DesktopFeedback, desktopIssue, formatBytes } from "./settings-feedback"
import { useDesktopSettingsLeave } from "./use-desktop-settings-leave"

function formatCheckedAt(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (diffMinutes < 1) return "刚刚"
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  return date.toLocaleDateString()
}

function formatPlatform(platform: string, arch: string) {
  const osLabel =
    platform === "windows"
      ? "Windows"
      : platform === "macos"
        ? "macOS"
        : platform
  const archLabel = arch === "x86_64" ? "x64" : arch
  return `${osLabel} · ${archLabel}`
}

export function UpdateSettings({
  registerLeave,
}: {
  registerLeave?: (guard: LeaveGuard | null) => void
}) {
  const service = useDesktopService()
  const { snapshot, issue: stateIssue } = useDesktopView()
  const [commandIssue, setCommandIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const update = snapshot?.update
  const release = update?.release
  const frozen = snapshot?.maintenance.writesFrozen ?? false
  const disabled = busy || frozen

  useDesktopSettingsLeave(registerLeave, "ready")

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setCommandIssue(null)
    try {
      await action()
    } catch (error) {
      setCommandIssue(desktopIssue(error))
    } finally {
      setBusy(false)
    }
  }

  function openExternalUrl(url: string) {
    if (isTauri()) {
      void invoke("open_authorization_url", { url }).catch(() => {})
    } else {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }

  const downloadPercent =
    update?.phase === "downloading" &&
    update.totalBytes &&
    update.totalBytes > 0
      ? Math.min(
          100,
          Math.round((update.downloadedBytes / update.totalBytes) * 100)
        )
      : null

  const visibleError =
    update?.phase === "error" &&
    update.error &&
    update.error.code !== "activeSessions"
      ? update.error
      : null

  function statusSummary() {
    if (!update) return ""
    const checked = update.checkedAt ? formatCheckedAt(update.checkedAt) : ""
    switch (update.phase) {
      case "unavailable":
        return update.error?.message ?? "当前环境不支持自动更新"
      case "checking":
        return "正在检查更新…"
      case "upToDate":
        return checked ? `已是最新版本 · 上次检查 ${checked}` : "已是最新版本"
      case "available":
        return release ? `发现新版本 ${release.version}` : "发现新版本"
      case "downloading":
        return release ? `正在下载 Moon ${release.version}…` : "正在下载更新…"
      case "ready":
        return release
          ? `Moon ${release.version} 已就绪，重启后生效`
          : "更新已就绪，重启后生效"
      case "installing":
        return "正在准备重启更新…"
      case "error":
        if (update.error?.code === "activeSessions") {
          return release
            ? `Moon ${release.version} 已就绪，等待确认停止会话`
            : "等待确认停止会话"
        }
        return "更新未完成"
      case "idle":
      default:
        return checked ? `上次检查 ${checked}` : "尚未检查更新"
    }
  }

  function renderPrimaryAction() {
    if (!snapshot || !update) return null
    if (update.phase === "unavailable") return null

    if (update.phase === "checking" || update.phase === "downloading") {
      return (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          disabled={disabled}
          onClick={() =>
            void run(() => service.call("update_cancel", undefined))
          }
        >
          取消
        </Button>
      )
    }

    if (update.phase === "available" && release) {
      return (
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={disabled || !snapshot.capabilities.checkUpdates}
          onClick={() =>
            void run(() =>
              service.call("update_download", {
                releaseId: release.releaseId,
              })
            )
          }
        >
          <Download data-icon="inline-start" />
          下载更新
        </Button>
      )
    }

    if (update.phase === "ready" && release) {
      return (
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={disabled || !snapshot.capabilities.installUpdates}
          onClick={() =>
            void run(() =>
              service.call("update_install", {
                releaseId: release.releaseId,
                forceStop: false,
              })
            )
          }
        >
          <RefreshCw data-icon="inline-start" />
          重启并更新
        </Button>
      )
    }

    if (update.phase === "installing") {
      return (
        <Button type="button" size="sm" className="h-8" disabled>
          <Spinner data-icon="inline-start" />
          正在重启…
        </Button>
      )
    }

    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={disabled || !snapshot.capabilities.checkUpdates}
        onClick={() => void run(() => service.call("update_check", undefined))}
      >
        检查更新
      </Button>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header>
          <h2>关于与更新</h2>
        </header>

        {stateIssue && (
          <DesktopFeedback
            issue={stateIssue}
            onRefresh={() => void service.refresh()}
          />
        )}

        {snapshot && update && (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Moon {snapshot.version}</CardTitle>
                  <Badge variant="outline">
                    {formatPlatform(snapshot.platform, snapshot.architecture)}
                  </Badge>
                  {snapshot.development && (
                    <Badge variant="secondary">开发模式</Badge>
                  )}
                </div>
                <CardDescription
                  role="status"
                  className="flex items-center gap-1.5"
                >
                  {(update.phase === "checking" ||
                    update.phase === "downloading" ||
                    update.phase === "installing") && <Spinner />}
                  <span>{statusSummary()}</span>
                </CardDescription>
                <CardAction className="self-center">
                  {renderPrimaryAction()}
                </CardAction>
              </CardHeader>

              {update.phase === "downloading" && (
                <CardContent className="space-y-2 pt-0">
                  <Progress
                    className="h-1.5"
                    aria-label="更新下载进度"
                    value={downloadPercent}
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                    <span>
                      {formatBytes(update.downloadedBytes)}
                      {update.totalBytes !== null
                        ? ` / ${formatBytes(update.totalBytes)}`
                        : ""}
                    </span>
                    {downloadPercent !== null && (
                      <span>{downloadPercent}%</span>
                    )}
                  </div>
                </CardContent>
              )}

              {visibleError && (
                <CardContent className="space-y-3 border-t pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-foreground">
                      {visibleError.message}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={disabled}
                        onClick={() => {
                          if (
                            visibleError.code === "installFailed" &&
                            release
                          ) {
                            void run(() =>
                              service.call("update_install", {
                                releaseId: release.releaseId,
                                forceStop: false,
                              })
                            )
                          } else if (release) {
                            void run(() =>
                              service.call("update_download", {
                                releaseId: release.releaseId,
                              })
                            )
                          } else {
                            void run(() =>
                              service.call("update_check", undefined)
                            )
                          }
                        }}
                      >
                        <RotateCcw data-icon="inline-start" />
                        重试
                      </Button>
                      {release?.releaseUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => openExternalUrl(release.releaseUrl)}
                        >
                          <ExternalLink data-icon="inline-start" />
                          浏览器下载
                        </Button>
                      )}
                    </div>
                  </div>
                  {visibleError.detail && (
                    <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="-ml-2 text-muted-foreground"
                        >
                          {detailOpen ? "收起详情" : "查看详情"}
                          <ChevronDown data-icon="inline-end" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/50 p-2.5 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground">
                          {visibleError.detail}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              )}

              {snapshot.development &&
                !snapshot.capabilities.installUpdates &&
                update.phase === "ready" && (
                  <CardContent className="border-t pt-3 text-xs text-muted-foreground">
                    当前为开发模式，请在正式发行版本中安装更新。
                  </CardContent>
                )}
            </Card>

            {release && (
              <Card>
                <CardHeader>
                  <div className="flex items-baseline justify-between gap-4">
                    <CardTitle>Moon {release.version}</CardTitle>
                    {release.publishedAt && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {new Date(release.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </CardHeader>
                {release.notes.trim() && (
                  <CardContent>
                    <p className="settings-notes">{release.notes}</p>
                  </CardContent>
                )}
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>更新偏好</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                <div className="settings-preference pb-4 lg:pr-6 lg:pb-0">
                  <div>
                    <label
                      htmlFor="auto-check"
                      className="text-sm font-medium text-foreground"
                    >
                      自动检查更新
                    </label>
                    <p>启动后及每 6 小时静默检查新版本。</p>
                  </div>
                  <Switch
                    id="auto-check"
                    checked={snapshot.updatePreferences.autoCheck}
                    disabled={disabled || !snapshot.capabilities.checkUpdates}
                    onCheckedChange={(value) =>
                      void run(() =>
                        service.call("update_set_preferences", {
                          ...snapshot.updatePreferences,
                          autoCheck: value,
                        })
                      )
                    }
                  />
                </div>
                <div className="settings-preference pt-4 lg:pt-0 lg:pl-6">
                  <div>
                    <label
                      htmlFor="auto-download"
                      className="text-sm font-medium text-foreground"
                    >
                      自动下载更新
                    </label>
                    <p>发现新版本后后台下载并校验，准备好后提醒重启。</p>
                  </div>
                  <Switch
                    id="auto-download"
                    checked={snapshot.updatePreferences.autoDownload}
                    disabled={disabled || !snapshot.capabilities.checkUpdates}
                    onCheckedChange={(value) =>
                      void run(() =>
                        service.call("update_set_preferences", {
                          ...snapshot.updatePreferences,
                          autoDownload: value,
                        })
                      )
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {commandIssue && (
          <DesktopFeedback
            issue={commandIssue}
            onRefresh={() => void service.refresh()}
          />
        )}
      </div>
    </div>
  )
}
