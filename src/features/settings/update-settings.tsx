import { useState } from "react"
import type { DesktopIssue, UpdatePhase } from "@/contracts/desktop.generated"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
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
export function UpdateSettings() {
  const service = useDesktopService()
  const { snapshot, issue: stateIssue, listening } = useDesktopView()
  const [issue, setIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [stopActive, setStopActive] = useState(false)
  const update = snapshot?.update
  const release = update?.release
  const frozen = snapshot?.maintenance.writesFrozen ?? false
  const networkBusy =
    update && ["checking", "downloading", "verifying"].includes(update.phase)
  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setIssue(null)
    try {
      await action()
    } catch (error) {
      setIssue(desktopIssue(error))
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
          <p className="mt-1">从 Moon 的 GitHub 正式发布检查并下载更新。</p>
        </header>
        {stateIssue && (
          <DesktopFeedback
            issue={stateIssue}
            onRefresh={() => void service.refresh()}
          />
        )}
        {snapshot && update && (
          <>
            <dl className="settings-facts">
              <dt>当前版本</dt>
              <dd>
                Moon {snapshot.version}
                {snapshot.development ? " · 开发运行" : ""}
              </dd>
              <dt>系统架构</dt>
              <dd>
                {snapshot.platform} · {snapshot.architecture}
              </dd>
              <dt>更新状态</dt>
              <dd role="status">{phaseLabels[update.phase]}</dd>
              <dt>上次检查</dt>
              <dd>
                {update.checkedAt
                  ? new Date(update.checkedAt).toLocaleString()
                  : "尚未检查"}
              </dd>
            </dl>
            {!snapshot.capabilities.checkUpdates &&
              snapshot.capabilities.unavailableReason && (
                <p>{snapshot.capabilities.unavailableReason}</p>
              )}
            {snapshot.development && !snapshot.capabilities.installUpdates && (
              <p>当前为开发运行，不能安装更新。请在正式发行版本中确认安装。</p>
            )}
            <div className="settings-actions">
              <Button
                variant="outline"
                disabled={
                  busy ||
                  frozen ||
                  !!networkBusy ||
                  !snapshot.capabilities.checkUpdates
                }
                onClick={() =>
                  void run(() => service.call("update_check", undefined))
                }
              >
                检查更新
              </Button>
              {networkBusy &&
                update.operationId &&
                update.phase !== "verifying" && (
                  <Button
                    variant="ghost"
                    disabled={busy}
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
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void service.refresh()}
              >
                刷新状态
              </Button>
            </div>
            {release && (
              <section className="settings-panel">
                <h3>Moon {release.version}</h3>
                {release.publishedAt && (
                  <p>
                    发布于 {new Date(release.publishedAt).toLocaleDateString()}
                  </p>
                )}
                {release.notes && (
                  <p className="settings-notes">{release.notes}</p>
                )}
                {update.phase === "downloading" && (
                  <div className="space-y-2">
                    <progress
                      className="h-2 w-full"
                      aria-label="更新下载进度"
                      max={update.totalBytes ?? undefined}
                      value={
                        update.totalBytes ? update.downloadedBytes : undefined
                      }
                    />
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
                      busy || frozen || !snapshot.capabilities.checkUpdates
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
                      更新包仅保留在本次运行中。退出 Moon
                      后需要重新下载；关闭本设置页不会开始安装。
                    </p>
                    <Button
                      className="self-start"
                      disabled={
                        busy ||
                        frozen ||
                        !listening ||
                        !snapshot.capabilities.installUpdates
                      }
                      onClick={() => {
                        setConfirm(true)
                        setStopActive(false)
                        setIssue(null)
                      }}
                    >
                      安装并重启…
                    </Button>
                  </>
                )}
              </section>
            )}
            <section className="settings-panel">
              <h3>更新偏好</h3>
              <div className="settings-preference">
                <div>
                  <label htmlFor="auto-check" className="text-[13px]">
                    自动检查更新
                  </label>
                  <p>正常启动后检查，每 24 小时最多一次。</p>
                </div>
                <Switch
                  id="auto-check"
                  checked={snapshot.updatePreferences.autoCheck}
                  disabled={
                    busy || frozen || !snapshot.capabilities.checkUpdates
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
              <div className="settings-preference">
                <div>
                  <label htmlFor="auto-download" className="text-[13px]">
                    自动下载更新
                  </label>
                  <p>发现更新后自动下载并验证，安装前始终需要确认。</p>
                </div>
                <Switch
                  id="auto-download"
                  checked={snapshot.updatePreferences.autoDownload}
                  disabled={
                    busy || frozen || !snapshot.capabilities.checkUpdates
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
            </section>
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
            onRefresh={() => void service.refresh()}
          />
        )}
        <Dialog
          open={confirm}
          onOpenChange={(open) => {
            if (!busy) setConfirm(open)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>安装 Moon {release?.version}？</DialogTitle>
              <DialogDescription>
                Moon
                会保存草稿、结束当前服务并退出，安装完成后重新启动。数据和保留的旧副本继续保留。
              </DialogDescription>
            </DialogHeader>
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
                onRefresh={() => void service.refresh()}
              />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                稍后安装
              </Button>
              <Button
                disabled={
                  busy ||
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
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
