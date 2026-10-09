import { useState } from "react"
import type { DesktopIssue, MigrationPlan } from "@/contracts/desktop.generated"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

const sourceLabels = {
  installation: "安装目录",
  custom: "自定义目录",
  developmentDefault: "开发默认目录",
  developmentEnvironment: "开发环境指定",
}
export function StorageSettings() {
  const service = useDesktopService()
  const { snapshot, issue: stateIssue, listening } = useDesktopView()
  const [target, setTarget] = useState("")
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [stopActive, setStopActive] = useState(false)
  const [issue, setIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const storage = snapshot?.storage
  const frozen = snapshot?.maintenance.writesFrozen ?? false
  const allowed = !!snapshot?.capabilities.migrateData && listening && !frozen
  async function choose() {
    if (busy) return
    setBusy(true)
    setIssue(null)
    try {
      const path = await service.call(
        "desktop_choose_data_directory",
        undefined
      )
      if (path) {
        setTarget(path)
        setPlan(null)
      }
    } catch (error) {
      setIssue(desktopIssue(error))
    } finally {
      setBusy(false)
    }
  }
  async function prepare() {
    if (busy || !target.trim()) return
    setBusy(true)
    setIssue(null)
    setStopActive(false)
    try {
      setPlan(
        await service.call("storage_prepare_migration", {
          targetDirectory: target.trim(),
        })
      )
    } catch (error) {
      setIssue(desktopIssue(error))
    } finally {
      setBusy(false)
    }
  }
  async function start() {
    if (busy || !plan) return
    setBusy(true)
    setIssue(null)
    try {
      await service.call("storage_start_migration", {
        planId: plan.planId,
        stopActive,
      })
      setPlan(null)
    } catch (error) {
      setIssue(desktopIssue(error))
    } finally {
      setBusy(false)
    }
  }
  const activities = issue?.activities.length
    ? issue.activities
    : (plan?.activities ?? [])
  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header>
          <h2>数据与存储</h2>
          <p className="mt-1">
            Moon 的配置、会话、材料、草稿及运行数据保存在同一专用目录。
          </p>
        </header>
        {stateIssue && (
          <DesktopFeedback
            issue={stateIssue}
            onRefresh={() => void service.refresh()}
          />
        )}
        {storage && (
          <>
            {!snapshot.capabilities.migrateData && (
              <p>
                {storage.source === "developmentEnvironment"
                  ? "当前数据目录由开发环境指定，需修改开发启动配置后重启 Moon；本次运行无法通过设置迁移。"
                  : "当前桌面平台暂不支持数据迁移。"}
              </p>
            )}
            <dl className="settings-facts">
              <dt>当前数据目录</dt>
              <dd className="select-text">{storage.dataDirectory}</dd>
              <dt>目录来源</dt>
              <dd>{sourceLabels[storage.source]}</dd>
              <dt>安装目录</dt>
              <dd>{storage.installDirectory}</dd>
              <dt>数据大小</dt>
              <dd>{formatBytes(storage.usedBytes)}</dd>
              <dt>所在磁盘可用</dt>
              <dd>
                {storage.availableBytes === null
                  ? "暂时无法读取"
                  : formatBytes(storage.availableBytes)}
              </dd>
            </dl>
            <div className="settings-actions">
              <Button
                variant="outline"
                disabled={busy || !snapshot.capabilities.openDataDirectory}
                onClick={() => {
                  setIssue(null)
                  void service
                    .call("desktop_open_data_directory", undefined)
                    .catch((error) => setIssue(desktopIssue(error)))
                }}
              >
                打开数据目录
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void service.refresh()}
              >
                刷新状态
              </Button>
            </div>
            <section className="settings-panel">
              <h3>迁移到新目录</h3>
              <p>
                选择新建或空的专用目录。Moon
                会保存草稿、停止写入、完整复制并验证后重启；原目录作为旧副本保留。
              </p>
              {storage.source === "developmentEnvironment" && (
                <p>
                  当前目录由 MOON_DATA_DIR
                  指定。请修改开发启动配置并重启，不通过设置覆盖环境变量。
                </p>
              )}
              <label
                className="space-y-2 text-[13px]"
                htmlFor="migration-target"
              >
                <span>新的数据目录</span>
                <Input
                  id="migration-target"
                  value={target}
                  disabled={!allowed || busy}
                  placeholder="选择或输入新的专用目录"
                  onChange={(event) => {
                    setTarget(event.target.value)
                    setPlan(null)
                  }}
                />
              </label>
              <div className="settings-actions">
                <Button
                  variant="outline"
                  disabled={!allowed || busy}
                  onClick={() => void choose()}
                >
                  选择目录
                </Button>
                <Button
                  disabled={!allowed || busy || !target.trim()}
                  onClick={() => void prepare()}
                >
                  {busy ? "正在预检…" : "检查并迁移"}
                </Button>
              </div>
            </section>
            {storage.legacyCopyRetained && (
              <section className="settings-panel">
                <h3>保留的旧副本</h3>
                <p>新目录已启用。旧副本保留，不会自动覆盖、合并或删除。</p>
                {storage.retainedCopyDirectories.map((path, index) => (
                  <div
                    className="flex min-w-0 flex-wrap items-center gap-2"
                    key={path}
                  >
                    <span className="min-w-0 flex-1 text-[13px] [overflow-wrap:anywhere]">
                      {path}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void service
                          .call("desktop_open_retained_copy", { index })
                          .catch((error) => setIssue(desktopIssue(error)))
                      }}
                    >
                      打开旧副本
                    </Button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {issue && !plan && (
          <DesktopFeedback
            issue={issue}
            onRefresh={() => void service.refresh()}
          />
        )}
        <Dialog
          open={!!plan}
          onOpenChange={(open) => {
            if (!open && !busy) {
              setPlan(null)
              setIssue(null)
            }
          }}
        >
          <DialogContent className="max-h-[calc(100dvh-32px)] overflow-auto">
            <DialogHeader>
              <DialogTitle>迁移数据并重启 Moon？</DialogTitle>
              <DialogDescription>
                现有数据将复制到新目录，原副本保留。未保存的设置需要先处理。
              </DialogDescription>
            </DialogHeader>
            {plan && (
              <>
                <dl className="settings-facts">
                  <dt>原目录</dt>
                  <dd>{plan.sourceDirectory}</dd>
                  <dt>新目录</dt>
                  <dd>{plan.targetDirectory}</dd>
                  <dt>复制规模</dt>
                  <dd>
                    {plan.fileCount} 个文件 · {formatBytes(plan.totalBytes)}
                  </dd>
                </dl>
                <ActivityList activities={activities} />
                {activities.some((item) => item.stoppable) && (
                  <label className="flex items-start gap-2 text-[13px]">
                    <Checkbox
                      checked={stopActive}
                      onCheckedChange={(value) => setStopActive(value === true)}
                      disabled={busy}
                    />
                    停止列出的运行会话后迁移
                  </label>
                )}
                {issue && (
                  <DesktopFeedback
                    issue={{ ...issue, activities: [] }}
                    onRefresh={() => void service.refresh()}
                  />
                )}
              </>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPlan(null)
                  setIssue(null)
                }}
              >
                稍后迁移
              </Button>
              <Button
                disabled={
                  busy ||
                  frozen ||
                  activities.some((item) => !item.stoppable) ||
                  (activities.some((item) => item.stoppable) && !stopActive)
                }
                onClick={() => void start()}
              >
                {busy
                  ? "正在准备…"
                  : stopActive
                    ? "停止会话并迁移"
                    : "迁移并重启"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
