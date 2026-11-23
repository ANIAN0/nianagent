import { useState } from "react"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { SettingsConfirmDialog } from "@/components/operations/settings-confirmation"
import { useDesktopSettingsLeave } from "./use-desktop-settings-leave"
import { RefreshCw } from "lucide-react"
import type { DesktopIssue, UpdatePhase } from "@/contracts/desktop.generated"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { useDesktopService, useDesktopView } from "./desktop-service"
import {
  ActivityList,
  DesktopFeedback,
  desktopIssue,
  formatBytes,
} from "./settings-feedback"

const phaseLabels: Record<UpdatePhase, string> = {
  unavailable: "当前环境无法更新",
  idle: "尚未检查更新",
  checking: "正在检查更新…",
  current: "已是最新版本",
  available: "发现新版本",
  downloading: "正在下载更新…",
  verifying: "正在验证更新签名…",
  ready: "更新已下载并验证",
  preparing: "正在准备安装…",
  handedOff: "已交给安装程序，等待重新启动确认",
  succeeded: "更新成功",
  failed: "更新未完成",
  unknown: "上次更新结果待核对",
}
export function UpdateSettings({
  registerLeave,
}: {
  registerLeave?: (guard: LeaveGuard | null) => void
}) {
  const service = useDesktopService()
  const { snapshot, issue: stateIssue, listening } = useDesktopView()
  const [issue, setIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [stopActive, setStopActive] = useState(false)
  const [resultUnknown, setResultUnknown] = useState(false)
  const update = snapshot?.update
  const release = update?.release
  const frozen = snapshot?.maintenance.writesFrozen ?? false
  const mutationDisabled = busy || resultUnknown || frozen
  const networkBusy =
    update && ["checking", "downloading", "verifying"].includes(update.phase)
  const { discard, cancelDiscard } = useDesktopSettingsLeave(
    registerLeave,
    busy ? "busy" : resultUnknown ? "unknown" : confirm ? "draft" : "ready"
  )
  async function run(action: () => Promise<unknown>) {
    if (busy || resultUnknown) return
    setBusy(true)
    setIssue(null)
    try {
      await action()
    } catch (error) {
      const failure = desktopIssue(error)
      const unknown = failure.code === "unknown" || failure.code === "internal"
      setResultUnknown(unknown)
      setIssue(unknown ? { ...failure, code: "unknown" } : failure)
    } finally {
      setBusy(false)
    }
  }
  async function checkResult() {
    if (busy) return
    setBusy(true)
    try {
      await service.refresh()
      const current = service.getSnapshot()
      if (current.issue) {
        setIssue(current.issue)
        return
      }
      setResultUnknown(false)
      setIssue(null)
      if (current.snapshot?.update.phase !== "ready") setConfirm(false)
    } finally {
      setBusy(false)
    }
  }
  async function install() {
    if (!release) return
    await run(async () => {
      await service.call("update_install", {
        releaseId: release.releaseId,
        stopActive,
      })
      setConfirm(false)
    })
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
                  <CardTitle>moon {snapshot.version}</CardTitle>
                  {snapshot.development && (
                    <Badge variant="secondary">开发模式</Badge>
                  )}
                  <Badge variant="outline">
                    {snapshot.platform} · {snapshot.architecture}
                  </Badge>
                </div>
                <CardDescription
                  role="status"
                  className="flex items-center gap-1.5"
                >
                  {networkBusy && <Spinner />}
                  <span>{phaseLabels[update.phase]}</span>
                  {update.checkedAt && (
                    <span>
                      · 上次检查 {new Date(update.checkedAt).toLocaleString()}
                    </span>
                  )}
                </CardDescription>
                <CardAction className="self-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() =>
                      void (resultUnknown ? checkResult() : service.refresh())
                    }
                  >
                    <RefreshCw data-icon="inline-start" />
                    刷新状态
                  </Button>
                </CardAction>
              </CardHeader>
              {((!snapshot.capabilities.checkUpdates &&
                snapshot.capabilities.unavailableReason) ||
                (snapshot.development &&
                  !snapshot.capabilities.installUpdates)) && (
                <CardContent className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {!snapshot.capabilities.checkUpdates &&
                    snapshot.capabilities.unavailableReason && (
                      <p>{snapshot.capabilities.unavailableReason}</p>
                    )}
                  {snapshot.development &&
                    !snapshot.capabilities.installUpdates && (
                      <p>当前为开发模式，请在正式发行版本中安装更新。</p>
                    )}
                </CardContent>
              )}
              <CardFooter className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={
                    mutationDisabled ||
                    !!networkBusy ||
                    !snapshot.capabilities.checkUpdates
                  }
                  onClick={() =>
                    void run(() => service.call("update_check", undefined))
                  }
                >
                  {networkBusy && <Spinner data-icon="inline-start" />}
                  检查更新
                </Button>
                {networkBusy &&
                  update.operationId &&
                  update.phase !== "verifying" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      disabled={mutationDisabled}
                      onClick={() =>
                        void run(() =>
                          service.call("update_cancel", {
                            operationId: update.operationId!,
                          })
                        )
                      }
                    >
                      取消{update.phase === "checking" ? "检查" : "下载"}
                    </Button>
                  )}
              </CardFooter>
            </Card>
            {release && (
              <Card>
                <CardHeader>
                  <CardTitle>moon {release.version}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {release.publishedAt && (
                    <p>
                      发布于{" "}
                      {new Date(release.publishedAt).toLocaleDateString()}
                    </p>
                  )}
                  {release.notes && (
                    <p className="settings-notes">{release.notes}</p>
                  )}
                  {update.phase === "downloading" && (
                    <div className="space-y-2">
                      {update.totalBytes ? (
                        <Progress
                          className="h-2"
                          aria-label="更新下载进度"
                          value={Math.min(
                            100,
                            (update.downloadedBytes / update.totalBytes) * 100
                          )}
                        />
                      ) : (
                        <Progress
                          className="h-2"
                          aria-label="正在下载更新，等待包大小"
                          value={null}
                        />
                      )}
                      <p>
                        {formatBytes(update.downloadedBytes)}
                        {update.totalBytes !== null
                          ? ` / ${formatBytes(update.totalBytes)}`
                          : " · 正在读取包大小"}
                      </p>
                    </div>
                  )}
                  {["available", "failed"].includes(update.phase) && (
                    <Button
                      className="self-start"
                      disabled={
                        mutationDisabled || !snapshot.capabilities.checkUpdates
                      }
                      onClick={() =>
                        void run(() =>
                          service.call("update_download", {
                            releaseId: release.releaseId,
                          })
                        )
                      }
                    >
                      下载并验证更新
                    </Button>
                  )}
                  {update.phase === "ready" && (
                    <>
                      <p>
                        更新包仅保留在本次运行中。退出 moon
                        后需要重新下载；关闭本设置页不会开始安装。
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 self-start"
                        disabled={
                          mutationDisabled ||
                          !listening ||
                          !snapshot.capabilities.installUpdates
                        }
                        onClick={() => {
                          setConfirm(true)
                          setStopActive(false)
                          setIssue(null)
                        }}
                      >
                        安装并重启
                      </Button>
                    </>
                  )}
                </CardContent>
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
                    <p>正常启动后检查，每 24 小时最多一次。</p>
                  </div>
                  <Switch
                    id="auto-check"
                    checked={snapshot.updatePreferences.autoCheck}
                    disabled={
                      mutationDisabled || !snapshot.capabilities.checkUpdates
                    }
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
                    <p>发现更新后自动下载并验证，安装前始终需要确认。</p>
                  </div>
                  <Switch
                    id="auto-download"
                    checked={snapshot.updatePreferences.autoDownload}
                    disabled={
                      mutationDisabled || !snapshot.capabilities.checkUpdates
                    }
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
            {update.issue && (
              <DesktopFeedback
                issue={update.issue}
                onRefresh={() => void service.refresh()}
              />
            )}
          </>
        )}
        {issue && !confirm && (
          <DesktopFeedback
            issue={issue}
            onRefresh={() =>
              void (resultUnknown ? checkResult() : service.refresh())
            }
          />
        )}
        <AlertDialog
          open={confirm}
          onOpenChange={(open) => {
            if (!busy && !resultUnknown) setConfirm(open)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                安装 moon {release?.version}？
              </AlertDialogTitle>
              <AlertDialogDescription>
                moon
                会保存草稿、结束当前服务并退出，安装完成后重新启动。数据和保留的旧副本继续保留。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ActivityList activities={issue?.activities ?? []} />
            {issue?.activities.some((item) => item.stoppable) && (
              <label className="flex items-start gap-2 text-[13px]">
                <Checkbox
                  checked={stopActive}
                  onCheckedChange={(value) => setStopActive(value === true)}
                  disabled={busy}
                />
                停止列出的运行会话后安装
              </label>
            )}
            {issue && (
              <DesktopFeedback
                issue={{ ...issue, activities: [] }}
                onRefresh={() =>
                  void (resultUnknown ? checkResult() : service.refresh())
                }
              />
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy || resultUnknown}>
                稍后安装
              </AlertDialogCancel>
              <Button
                disabled={
                  busy ||
                  resultUnknown ||
                  frozen ||
                  !!issue?.activities.some((item) => !item.stoppable) ||
                  (!!issue?.activities.some((item) => item.stoppable) &&
                    !stopActive)
                }
                onClick={() => void install()}
              >
                {busy
                  ? "正在准备…"
                  : stopActive
                    ? "停止会话并安装"
                    : "安装并重启"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <SettingsConfirmDialog
          value={
            discard && {
              title: "放弃安装确认？",
              description: "可以稍后回到更新设置继续确认安装。",
              label: "离开设置",
              action: discard,
            }
          }
          onCancel={cancelDiscard}
          onConfirm={() => {
            cancelDiscard()
            setConfirm(false)
            discard?.()
          }}
        />
      </div>
    </div>
  )
}
