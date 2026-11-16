import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ArrowLeft, ChevronRight } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import {
  ExtensionConfigurationFields,
  readExtensionConfiguration,
  extensionConfigurationErrors,
} from "@/features/extensions/extension-configuration-fields"
import { getPluginModule, usePluginRegistry } from "./plugin-web"
import { pluginsChanged } from "./plugin-service"

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
/** 包任务进行中：列表行以阶段替代常规状态，任务终态后回落。 */
const TASK_ACTIVE_PHASES = ["running", "applying", "cancelling"]
function taskLabel(task?: PluginPackageTask) {
  if (!task || !TASK_ACTIVE_PHASES.includes(task.phase)) return ""
  if (task.phase === "applying") return "正在应用…"
  if (task.phase === "cancelling") return "正在取消…"
  return task.action === "update" ? "正在更新…" : "正在安装…"
}
/** 状态筛选与 descriptor.state/installed 的映射；与列表状态点共用语义。 */
type StatusFilter = "all" | "enabled" | "issue" | "pending"
const statusFilters: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "enabled", label: "启用" },
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
function PluginStatusDot({ plugin }: { plugin: PluginDescriptor }) {
  const label = plugin.installed ? pluginStatus(plugin) : "待安装"
  return (
    <span
      className="plugin-status-dot"
      data-state={plugin.installed ? plugin.state : "uninstalled"}
      role="img"
      aria-label={`状态：${label}`}
    />
  )
}
function renderBusinessPage(plugin: PluginDescriptor, pageId?: string) {
  const module = getPluginModule(plugin.id)
  const Page = module?.pages?.find(
    (page) => !pageId || page.id === pageId
  )?.component
  return Page ? (
    <Page pluginId={plugin.id} />
  ) : (
    <p role="status">插件页面尚未加载，请返回后重新读取。</p>
  )
}

type ConfigurationDraft = ReturnType<typeof readExtensionConfiguration> & {
  source: string
  savedValue: string
  savedSchema: string
  conflict: boolean
}
function readConfigurationDraft(plugin: PluginDescriptor): ConfigurationDraft {
  const saved = readExtensionConfiguration(
    plugin.configurationSchema,
    plugin.configuration
  )
  const savedValue = JSON.stringify(saved.configuration)
  const savedSchema = JSON.stringify(saved.schema)
  return {
    ...saved,
    source: JSON.stringify([savedSchema, savedValue]),
    savedValue,
    savedSchema,
    conflict: false,
  }
}
function reconcileDrafts(
  plugins: PluginDescriptor[],
  drafts: Record<string, ConfigurationDraft>
) {
  const next: Record<string, ConfigurationDraft> = {}
  for (const plugin of plugins) {
    const previous = drafts[plugin.id]
    try {
      const saved = readConfigurationDraft(plugin)
      if (!previous) {
        next[plugin.id] = saved
        continue
      }
      if (previous.source === saved.source) {
        next[plugin.id] = previous
        continue
      }
      const draftValue = JSON.stringify(previous.configuration)
      const clean = draftValue === previous.savedValue && !previous.conflict
      const matches =
        draftValue === saved.savedValue &&
        previous.savedSchema === saved.savedSchema
      next[plugin.id] =
        clean || matches
          ? saved
          : { ...previous, source: saved.source, conflict: true }
    } catch {
      // A damaged descriptor must not discard an existing local draft.
      if (previous) next[plugin.id] = previous
    }
  }
  return next
}
function pluginStatus(plugin: PluginDescriptor) {
  if (!plugin.installed) return "待安装"
  if (plugin.state === "active") return plugin.businessState || "已启用"
  if (plugin.state === "failed") return "异常"
  if (plugin.state === "loading") return "正在启用"
  if (plugin.state === "stopping") return "正在停用"
  return "已停用"
}
function configurationReadable(plugin: PluginDescriptor) {
  try {
    readExtensionConfiguration(plugin.configurationSchema, plugin.configuration)
    return true
  } catch {
    return false
  }
}
function draftChanged(draft: ConfigurationDraft | undefined) {
  return (
    !!draft &&
    (draft.conflict || JSON.stringify(draft.configuration) !== draft.savedValue)
  )
}

type PluginDetailProps = {
  plugin: PluginDescriptor
  busy: boolean
  draft?: ConfigurationDraft
  task?: PluginPackageTask
  onBack: () => void
  onDraft: (draft: ConfigurationDraft) => void
  onConfigure: (
    plugin: PluginDescriptor,
    enabled: boolean,
    configuration: string
  ) => void
  onPackage: (id: string, action: "install" | "update" | "remove") => void
  onCancelTask: (id: string) => void
  onRemoveRequest: (plugin: PluginDescriptor) => void
  renderPage: (plugin: PluginDescriptor, pageId?: string) => ReactNode
  webError?: string
}

function ConfigurationEditor({
  plugin,
  busy,
  draft,
  onDraft,
  onConfigure,
}: Pick<
  PluginDetailProps,
  "plugin" | "busy" | "draft" | "onDraft" | "onConfigure"
>) {
  let saved: ConfigurationDraft
  try {
    saved = readConfigurationDraft(plugin)
  } catch {
    return (
      <Alert>
        <AlertTitle>配置无法解析</AlertTitle>
        <AlertDescription>
          原配置已保留。可停用此插件，修复来源后重新读取。
        </AlertDescription>
      </Alert>
    )
  }
  const configuration = draft || saved
  const schemaChanged = configuration.savedSchema !== saved.savedSchema
  const dirty =
    JSON.stringify(configuration.configuration) !== saved.savedValue ||
    schemaChanged
  const errors = extensionConfigurationErrors(
    configuration.schema,
    configuration.configuration
  )
  const hasFields =
    Object.keys(configuration.schema.properties || {}).length > 0
  if (!hasFields && !configuration.conflict) return null
  return (
    <section
      className="plugin-configuration rounded-xl border bg-card p-5"
      aria-label="插件配置"
    >
      <h3 className="text-sm font-semibold">插件配置</h3>
      {configuration.conflict && (
        <Alert>
          <AlertTitle>已保存配置发生变化，草稿已保留</AlertTitle>
          <AlertDescription>
            <p>
              {schemaChanged
                ? "配置结构已更新，请采用已保存配置后重新编辑。"
                : "请选择采用已保存配置，或保留草稿并确认覆盖后再保存。"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onDraft(saved)}
              >
                采用已保存配置
              </Button>
              {!schemaChanged && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    onDraft({
                      ...configuration,
                      source: saved.source,
                      savedValue: saved.savedValue,
                      savedSchema: saved.savedSchema,
                      conflict: false,
                    })
                  }
                >
                  保留草稿并确认覆盖
                </Button>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {hasFields && (
        <>
          <ExtensionConfigurationFields
            id={plugin.id}
            schema={configuration.schema}
            values={configuration.configuration}
            disabled={busy}
            onChange={(value) =>
              onDraft({ ...configuration, configuration: value })
            }
          />
          {errors.map((error) => (
            <p key={error} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ))}
          <div className="plugin-configuration-actions">
            <Button
              size="sm"
              disabled={
                busy || !dirty || !!errors.length || configuration.conflict
              }
              onClick={() =>
                onConfigure(
                  plugin,
                  plugin.enabled,
                  JSON.stringify(configuration.configuration)
                )
              }
            >
              保存配置
            </Button>
            {dirty && !configuration.conflict && (
              <span role="status">有未保存的修改</span>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function PluginDetail(props: PluginDetailProps) {
  const {
    plugin,
    busy,
    task,
    onBack,
    onConfigure,
    onPackage,
    onCancelTask,
    onRemoveRequest,
    renderPage,
  } = props
  const module = getPluginModule(plugin.id)
  const pages = plugin.contributions.filter((item) => item.kind === "page")
  const [activePage, setActivePage] = useState(pages[0]?.id ?? "")
  const currentPageId = pages.some((p) => p.id === activePage)
    ? activePage
    : (pages[0]?.id ?? "")

  return (
    <article
      id="plugin-detail"
      className="plugin-detail"
      aria-label={plugin.name}
    >
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          返回插件列表
        </Button>
      </div>
      <header className="plugin-detail-header">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-semibold">{plugin.name}</h1>
            <Badge
              variant={plugin.state === "failed" ? "destructive" : "secondary"}
            >
              {taskLabel(task) || pluginStatus(plugin)}
            </Badge>
          </div>
          {plugin.description && (
            <p className="text-sm text-muted-foreground">
              {plugin.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Switch
            aria-label={`启用${plugin.name}`}
            checked={plugin.enabled}
            disabled={
              busy ||
              taskLabel(task) !== "" ||
              (!plugin.enabled &&
                (!plugin.installed || !configurationReadable(plugin)))
            }
            onCheckedChange={(enabled) =>
              onConfigure(plugin, enabled, plugin.configuration)
            }
          />
        </div>
      </header>
      {plugin.error && (
        <Alert>
          <AlertTitle>插件需要处理</AlertTitle>
          <AlertDescription>{plugin.error}</AlertDescription>
        </Alert>
      )}
      {props.webError && (
        <Alert>
          <AlertTitle>插件界面未能加载</AlertTitle>
          <AlertDescription>{props.webError}</AlertDescription>
        </Alert>
      )}
      {plugin.integrityChanged && (
        <Alert>
          <AlertTitle>来源文件与导入时不一致</AlertTitle>
          <AlertDescription>
            插件来源在导入后被修改过；请自行核对该来源可信后再继续使用。
          </AlertDescription>
        </Alert>
      )}
      {pages.length > 0 && (
        <section className="min-w-0" aria-label="插件工作区">
          {plugin.state === "active" ? (
            pages.length === 1 ? (
              <PageErrorBoundary key={`${plugin.id}:${pages[0].id}`}>
                {renderPage(plugin, pages[0].id)}
              </PageErrorBoundary>
            ) : (
              <Tabs value={currentPageId} onValueChange={setActivePage}>
                <TabsList>
                  {pages.map((page) => (
                    <TabsTrigger key={page.id} value={page.id}>
                      {page.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {pages.map((page) => (
                  <TabsContent key={page.id} value={page.id}>
                    <PageErrorBoundary key={`${plugin.id}:${page.id}`}>
                      {renderPage(plugin, page.id)}
                    </PageErrorBoundary>
                  </TabsContent>
                ))}
              </Tabs>
            )
          ) : (
            <Empty className="border bg-card">
              <EmptyHeader>
                <EmptyTitle>插件当前未启用</EmptyTitle>
                <EmptyDescription>
                  开启右上角开关启用{plugin.name}后，即可在此查看与操作。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
      <PageErrorBoundary>
        <ConfigurationEditor {...props} />
      </PageErrorBoundary>
      <details className="rounded-xl border bg-card px-5 py-4 text-sm">
        <summary className="cursor-pointer font-medium text-foreground select-none">
          影响范围与插件信息
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            v{plugin.version} ·{" "}
            {plugin.sourceKind === "bundled" ? "内置" : plugin.sourceKind}
            {plugin.tools.length > 0 ? ` · ${plugin.tools.length} 个工具` : ""}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-5 border-t pt-4">
          <div className="grid gap-x-6 gap-y-2.5 text-xs sm:grid-cols-[84px_minmax(0,1fr)]">
            <span className="text-muted-foreground">版本与来源</span>
            <span className="text-foreground">
              v{plugin.version}（
              {plugin.sourceKind === "bundled" ? "内置" : plugin.sourceKind}）
            </span>
            <span className="text-muted-foreground">所在路径</span>
            <span className="font-mono break-all text-foreground">
              {plugin.source}
            </span>
            {plugin.integrityChanged && (
              <>
                <span className="text-destructive">完整性</span>
                <span className="text-destructive">
                  来源文件与导入时不一致；请自行核对该来源后再继续使用。
                </span>
              </>
            )}
          </div>

          {plugin.tools.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-muted-foreground">
                提供工具（{plugin.tools.length}）
              </h4>
              <div className="flex flex-col gap-1.5">
                {plugin.tools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Badge
                      variant="outline"
                      title={tool.id}
                      className="font-normal"
                    >
                      {tool.name}
                    </Badge>
                    {plugin.state === "active" &&
                      tool.available === false &&
                      tool.unavailableReason && (
                        <span className="plugin-tool-issue text-xs text-muted-foreground">
                          {tool.unavailableReason}
                        </span>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(plugin.contributions.length > 0 ||
            !!plugin.registrations?.commands.length ||
            !!plugin.registrations?.events.length ||
            !!plugin.registrations?.providers.length) && (
            <div className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-muted-foreground">
                扩展入口
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {plugin.contributions.map((item) => {
                  const loaded =
                    item.kind === "page"
                      ? module?.pages?.some((value) => value.id === item.id)
                      : item.kind === "session-tab"
                        ? module?.tabs?.some((value) => value.id === item.id)
                        : module?.deliveries?.some(
                            (value) =>
                              value.id === item.id &&
                              value.version === item.version
                          )
                  const kindLabel = {
                    page: "详情页",
                    "session-tab": "右侧标签",
                    delivery: "交付卡片",
                  }[item.kind]
                  return (
                    <Badge
                      key={`${item.kind}:${item.id}`}
                      variant={loaded ? "secondary" : "outline"}
                      className="font-normal"
                    >
                      {kindLabel} · {item.title}
                      {!loaded ? "（未加载）" : ""}
                    </Badge>
                  )
                })}
                {plugin.registrations?.commands.map((name) => (
                  <Badge
                    key={`cmd:${name}`}
                    variant="outline"
                    className="font-mono font-normal"
                  >
                    /{name}
                  </Badge>
                ))}
                {plugin.registrations?.events.map((name) => (
                  <Badge
                    key={`evt:${name}`}
                    variant="outline"
                    className="font-normal"
                  >
                    钩子：{name}
                  </Badge>
                ))}
                {plugin.registrations?.providers.map((name) => (
                  <Badge
                    key={`prv:${name}`}
                    variant="outline"
                    className="font-normal"
                  >
                    模型：{name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">
              外部影响声明
            </h4>
            {plugin.effects?.length ? (
              <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-foreground">
                {plugin.effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                作者未声明外部影响。
              </p>
            )}
          </div>
        </div>
      </details>
      {["local", "npm", "git"].includes(plugin.sourceKind) && (
        <div className="plugin-package-actions">
          {task && TASK_ACTIVE_PHASES.includes(task.phase) ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onCancelTask(plugin.id)}
            >
              {task.phase === "cancelling" ? "正在取消…" : "取消任务"}
            </Button>
          ) : (
            <>
              {["npm", "git"].includes(plugin.sourceKind) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    onPackage(
                      plugin.id,
                      plugin.installed ? "update" : "install"
                    )
                  }
                >
                  {plugin.installed ? "更新插件" : "安装插件"}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onRemoveRequest(plugin)}
              >
                移除导入
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  )
}

export function PluginWorkbench({
  service = managementService,
  renderPage = renderBusinessPage,
  active = false,
}: {
  service?: PluginManagementService
  renderPage?: (plugin: PluginDescriptor, pageId?: string) => ReactNode
  /** 宿主视图可见时为真：驱动状态轮询。 */
  active?: boolean
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
  const configure: PluginDetailProps["onConfigure"] = (
    plugin,
    enabled,
    configuration
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
              <h1>插件</h1>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !updatable.length}
                  onClick={checkAllUpdates}
                >
                  全部更新
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(read)}
                >
                  重新读取
                </Button>
                <Dialog
                  open={importOpen}
                  onOpenChange={(open) => {
                    if (open) setError("")
                    setImportOpen(open)
                  }}
                >
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={busy}>
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
              <Input
                aria-label="搜索插件"
                placeholder="搜索名称、描述或工具"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div
                className="plugin-filter"
                role="group"
                aria-label="按状态筛选"
              >
                {statusFilters.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    size="sm"
                    aria-pressed={statusFilter === item.id}
                    data-active={statusFilter === item.id}
                    onClick={() => setStatusFilter(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
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
              {readError} 当前显示可能不是最新状态。
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
          <nav className="plugin-catalog" aria-label="插件列表">
            <ul className="flex flex-col gap-2.5">
              {visible.map((plugin) => (
                <li
                  key={plugin.id}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                    onClick={() => setSelectedId(plugin.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <PluginStatusDot plugin={plugin} />
                      <span className="text-sm font-medium">{plugin.name}</span>
                      <Badge
                        variant={
                          plugin.state === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {taskLabel(tasks[plugin.id]) || pluginStatus(plugin)}
                      </Badge>
                      {draftChanged(drafts[plugin.id]) && (
                        <Badge variant="outline">未保存</Badge>
                      )}
                    </div>
                    {plugin.description && (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {plugin.description}
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-3">
                    <Switch
                      aria-label={`启用${plugin.name}`}
                      checked={plugin.enabled}
                      disabled={
                        busy ||
                        taskLabel(tasks[plugin.id]) !== "" ||
                        (!plugin.enabled &&
                          (!plugin.installed || !configurationReadable(plugin)))
                      }
                      onCheckedChange={(enabled) =>
                        configure(plugin, enabled, plugin.configuration)
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`查看${plugin.name}详情`}
                      onClick={() => setSelectedId(plugin.id)}
                    >
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
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
