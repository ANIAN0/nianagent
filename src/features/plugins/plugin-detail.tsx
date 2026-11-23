import { useState, type ReactNode } from "react"
import { ArrowLeft, ChevronRight } from "lucide-react"
import type {
  PluginDescriptor,
  PluginPackageTask,
} from "@/contracts/rpc.generated"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import {
  ExtensionConfigurationFields,
  extensionConfigurationErrors,
} from "@/features/extensions/extension-configuration-fields"
import { getPluginModule } from "./plugin-web"
import {
  configurationReadable,
  pluginNormalizedStatus,
  readConfigurationDraft,
  taskLabel,
  TASK_ACTIVE_PHASES,
  type ConfigurationDraft,
} from "./plugin-settings-state"

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
  collapsedByDefault = false,
}: Pick<
  PluginDetailProps,
  "plugin" | "busy" | "draft" | "onDraft" | "onConfigure"
> & {
  collapsedByDefault?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
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
  const content = (
    <>
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
    </>
  )
  if (collapsedByDefault && !configuration.conflict) {
    return (
      <details
        className="group rounded-xl border bg-card px-5 py-4 text-sm"
        aria-label="高级参数配置"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span>高级参数配置</span>
          {dirty && (
            <Badge variant="outline" className="font-normal">
              未保存
            </Badge>
          )}
        </summary>
        <div className="plugin-configuration mt-4 border-t pt-4">{content}</div>
      </details>
    )
  }
  return (
    <section
      className="plugin-configuration rounded-xl border bg-card p-5"
      aria-label="插件配置"
    >
      <h3 className="text-sm font-semibold">插件配置</h3>
      {content}
    </section>
  )
}

export function PluginDetail(props: PluginDetailProps) {
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
  const module = getPluginModule(plugin)
  const pages = plugin.contributions.filter((item) => item.kind === "page")
  const [activePage, setActivePage] = useState(pages[0]?.id ?? "")
  const currentPageId = pages.some((p) => p.id === activePage)
    ? activePage
    : (pages[0]?.id ?? "")

  const status = pluginNormalizedStatus(plugin, task)
  const runtimeDetail =
    pages.length === 0 &&
    plugin.state === "active" &&
    plugin.businessState.trim() &&
    plugin.businessState.trim() !== status.label
      ? plugin.businessState.trim()
      : ""

  return (
    <article
      id="plugin-detail"
      className="plugin-detail"
      aria-label={plugin.name}
    >
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft className="size-4" />
          返回插件列表
        </Button>
      </div>
      <header className="plugin-detail-header">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
              {plugin.name}
            </h1>
            <Badge
              variant={
                status.tone === "destructive" ? "destructive" : "secondary"
              }
              className="gap-1.5 font-normal"
            >
              <span
                className="plugin-status-dot"
                data-tone={status.tone}
                aria-hidden="true"
              />
              {status.label}
            </Badge>
          </div>
          {plugin.description && (
            <p className="text-sm text-muted-foreground">
              {plugin.description}
            </p>
          )}
          {runtimeDetail && (
            <div className="mt-1 flex items-baseline gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs">
              <span className="shrink-0 font-medium text-muted-foreground">
                运行状态
              </span>
              <span className="min-w-0 break-words text-foreground">
                {runtimeDetail}
              </span>
            </div>
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
              <PageErrorBoundary key={`${plugin.generation}:${pages[0].id}`}>
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
                    <PageErrorBoundary key={`${plugin.generation}:${page.id}`}>
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
                <EmptyDescription>启用后即可使用此页面。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
      {!(module?.ownsConfiguration && plugin.state === "active") && (
        <PageErrorBoundary>
          <ConfigurationEditor
            {...props}
            collapsedByDefault={pages.length > 0 && plugin.state === "active"}
          />
        </PageErrorBoundary>
      )}
      <details className="group rounded-xl border bg-card px-5 py-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span>影响范围与插件信息</span>
          <span className="text-xs font-normal text-muted-foreground">
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

          {!!plugin.effects?.length && (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                外部影响声明
              </h4>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-foreground">
                {plugin.effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
      {["local", "npm", "git"].includes(plugin.sourceKind) && (
        <div className="plugin-package-actions">
          {task && TASK_ACTIVE_PHASES.includes(task.phase) ? (
            <Button
              variant="outline"
              disabled={busy || task.phase !== "running"}
              onClick={() => onCancelTask(plugin.id)}
            >
              {task.phase === "running" ? "取消任务" : taskLabel(task)}
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
