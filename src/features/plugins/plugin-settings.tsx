import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  Network,
  NotebookPen,
  Plus,
  Puzzle,
  ScrollText,
  Search,
  Smartphone,
  Sparkles,
  StickyNote,
  Terminal,
  X,
} from "lucide-react"
import { HoverHint } from "@/components/feedback/hover-hint"
import type {
  PluginDescriptor,
  PluginPackageTask,
  RpcRequests,
} from "@/contracts/rpc.generated"
import { RpcTransportError, rpcCall } from "@/lib/rpc/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { getPluginModule, usePluginRegistry } from "./plugin-web"
import { pluginsChanged } from "./plugin-service"

import { PluginDetail } from "./plugin-detail"
import {
  configurationReadable,
  draftChanged,
  pluginNormalizedStatus,
  reconcileDrafts,
  taskLabel,
  TASK_ACTIVE_PHASES,
  type ConfigurationDraft,
} from "./plugin-settings-state"

export type PluginManagementService = {
  list: (signal?: AbortSignal) => Promise<PluginDescriptor[]>
  configure: (input: RpcRequests["pluginConfigure"]) => Promise<unknown>
  add: (source: string) => Promise<PluginDescriptor>
  package: (
    id: string,
    action: "install" | "update" | "remove"
  ) => Promise<PluginPackageTask>
  packageStatus: (id: string) => Promise<PluginPackageTask>
  packageCancel: (id: string) => Promise<PluginPackageTask>
  recover: () => Promise<unknown>
}
const managementService: PluginManagementService = {
  list: (signal) => rpcCall("pluginList", {}, signal),
  configure: (input) => rpcCall("pluginConfigure", input),
  add: (source) => rpcCall("pluginImport", { source }),
  package: (id, action) => rpcCall("pluginPackage", { id, action }),
  packageStatus: (id) => rpcCall("pluginPackageStatus", { id }),
  packageCancel: (id) => rpcCall("pluginPackageCancel", { id }),
  recover: () => rpcCall("pluginRecover", {}),
}
/** 状态筛选与 descriptor.state/installed 的映射；与列表状态点共用语义。 */
type StatusFilter = "all" | "enabled" | "issue" | "pending"
const SYSTEM_PLUGIN_IDS = new Set(["logs", "remote-access", "mcp-service"])
const PLUGIN_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "file-workbench": FileText,
  filebrowser: FolderOpen,
  keydex: Network,
  memos: StickyNote,
  "notes-workbench": NotebookPen,
  "example-note": NotebookPen,
  opencli: Terminal,
  "skill-workbench": Sparkles,
  logs: ScrollText,
  "mcp-service": Network,
  "remote-access": Smartphone,
}
const pluginIconFor = (id: string) => PLUGIN_ICONS[id] ?? Puzzle
const statusFilters: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "enabled", label: "已启用" },
  { id: "issue", label: "异常" },
  { id: "pending", label: "待安装" },
]
const matchesStatus = (plugin: PluginDescriptor, filter: StatusFilter) =>
  filter === "all" ||
  (filter === "enabled" && plugin.enabled) ||
  (filter === "issue" &&
    (plugin.state === "failed" || plugin.integrityChanged)) ||
  (filter === "pending" && !plugin.installed)
const matchesQuery = (plugin: PluginDescriptor, query: string) => {
  const text = query.trim().toLowerCase()
  if (!text) return true
  return (
    plugin.name.toLowerCase().includes(text) ||
    plugin.description.toLowerCase().includes(text) ||
    plugin.tools.some((tool) => tool.name.toLowerCase().includes(text))
  )
}
function renderBusinessPage(plugin: PluginDescriptor, pageId?: string) {
  const module = getPluginModule(plugin)
  const Page = module?.pages?.find(
    (page) => !pageId || page.id === pageId
  )?.component
  return Page ? (
    <Page pluginId={plugin.id} />
  ) : (
    <p role="status">插件页面尚未加载，请返回后重新读取。</p>
  )
}

export function PluginWorkbench({
  service = managementService,
  renderPage = renderBusinessPage,
  active = false,
  onReturn,
}: {
  service?: PluginManagementService
  renderPage?: (plugin: PluginDescriptor, pageId?: string) => ReactNode
  /** 宿主视图可见时为真：驱动状态轮询。 */
  active?: boolean
  /** 返回会话工作台；提供时在列表头部展示显式返回入口。 */
  onReturn?: () => void
} = {}) {
  const registry = usePluginRegistry(service === managementService)
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [drafts, setDrafts] = useState<Record<string, ConfigurationDraft>>({})
  const [selectedId, setSelectedId] = useState("")
  const [source, setSource] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PluginDescriptor | null>(
    null
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [selectedId])
  const [tasks, setTasks] = useState<Record<string, PluginPackageTask>>({})
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [readError, setReadError] = useState("")
  const reader = useRef<AbortController | null>(null)
  // 经 ref 取服务：read 保持空依赖稳定，注入服务仅在隔离演示中替换。
  const serviceRef = useRef(service)
  useEffect(() => {
    serviceRef.current = service
  }, [service])
  const read = useCallback(async () => {
    reader.current?.abort()
    const controller = new AbortController()
    reader.current = controller
    try {
      const plugins = await serviceRef.current.list(controller.signal)
      if (!controller.signal.aborted) {
        setDrafts((previous) => reconcileDrafts(plugins, previous))
        setPlugins(plugins)
        setReadError("")
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setReadError(
          error instanceof Error
            ? `插件状态读取失败：${error.message} 请重新读取。`
            : "插件状态读取失败，请重新读取。"
        )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
    // serviceRef 由编译器推断为依赖；ref 身份稳定，不引发重读。
  }, [serviceRef])
  useEffect(() => {
    const reload = () => {
      void read()
    }
    reload()
    window.addEventListener("moon:plugins-changed", reload)
    return () => {
      reader.current?.abort()
      window.removeEventListener("moon:plugins-changed", reload)
    }
  }, [read])
  // 工作台可见时的轻量轮询：后台状态跳变（启用失败、安装收尾）无需手动刷新。
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void read()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [active, read])
  // 进行中的包任务单独轮询状态；终态即刷新列表与注册表。
  const pendingTaskIds = useMemo(
    () =>
      Object.entries(tasks)
        .filter(([, task]) => TASK_ACTIVE_PHASES.includes(task.phase))
        .map(([id]) => id)
        .sort()
        .join(","),
    [tasks]
  )
  useEffect(() => {
    if (!active || !pendingTaskIds) return
    const ids = pendingTaskIds.split(",")
    const timer = window.setInterval(() => {
      if (document.hidden) return
      for (const id of ids)
        serviceRef.current
          .packageStatus(id)
          .then((task) => {
            setTasks((previous) =>
              previous[id]?.phase === task.phase
                ? previous
                : { ...previous, [id]: task }
            )
            if (!TASK_ACTIVE_PHASES.includes(task.phase)) pluginsChanged()
          })
          .catch(() => {
            /* 下一轮再查；读取失败不中断其余任务。 */
          })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [active, pendingTaskIds])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    setReadError("")
    try {
      try {
        await action()
      } catch (error) {
        setError(
          error instanceof RpcTransportError
            ? `${error.message}已重新读取插件状态，请核对该插件的开关与配置。`
            : error instanceof Error
              ? error.message
              : "插件操作未能确认，请重新读取状态。"
        )
      }
      // 事件监听会重读列表并刷新前端注册表；这里再读一次收敛竞态。
      await read()
      pluginsChanged()
    } finally {
      setBusy(false)
    }
  }
  const updatable = useMemo(
    () =>
      plugins.filter(
        (plugin) =>
          ["npm", "git"].includes(plugin.sourceKind) && plugin.installed
      ),
    [plugins]
  )
  const trackTask = (id: string, task: PluginPackageTask) =>
    setTasks((previous) => ({ ...previous, [id]: task }))
  // 等待单个包任务落定（供批量更新串行推进）；封顶 15 分钟防悬挂。
  const awaitTask = async (id: string, initial: PluginPackageTask) => {
    trackTask(id, initial)
    let task = initial
    for (let round = 0; TASK_ACTIVE_PHASES.includes(task.phase); round++) {
      if (round >= 600)
        return { ...task, phase: "failed" as const, error: "任务等待超时。" }
      await new Promise((resolve) => setTimeout(resolve, 1500))
      task = await service.packageStatus(id)
      trackTask(id, task)
    }
    return task
  }
  const runPackage = (id: string, action: "install" | "update" | "remove") =>
    void run(async () => {
      trackTask(id, await service.package(id, action))
    })
  const cancelTask = (id: string) =>
    void run(async () => {
      trackTask(id, await service.packageCancel(id))
    })
  const checkAllUpdates = () =>
    void run(async () => {
      // 逐个串行更新并等落定；单项失败收集汇总，不阻塞其余来源。
      const failures: string[] = []
      for (const target of updatable) {
        try {
          const settled = await awaitTask(
            target.id,
            await service.package(target.id, "update")
          )
          if (settled.phase !== "done")
            failures.push(`${target.name}：${settled.error || "更新未完成"}`)
        } catch (error) {
          failures.push(
            `${target.name}：${error instanceof Error ? error.message : "更新未完成"}`
          )
        }
      }
      if (failures.length)
        throw new Error(`部分插件未能更新。${failures.join("；")}`)
    })
  const configure = (
    plugin: PluginDescriptor,
    enabled: boolean,
    configuration: string
  ) =>
    void run(() =>
      service.configure({
        id: plugin.id,
        revision: plugin.revision,
        enabled,
        configuration,
      })
    )
  const visible = plugins.filter(
    (item) => matchesStatus(item, statusFilter) && matchesQuery(item, query)
  )
  const selected = selectedId
    ? plugins.find((plugin) => plugin.id === selectedId)
    : undefined
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="plugin-settings">
        {!selected && (
          <>
            <header className="plugin-settings-header">
              <div className="flex items-center gap-1.5">
                {onReturn && (
                  <HoverHint content="返回工作台" label="返回工作台">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-ml-1.5"
                      aria-label="返回工作台"
                      onClick={onReturn}
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                  </HoverHint>
                )}
                <h1 className="leading-none">插件</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {updatable.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-xs"
                    disabled={busy}
                    onClick={checkAllUpdates}
                  >
                    全部更新
                  </Button>
                )}
                <Dialog
                  open={importOpen}
                  onOpenChange={(open) => {
                    if (open) setError("")
                    setImportOpen(open)
                  }}
                >
                  <DialogTrigger asChild>
                    <Button type="button" className="text-xs" disabled={busy}>
                      <Plus data-icon="inline-start" className="size-3.5" />
                      导入插件
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>导入插件</DialogTitle>
                      <DialogDescription>
                        添加本地来源、npm 包或 Git 来源。
                      </DialogDescription>
                    </DialogHeader>
                    <Field>
                      <FieldLabel htmlFor="pi-plugin-source">
                        插件来源
                      </FieldLabel>
                      <Input
                        id="pi-plugin-source"
                        value={source}
                        onChange={(event) => setSource(event.target.value)}
                        placeholder="绝对路径、npm:包名或 Git 来源"
                        disabled={busy}
                      />
                      <FieldDescription>
                        本地目录保存后即可使用；npm / Git
                        来源登记后自动开始安装。
                      </FieldDescription>
                    </Field>
                    {error && <p role="alert">{error}</p>}
                    <Button
                      disabled={busy || !source.trim()}
                      onClick={() =>
                        void run(async () => {
                          const added = await service.add(source.trim())
                          setSource("")
                          setImportOpen(false)
                          // 单步导入：npm/git 来源登记后立即启动安装任务。
                          if (added.sourceKind !== "local")
                            trackTask(
                              added.id,
                              await service.package(added.id, "install")
                            )
                        })
                      }
                    >
                      添加来源
                    </Button>
                  </DialogContent>
                </Dialog>
              </div>
            </header>
            <div className="plugin-toolbar">
              <div className="plugin-search">
                <Search className="plugin-search-icon" aria-hidden="true" />
                <Input
                  aria-label="搜索插件"
                  className="h-8 pr-8 text-xs"
                  placeholder="搜索插件名称、用途或工具"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清除搜索"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setQuery("")}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <div
                className="plugin-filter h-8"
                role="group"
                aria-label="按状态筛选"
              >
                {statusFilters.map((item) => {
                  const showCount = item.id === "issue" || item.id === "pending"
                  const count = showCount
                    ? plugins.filter((plugin) => matchesStatus(plugin, item.id))
                        .length
                    : 0
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      size="sm"
                      className="h-full gap-1 px-2.5 text-xs font-normal"
                      aria-pressed={statusFilter === item.id}
                      data-active={statusFilter === item.id}
                      onClick={() => setStatusFilter(item.id)}
                    >
                      <span>{item.label}</span>
                      {count > 0 && (
                        <span
                          className={
                            item.id === "issue"
                              ? "text-xs font-medium text-destructive tabular-nums"
                              : "text-xs text-muted-foreground tabular-nums"
                          }
                        >
                          {count}
                        </span>
                      )}
                    </Button>
                  )
                })}
              </div>
            </div>
          </>
        )}
        {error && !importOpen && !selected && <p role="alert">{error}</p>}
        {registry.error && <p role="alert">{registry.error}</p>}
        {readError && (
          <Alert>
            <AlertTitle>插件状态尚未确认</AlertTitle>
            <AlertDescription>
              <p>{readError} 当前显示可能不是最新状态。</p>
              <div className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="text-xs"
                  disabled={busy}
                  onClick={() => void run(read)}
                >
                  重新读取
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {plugins.length > 0 &&
          plugins.every((item) => item.state === "failed") &&
          plugins.every((item) => item.integrityChanged !== undefined) && (
            <Alert>
              <AlertTitle>插件配置无法读取</AlertTitle>
              <AlertDescription>
                <p>{plugins[0]?.error}</p>
                <p>
                  可备份损坏文件并重置插件配置：内置插件回到默认状态，已导入来源需要重新添加。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => service.recover())}
                  >
                    备份并重置
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        {loading && plugins.length === 0 ? (
          <div className="flex flex-col gap-3" aria-label="正在读取插件">
            <Skeleton className="h-18 w-full rounded-xl" />
            <Skeleton className="h-18 w-full rounded-xl" />
            <Skeleton className="h-18 w-full rounded-xl" />
          </div>
        ) : selected ? (
          <div className="flex flex-col gap-5">
            {error && (
              <Alert>
                <AlertTitle>操作未完成</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <PluginDetail
              key={selected.id}
              plugin={selected}
              busy={busy}
              draft={drafts[selected.id]}
              task={tasks[selected.id]}
              onBack={() => setSelectedId("")}
              onDraft={(draft) =>
                setDrafts((previous) => ({ ...previous, [selected.id]: draft }))
              }
              onConfigure={configure}
              onPackage={runPackage}
              onCancelTask={cancelTask}
              onRemoveRequest={setRemoveTarget}
              webError={
                registry.entries.find(
                  (entry) => entry.descriptor.id === selected.id
                )?.error
              }
              renderPage={renderPage}
            />
          </div>
        ) : visible.length > 0 ? (
          <nav
            className="plugin-catalog flex flex-col gap-5"
            aria-label="插件列表"
          >
            {(() => {
              const workspacePlugins = visible.filter(
                (item) => !SYSTEM_PLUGIN_IDS.has(item.id)
              )
              const systemPlugins = visible.filter((item) =>
                SYSTEM_PLUGIN_IDS.has(item.id)
              )
              const groups = [
                { title: "工作台与扩展", items: workspacePlugins },
                { title: "系统能力与诊断", items: systemPlugins },
              ].filter((group) => group.items.length > 0)
              const showGroupHeaders = groups.length > 1
              return groups.map((group) => (
                <section key={group.title} className="flex flex-col gap-2">
                  {showGroupHeaders && (
                    <h2 className="px-1 text-xs font-medium text-muted-foreground">
                      {group.title}
                    </h2>
                  )}
                  <div
                    role="list"
                    className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
                  >
                    {group.items.map((plugin) => {
                      const Icon = pluginIconFor(plugin.id)
                      const status = pluginNormalizedStatus(
                        plugin,
                        tasks[plugin.id]
                      )
                      const hasIssue = status.tone === "destructive"
                      const showInlineStatus =
                        status.tone !== "active" && status.tone !== "muted"
                      return (
                        <div
                          key={plugin.id}
                          role="listitem"
                          className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/35"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setSelectedId(plugin.id)}
                          >
                            <span
                              className={
                                hasIssue
                                  ? "flex size-8 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-destructive"
                                  : "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground transition-colors group-hover:text-foreground"
                              }
                              aria-hidden="true"
                            >
                              <Icon className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">
                                  {plugin.name}
                                </span>
                                {showInlineStatus && (
                                  <span
                                    className={
                                      hasIssue
                                        ? "inline-flex shrink-0 items-center gap-1.5 text-xs text-destructive"
                                        : "inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                                    }
                                  >
                                    <span
                                      className="plugin-status-dot"
                                      data-tone={status.tone}
                                      aria-hidden="true"
                                    />
                                    {status.label}
                                  </span>
                                )}
                                {draftChanged(drafts[plugin.id]) && (
                                  <Badge
                                    variant="outline"
                                    className="h-5 px-1.5 text-xs font-normal"
                                  >
                                    未保存
                                  </Badge>
                                )}
                                {plugin.integrityChanged && !hasIssue && (
                                  <Badge
                                    variant="outline"
                                    className="h-5 px-1.5 text-xs font-normal text-amber-600"
                                  >
                                    来源变更
                                  </Badge>
                                )}
                              </span>
                              {plugin.description && (
                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                  {plugin.description}
                                </span>
                              )}
                            </span>
                          </button>
                          <div className="flex shrink-0 items-center gap-2.5">
                            <Switch
                              aria-label={`启用${plugin.name}`}
                              checked={plugin.enabled}
                              disabled={
                                busy ||
                                taskLabel(tasks[plugin.id]) !== "" ||
                                (!plugin.enabled &&
                                  (!plugin.installed ||
                                    !configurationReadable(plugin)))
                              }
                              onCheckedChange={(enabled) =>
                                configure(plugin, enabled, plugin.configuration)
                              }
                            />
                            <ChevronRight
                              className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))
            })()}
          </nav>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {loading
                  ? "正在读取插件…"
                  : readError
                    ? "暂时无法读取插件"
                    : plugins.length
                      ? "没有匹配的插件"
                      : "还没有插件"}
              </EmptyTitle>
              {!loading && !readError && (
                <EmptyDescription>
                  {plugins.length
                    ? "可调整搜索词或状态筛选。"
                    : "导入插件后可在这里管理。"}
                </EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        )}
        <Dialog
          open={!!removeTarget}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>移除{removeTarget?.name}</DialogTitle>
              <DialogDescription>
                {removeTarget?.sourceKind === "local"
                  ? "本地来源仅解除引用，源目录文件不受影响。"
                  : "将卸载已安装的插件包并解除引用，此操作不可撤销。"}
              </DialogDescription>
            </DialogHeader>
            {error && <p role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setRemoveTarget(null)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !removeTarget}
                onClick={() => {
                  const target = removeTarget
                  setRemoveTarget(null)
                  if (target)
                    void run(() => service.package(target.id, "remove"))
                }}
              >
                移除
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
