import { useEffect, useState } from "react"
import type { LeaveGuard } from "@/lib/navigation/leave-guard"
import { SettingsConfirmDialog } from "@/components/operations/settings-confirmation"
import { useDesktopSettingsLeave } from "./use-desktop-settings-leave"
import { DesktopDiagnostics } from "./desktop-diagnostics"
import { FolderOpen, RefreshCw } from "lucide-react"
import type {
  DesktopIssue,
  MigrationPlan,
  StorageCapacityInput,
  StorageLegacySource,
} from "@/contracts/desktop.generated"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import {
  desktopCall,
  useDesktopService,
  useDesktopView,
} from "./desktop-service"
import {
  ActivityList,
  DesktopFeedback,
  desktopIssue,
  formatBytes,
} from "./settings-feedback"

type StorageWizard = "migrate" | "import" | null

function StorageUsage({ dataSetId, generation }: StorageCapacityInput) {
  const [result, setResult] = useState<
    | { usedBytes: number; error?: never }
    | { error: string; usedBytes?: never }
    | null
  >(null)

  useEffect(() => {
    let disposed = false
    const timer = window.setTimeout(() => {
      void desktopCall("storage_measure_capacity", { dataSetId, generation })
        .then((value) => {
          if (!disposed) setResult(value)
        })
        .catch((error) => {
          if (!disposed) setResult({ error: desktopIssue(error).message })
        })
    }, 0)
    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [dataSetId, generation])

  return (
    <Badge variant="secondary" role="status" title={result?.error}>
      {result === null
        ? "正在统计已用容量…"
        : result.usedBytes === undefined
          ? "容量统计失败"
          : `已用 ${formatBytes(result.usedBytes)}`}
    </Badge>
  )
}

export function StorageSettings({
  registerLeave,
}: {
  registerLeave?: (guard: LeaveGuard | null) => void
}) {
  const service = useDesktopService()
  const { snapshot, issue: stateIssue, listening } = useDesktopView()
  const [wizard, setWizard] = useState<StorageWizard>(null)
  const [target, setTarget] = useState("")
  const [capacityRefresh, setCapacityRefresh] = useState(0)
  const [importSource, setImportSource] = useState("")
  const [importTarget, setImportTarget] = useState("")
  const [importLegacy, setImportLegacy] = useState(false)
  const [legacy, setLegacy] = useState<{
    source: StorageLegacySource | null
    loading: boolean
    issue?: DesktopIssue
  }>({ source: null, loading: true })
  const [legacyRefresh, setLegacyRefresh] = useState(0)
  const legacySource = legacy.source
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [stopActive, setStopActive] = useState(false)
  const [issue, setIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const [startUnknown, setStartUnknown] = useState(false)
  const storage = snapshot?.storage
  const dataSetId = storage?.dataSetId
  const frozen = snapshot?.maintenance.writesFrozen ?? false
  const allowed = !!snapshot?.capabilities.migrateData && listening && !frozen
  const dirty =
    wizard === "migrate"
      ? !!target.trim()
      : wizard === "import" && !!(importSource.trim() || importTarget.trim())
  const { leave, discard, cancelDiscard } = useDesktopSettingsLeave(
    registerLeave,
    busy ? "busy" : startUnknown ? "unknown" : dirty ? "draft" : "ready"
  )

  useEffect(() => {
    if (!dataSetId) return
    let active = true
    void service
      .call("storage_detect_legacy_sources", undefined)
      .then((detected) => {
        if (active) setLegacy({ source: detected, loading: false })
      })
      .catch((error) => {
        if (active)
          setLegacy({
            source: null,
            loading: false,
            issue: desktopIssue(error),
          })
      })
    return () => {
      active = false
    }
  }, [service, dataSetId, legacyRefresh])

  function openWizard(mode: Exclude<StorageWizard, null>, useLegacy = false) {
    setWizard(mode)
    setPlan(null)
    setIssue(null)
    setStopActive(false)
    if (mode === "import" && useLegacy && legacySource) {
      setImportLegacy(true)
      setImportSource(legacySource.sourceDirectory)
    } else if (mode === "import" && !useLegacy) {
      setImportLegacy(false)
    }
  }

  function closeWizard() {
    setWizard(null)
    setPlan(null)
    setIssue(null)
    setTarget("")
    setImportSource("")
    setImportTarget("")
    setImportLegacy(false)
  }

  async function checkMigration() {
    if (busy) return
    setBusy(true)
    try {
      await service.refresh()
      const current = service.getSnapshot()
      if (current.issue) {
        setIssue(current.issue)
        return
      }
      setStartUnknown(false)
      if (plan && current.snapshot?.maintenance.operationId === plan.planId) {
        closeWizard()
      } else {
        setPlan(null)
        setIssue(null)
      }
    } finally {
      setBusy(false)
    }
  }

  async function choose(
    kind: "migrateTarget" | "importSource" | "importTarget"
  ) {
    if (busy) return
    setBusy(true)
    setIssue(null)
    try {
      const path = await service.call(
        "desktop_choose_data_directory",
        undefined
      )
      if (path) {
        if (kind === "migrateTarget") setTarget(path)
        else if (kind === "importSource") {
          setImportSource(path)
          setImportLegacy(false)
        } else setImportTarget(path)
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

  async function prepareImport() {
    if (busy || !importTarget.trim() || (!importLegacy && !importSource.trim()))
      return
    setBusy(true)
    setIssue(null)
    setStopActive(false)
    try {
      setPlan(
        await service.call("storage_prepare_import", {
          sourceDirectory: importSource.trim(),
          targetDirectory: importTarget.trim(),
          legacy: importLegacy,
        })
      )
    } catch (error) {
      setIssue(desktopIssue(error))
    } finally {
      setBusy(false)
    }
  }

  async function start() {
    if (busy || startUnknown || !plan) return
    setBusy(true)
    setIssue(null)
    try {
      await service.call("storage_start_migration", {
        planId: plan.planId,
        stopActive,
      })
      closeWizard()
    } catch (error) {
      const failure = desktopIssue(error)
      const unknown = failure.code === "unknown" || failure.code === "internal"
      setStartUnknown(unknown)
      setIssue(unknown ? { ...failure, code: "unknown" } : failure)
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
                  ? "当前数据目录由环境变量指定，需修改开发配置后重启。"
                  : "当前桌面平台暂不支持数据迁移。"}
              </p>
            )}

            <Card>
              <CardHeader className="items-center">
                <CardTitle>当前数据目录</CardTitle>
                <CardAction className="row-span-1 self-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => {
                      void service.refresh().then(() => {
                        setCapacityRefresh((current) => current + 1)
                      })
                    }}
                  >
                    <RefreshCw data-icon="inline-start" />
                    刷新状态
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs break-all select-text">
                  {storage.dataDirectory}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {frozen ? (
                    <Badge variant="secondary">维护期间暂停统计</Badge>
                  ) : (
                    <StorageUsage
                      key={JSON.stringify([
                        storage.dataSetId,
                        storage.generation,
                        storage.dataDirectory,
                        capacityRefresh,
                      ])}
                      dataSetId={storage.dataSetId}
                      generation={storage.generation}
                    />
                  )}
                  <Badge variant="outline">
                    磁盘可用{" "}
                    {storage.availableBytes === null
                      ? "未知"
                      : formatBytes(storage.availableBytes)}
                  </Badge>
                </div>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={busy || !snapshot.capabilities.openDataDirectory}
                  onClick={() => {
                    setIssue(null)
                    void service
                      .call("desktop_open_data_directory", undefined)
                      .catch((error) => setIssue(desktopIssue(error)))
                  }}
                >
                  <FolderOpen data-icon="inline-start" />
                  打开数据目录
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!allowed || busy}
                  onClick={() => openWizard("migrate")}
                >
                  更改目录
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!allowed || busy}
                  onClick={() => openWizard("import")}
                >
                  从已有目录导入
                </Button>
              </CardFooter>
            </Card>

            <DesktopDiagnostics snapshot={snapshot} />
            {legacy.loading && (
              <p role="status" className="flex items-center gap-2">
                <Spinner />
                正在检测旧版数据…
              </p>
            )}
            {legacy.issue && (
              <DesktopFeedback
                issue={legacy.issue}
                onRefresh={() => {
                  setLegacy({ source: null, loading: true })
                  setLegacyRefresh((value) => value + 1)
                }}
              />
            )}
            {legacySource && (
              <Card size="sm">
                <CardHeader className="items-center">
                  <CardTitle>检测到旧版 moon 数据</CardTitle>
                  <CardAction className="row-span-1 self-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={!allowed || busy}
                      onClick={() => openWizard("import", true)}
                    >
                      导入旧版数据
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="font-mono text-xs break-all text-muted-foreground">
                    {legacySource.sourceDirectory}
                  </p>
                </CardContent>
              </Card>
            )}

            {storage.legacyCopyRetained && (
              <Card size="sm">
                <CardHeader>
                  <CardTitle>保留的旧副本</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {storage.retainedCopyDirectories.map((path, index) => (
                    <div
                      className="flex min-w-0 flex-wrap items-center gap-2"
                      key={path}
                    >
                      <span className="min-w-0 flex-1 font-mono text-xs break-all text-muted-foreground">
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
                        打开目录
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {issue && !wizard && (
          <DesktopFeedback
            issue={issue}
            onRefresh={() => void service.refresh()}
          />
        )}

        <Dialog
          open={wizard !== null}
          onOpenChange={(open) => {
            if (!open) leave(closeWizard)
          }}
        >
          <DialogContent className="max-h-[calc(100dvh-32px)] overflow-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {wizard === "import" ? "从已有目录导入数据" : "更改数据目录"}
              </DialogTitle>
              <DialogDescription>
                {wizard === "import"
                  ? "复制到新的专用目录并重启启用，原目录保留。"
                  : "将数据复制到新的专用目录并重启，原目录保留。"}
              </DialogDescription>
            </DialogHeader>

            {wizard === "migrate" && (
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="migration-target">
                    新的数据目录
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="migration-target"
                      value={target}
                      disabled={!allowed || busy}
                      placeholder="选择或输入新的专用空目录"
                      onChange={(event) => {
                        setTarget(event.target.value)
                        setPlan(null)
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!allowed || busy}
                      onClick={() => void choose("migrateTarget")}
                    >
                      浏览
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            )}

            {wizard === "import" && (
              <FieldGroup className="gap-4">
                {legacySource && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      旧版数据：{legacySource.sourceDirectory}
                    </span>
                    <Button
                      type="button"
                      variant={importLegacy ? "secondary" : "outline"}
                      size="xs"
                      disabled={!allowed || busy}
                      onClick={() => {
                        if (importLegacy) {
                          setImportLegacy(false)
                          setImportSource("")
                        } else {
                          setImportLegacy(true)
                          setImportSource(legacySource.sourceDirectory)
                        }
                        setPlan(null)
                        setIssue(null)
                      }}
                    >
                      {importLegacy ? "改选其他" : "使用旧版"}
                    </Button>
                  </div>
                )}
                <Field>
                  <FieldLabel htmlFor="import-source">源数据目录</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="import-source"
                      value={importSource}
                      disabled={!allowed || busy || importLegacy}
                      placeholder="选择已有 moon 数据目录"
                      onChange={(event) => {
                        setImportSource(event.target.value)
                        setImportLegacy(false)
                        setPlan(null)
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!allowed || busy}
                      onClick={() => void choose("importSource")}
                    >
                      浏览
                    </Button>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="import-target">新数据目录</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="import-target"
                      value={importTarget}
                      disabled={!allowed || busy}
                      placeholder="选择或输入新的专用空目录"
                      onChange={(event) => {
                        setImportTarget(event.target.value)
                        setPlan(null)
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!allowed || busy}
                      onClick={() => void choose("importTarget")}
                    >
                      浏览
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            )}

            {plan && (
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <div className="font-medium text-foreground">
                  预计复制 {plan.fileCount} 个文件（
                  {formatBytes(plan.totalBytes)}
                  ），完成后将自动重启 moon
                </div>
                <ActivityList activities={activities} />
                {activities.some((item) => item.stoppable) && (
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={stopActive}
                      onCheckedChange={(value) => setStopActive(value === true)}
                      disabled={busy}
                    />
                    停止列出的运行会话后继续
                  </label>
                )}
              </div>
            )}

            {issue && (
              <DesktopFeedback
                issue={{ ...issue, activities: [] }}
                onRefresh={() =>
                  void (startUnknown ? checkMigration() : service.refresh())
                }
              />
            )}

            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => leave(closeWizard)}
              >
                取消
              </Button>
              {!plan ? (
                <Button
                  disabled={
                    !allowed ||
                    busy ||
                    (wizard === "migrate"
                      ? !target.trim()
                      : !importTarget.trim() ||
                        (!importLegacy && !importSource.trim()))
                  }
                  onClick={() =>
                    void (wizard === "import" ? prepareImport() : prepare())
                  }
                >
                  {busy && <Spinner data-icon="inline-start" />}
                  {busy ? "正在检查…" : "检查目录"}
                </Button>
              ) : (
                <Button
                  disabled={
                    busy ||
                    startUnknown ||
                    frozen ||
                    activities.some((item) => !item.stoppable) ||
                    (activities.some((item) => item.stoppable) && !stopActive)
                  }
                  onClick={() => void start()}
                >
                  {busy && <Spinner data-icon="inline-start" />}
                  {busy
                    ? "正在准备…"
                    : wizard === "import"
                      ? "导入并重启"
                      : "迁移并重启"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <SettingsConfirmDialog
          value={
            discard && {
              title: "放弃目录配置草稿？",
              description: "本次填写的目录和检查结果将被清除。",
              label: "放弃草稿",
              destructive: true,
              action: discard,
            }
          }
          onCancel={cancelDiscard}
          onConfirm={() => {
            cancelDiscard()
            discard?.()
          }}
        />
      </div>
    </div>
  )
}
