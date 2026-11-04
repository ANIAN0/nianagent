import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { PluginDescriptor, RpcRequests } from "@/contracts/rpc.generated"
import { rpcCall } from "@/lib/rpc/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
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
  add: (source: string) => Promise<unknown>
  package: (
    id: string,
    action: "install" | "update" | "remove"
  ) => Promise<unknown>
}
const managementService: PluginManagementService = {
  list: (signal) => rpcCall("pluginList", {}, signal),
  configure: (input) => rpcCall("pluginConfigure", input),
  add: (source) => rpcCall("pluginImport", { source }),
  package: (id, action) => rpcCall("pluginPackage", { id, action }),
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
  onDraft: (draft: ConfigurationDraft) => void
  onConfigure: (
    plugin: PluginDescriptor,
    enabled: boolean,
    configuration: string
  ) => void
  onPackage: (id: string, action: "install" | "update" | "remove") => void
  renderPage: (plugin: PluginDescriptor, pageId?: string) => ReactNode
  onOpenPage: (id: string) => void
  webError?: string
  hasPage: boolean
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
  return (
    <div className="plugin-configuration">
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
      {hasFields ? (
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
            <p key={error} role="alert">
              {error}
            </p>
          ))}
          <div className="plugin-configuration-actions">
            <Button
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
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>无需配置</EmptyTitle>
            <EmptyDescription>此插件没有可编辑的配置项。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

function PluginDetail(props: PluginDetailProps) {
  const { plugin, busy, onPackage, onOpenPage, hasPage } = props
  const module = getPluginModule(plugin.id)
  return (
    <article
      id="plugin-detail"
      className="plugin-detail"
      aria-label={plugin.name}
    >
      <header className="plugin-detail-header">
        <div className="flex min-w-0 flex-col gap-2">
          <h2>{plugin.name}</h2>
          <p>{plugin.description}</p>
        </div>
        <Badge
          variant={plugin.state === "failed" ? "destructive" : "secondary"}
        >
          {pluginStatus(plugin)}
        </Badge>
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
      <PageErrorBoundary>
        <ConfigurationEditor {...props} />
      </PageErrorBoundary>
      {hasPage && (
        <div className="flex flex-wrap gap-2">
          {plugin.contributions
            .filter((item) => item.kind === "page")
            .map((page) => (
              <Button
                key={page.id}
                variant="outline"
                disabled={busy || plugin.state !== "active"}
                onClick={() => onOpenPage(page.id)}
              >
                打开{page.title}
              </Button>
            ))}
        </div>
      )}
      <section className="plugin-impact" aria-label="插件影响范围">
        <h3>影响范围</h3>
        {!!plugin.tools.length && (
          <p>工具：{plugin.tools.map((tool) => tool.name).join("、")}</p>
        )}
        {!!plugin.registrations?.commands.length && (
          <p>
            命令：
            {plugin.registrations.commands.map((name) => `/${name}`).join("、")}
          </p>
        )}
        {!!plugin.registrations?.events.length && (
          <details>
            <summary>对话钩子（{plugin.registrations.events.length}）</summary>
            <p>{plugin.registrations.events.join("、")}</p>
          </details>
        )}
        {!!plugin.registrations?.providers.length && (
          <p>模型提供方：{plugin.registrations.providers.join("、")}</p>
        )}
        {plugin.contributions.length > 0 && (
          <ul>
            {plugin.contributions.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                {
                  {
                    page: "独立页面",
                    "session-tab": "会话右侧标签",
                    delivery: "轮次交付卡片",
                  }[item.kind]
                }
                ：{item.title} ·{" "}
                {item.kind === "page"
                  ? module?.pages?.some((value) => value.id === item.id)
                    ? "已注册"
                    : "未加载"
                  : item.kind === "session-tab"
                    ? module?.tabs?.some((value) => value.id === item.id)
                      ? "已注册"
                      : "未加载"
                    : module?.deliveries?.some(
                          (value) =>
                            value.id === item.id &&
                            value.version === item.version
                        )
                      ? "已注册"
                      : "未加载"}
              </li>
            ))}
          </ul>
        )}
        <details open>
          <summary>作者声明的外部影响</summary>
          {plugin.effects?.length ? (
            <ul>
              {plugin.effects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          ) : (
            <p>作者未声明外部影响。</p>
          )}
        </details>
      </section>
      <details className="plugin-source-details">
        <summary>插件信息</summary>
        <dl>
          <dt>版本</dt>
          <dd>{plugin.version}</dd>
          <dt>来源</dt>
          <dd>
            {plugin.sourceKind === "bundled" ? "内置" : plugin.sourceKind}
          </dd>
          <dt>路径</dt>
          <dd>{plugin.source}</dd>
          {plugin.integrityChanged && (
            <>
              <dt>完整性</dt>
              <dd>来源文件与导入时不一致；请自行核对该来源后再继续使用。</dd>
            </>
          )}
          {!!plugin.tools.length && (
            <>
              <dt>工具</dt>
              <dd>{plugin.tools.map((tool) => tool.id).join("、")}</dd>
            </>
          )}
        </dl>
      </details>
      {["local", "npm", "git"].includes(plugin.sourceKind) && (
        <div className="plugin-package-actions">
          {["npm", "git"].includes(plugin.sourceKind) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                onPackage(plugin.id, plugin.installed ? "update" : "install")
              }
            >
              {plugin.installed ? "更新插件" : "安装插件"}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onPackage(plugin.id, "remove")}
          >
            移除导入
          </Button>
        </div>
      )}
    </article>
  )
}

export function PluginSettings({
  service = managementService,
  renderPage = renderBusinessPage,
}: {
  service?: PluginManagementService
  renderPage?: (plugin: PluginDescriptor, pageId?: string) => ReactNode
} = {}) {
  const registry = usePluginRegistry(service === managementService)
  const [openedPage, setOpenedPage] = useState("")
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [drafts, setDrafts] = useState<Record<string, ConfigurationDraft>>({})
  const [selectedId, setSelectedId] = useState("")
  const [source, setSource] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [readError, setReadError] = useState("")
  const reader = useRef<AbortController | null>(null)
  const read = useCallback(async () => {
    reader.current?.abort()
    const controller = new AbortController()
    reader.current = controller
    try {
      const plugins = await service.list(controller.signal)
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
  }, [service])
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
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    setReadError("")
    try {
      try {
        await action()
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "插件操作未能确认，请重新读取状态。"
        )
      }
      // Reconcile failed operations too; drafts are owned above the selected page.
      await read()
      pluginsChanged()
    } finally {
      setBusy(false)
    }
  }
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
  const selected =
    plugins.find((plugin) => plugin.id === selectedId) || plugins[0]
  const page = selected?.contributions.find(
    (item) => item.kind === "page" && item.id === openedPage
  )
  if (openedPage && selected && page)
    return (
      <div className="plugin-independent-page">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1>{page.title}</h1>
          <Button variant="ghost" onClick={() => setOpenedPage("")}>
            返回{selected.name}详情
          </Button>
        </header>
        {selected.state === "active" ? (
          <PageErrorBoundary key={`${selected.id}:${openedPage}`}>
            {renderPage(selected, openedPage)}
          </PageErrorBoundary>
        ) : (
          <p>插件已停用，请返回详情。</p>
        )}
        {registry.entries.find((entry) => entry.descriptor.id === selected.id)
          ?.error && (
          <p role="alert">
            {
              registry.entries.find(
                (entry) => entry.descriptor.id === selected.id
              )?.error
            }
          </p>
        )}
      </div>
    )
  return (
    <div className="plugin-settings">
      <header className="plugin-settings-header">
        <h1>插件</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
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
              <Button variant="outline" disabled={busy}>
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
                <FieldLabel htmlFor="pi-plugin-source">插件来源</FieldLabel>
                <Input
                  id="pi-plugin-source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="绝对路径、npm:包名或 Git 来源"
                  disabled={busy}
                />
                <FieldDescription>
                  添加后保持停用；npm / Git 来源还需安装。
                </FieldDescription>
              </Field>
              {error && <p role="alert">{error}</p>}
              <Button
                disabled={busy || !source.trim()}
                onClick={() =>
                  void run(async () => {
                    await service.add(source.trim())
                    setSource("")
                    setImportOpen(false)
                  })
                }
              >
                添加来源
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      {error && !importOpen && <p role="alert">{error}</p>}
      {readError && (
        <Alert>
          <AlertTitle>插件状态尚未确认</AlertTitle>
          <AlertDescription>
            {readError} 当前显示可能不是最新状态。
          </AlertDescription>
        </Alert>
      )}
      {plugins.length > 0 ? (
        <div className="plugin-manager">
          <nav className="plugin-list" aria-label="插件列表">
            <ul>
              {plugins.map((plugin) => (
                <li key={plugin.id} data-selected={selected?.id === plugin.id}>
                  <Button
                    variant="ghost"
                    className="plugin-select"
                    aria-current={
                      selected?.id === plugin.id ? "page" : undefined
                    }
                    aria-controls="plugin-detail"
                    onClick={() => setSelectedId(plugin.id)}
                  >
                    <span className="plugin-list-name">{plugin.name}</span>
                    <span className="plugin-list-status">
                      {pluginStatus(plugin)}
                      {draftChanged(drafts[plugin.id]) && " · 未保存"}
                    </span>
                  </Button>
                  <Switch
                    aria-label={`启用${plugin.name}`}
                    checked={plugin.enabled}
                    disabled={
                      busy ||
                      (!plugin.enabled &&
                        (!plugin.installed || !configurationReadable(plugin)))
                    }
                    onCheckedChange={(enabled) =>
                      configure(plugin, enabled, plugin.configuration)
                    }
                  />
                </li>
              ))}
            </ul>
          </nav>
          {selected && (
            <PluginDetail
              key={selected.id}
              plugin={selected}
              busy={busy}
              draft={drafts[selected.id]}
              onDraft={(draft) =>
                setDrafts((previous) => ({ ...previous, [selected.id]: draft }))
              }
              onConfigure={configure}
              onPackage={(id, action) =>
                void run(() => service.package(id, action))
              }
              webError={
                registry.entries.find(
                  (entry) => entry.descriptor.id === selected.id
                )?.error
              }
              renderPage={renderPage}
              onOpenPage={setOpenedPage}
              hasPage={selected.contributions.some(
                (item) => item.kind === "page"
              )}
            />
          )}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {loading
                ? "正在读取插件…"
                : readError
                  ? "暂时无法读取插件"
                  : "还没有插件"}
            </EmptyTitle>
            {!loading && !readError && (
              <EmptyDescription>导入插件后可在这里管理。</EmptyDescription>
            )}
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
