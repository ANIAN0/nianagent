import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { PluginDescriptor, RpcRequests } from "@/contracts/rpc.generated"
import { rpcCall } from "@/lib/rpc/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  ExtensionConfigurationFields,
  readExtensionConfiguration,
  extensionConfigurationErrors,
} from "@/features/extensions/extension-configuration-fields"
import { pluginWebModules } from "./plugin-web"
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
function renderBusinessPage(plugin: PluginDescriptor) {
  const Page = pluginWebModules.find((module) => module.id === plugin.id)?.Page
  return Page ? <Page pluginId={plugin.id} /> : null
}

type PluginItemProps = {
  plugin: PluginDescriptor
  busy: boolean
  onConfigure: (
    plugin: PluginDescriptor,
    enabled: boolean,
    configuration: string
  ) => void
  onPackage: (id: string, action: "install" | "update" | "remove") => void
  children?: ReactNode
}
function PluginItem(props: PluginItemProps) {
  let saved: ReturnType<typeof readExtensionConfiguration>
  try {
    saved = readExtensionConfiguration(
      props.plugin.configurationSchema,
      props.plugin.configuration
    )
  } catch {
    const { plugin, busy, onConfigure } = props
    return (
      <article className="plugin-setting-item">
        <div className="flex items-start justify-between gap-4">
          <h2>{plugin.name}</h2>
          <Switch
            aria-label={`启用${plugin.name}`}
            checked={plugin.enabled}
            disabled={busy || !plugin.enabled}
            onCheckedChange={() =>
              onConfigure(plugin, false, plugin.configuration)
            }
          />
        </div>
        <p role="alert">
          配置无法解析，原配置已保留。可停用此插件，修复来源后重新读取；其他插件仍可管理。
        </p>
        {plugin.error && <p>{plugin.error}</p>}
        {props.children}
      </article>
    )
  }
  return <ConfiguredPluginItem {...props} saved={saved} />
}
function ConfiguredPluginItem({
  plugin,
  busy,
  onConfigure,
  onPackage,
  children,
  saved,
}: PluginItemProps & {
  saved: ReturnType<typeof readExtensionConfiguration>
}) {
  const savedValue = JSON.stringify(saved.configuration)
  const savedSchema = JSON.stringify(saved.schema)
  const source = JSON.stringify([savedSchema, savedValue])
  const readSaved = () => ({
    ...saved,
    source,
    savedValue,
    savedSchema,
    conflict: false,
  })
  const [configuration, setConfiguration] = useState(readSaved)
  const draftValue = JSON.stringify(configuration.configuration)
  const schemaChanged = configuration.savedSchema !== savedSchema
  if (configuration.source !== source) {
    const clean =
      draftValue === configuration.savedValue && !configuration.conflict
    const matches = draftValue === savedValue && !schemaChanged
    // Adjust this row before commit; an enabled/state/revision-only update is
    // the same editing identity and must not discard its unsaved configuration.
    setConfiguration(
      clean || matches
        ? readSaved()
        : { ...configuration, source, conflict: true }
    )
  }
  const dirty = draftValue !== savedValue || schemaChanged
  const errors = extensionConfigurationErrors(
    configuration.schema,
    configuration.configuration
  )
  return (
    <article className="plugin-setting-item">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2>{plugin.name}</h2>
          <p>{plugin.description}</p>
        </div>
        <Switch
          aria-label={`启用${plugin.name}`}
          checked={plugin.enabled}
          disabled={busy || !plugin.installed}
          onCheckedChange={(enabled) =>
            onConfigure(plugin, enabled, plugin.configuration)
          }
        />
      </div>
      <p className="plugin-setting-source">
        {plugin.sourceKind} · {plugin.version} ·{" "}
        {plugin.state === "active"
          ? plugin.businessState || "已启用"
          : plugin.state === "failed"
            ? "失败"
            : plugin.state === "loading"
              ? "正在启用"
              : plugin.state === "stopping"
                ? "正在释放资源"
                : "已停用"}
      </p>
      {plugin.sourceKind !== "bundled" && (
        <p className="plugin-setting-source">{plugin.source}</p>
      )}
      {plugin.error && <p role="alert">{plugin.error}</p>}
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
                onClick={() => setConfiguration(readSaved())}
              >
                采用已保存配置
              </Button>
              {!schemaChanged && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setConfiguration({
                      ...configuration,
                      source,
                      savedValue,
                      savedSchema,
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
      {dirty && !configuration.conflict && (
        <p role="status">配置草稿尚未保存；启停只使用已保存配置。</p>
      )}
      <ExtensionConfigurationFields
        id={plugin.id}
        schema={configuration.schema}
        values={configuration.configuration}
        disabled={busy}
        onChange={(value) =>
          setConfiguration({ ...configuration, configuration: value })
        }
      />
      {errors.map((error) => (
        <p key={error} role="alert">
          {error}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        {Object.keys(configuration.schema.properties || {}).length > 0 && (
          <Button
            variant="outline"
            disabled={busy || !!errors.length || configuration.conflict}
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
        )}
        {["npm", "git"].includes(plugin.sourceKind) && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              onPackage(plugin.id, plugin.installed ? "update" : "install")
            }
          >
            {plugin.installed ? "明确更新" : "安装"}
          </Button>
        )}
        {["local", "npm", "git"].includes(plugin.sourceKind) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => onPackage(plugin.id, "remove")}
          >
            移除导入
          </Button>
        )}
      </div>
      {!!plugin.tools.length && (
        <p className="plugin-setting-source">
          原生工具：{plugin.tools.map((tool) => tool.id).join("、")}
        </p>
      )}
      {children}
    </article>
  )
}
export function PluginSettings({
  service = managementService,
  renderPage = renderBusinessPage,
}: {
  service?: PluginManagementService
  renderPage?: (plugin: PluginDescriptor) => ReactNode
} = {}) {
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([])
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState(false)
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
        setPlugins(plugins)
        setReadError("")
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setReadError(
          error instanceof Error
            ? `插件状态读取失败：${error.message} 当前显示可能不是最新状态，请重新读取。`
            : "插件状态读取失败；当前显示可能不是最新状态，请重新读取。"
        )
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
      // A rejected operation may already have saved configuration or changed
      // lifecycle state. Reconcile descriptors without replacing row drafts.
      try {
        await read()
      } catch (error) {
        setReadError(
          error instanceof Error
            ? `插件状态读取失败：${error.message} 当前显示可能不是最新状态，请重新读取。`
            : "插件状态读取失败；当前显示可能不是最新状态，请重新读取。"
        )
      }
      pluginsChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="plugin-settings">
      <div className="flex items-center justify-between gap-4">
        <h1>插件</h1>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(read)}
        >
          重新读取
        </Button>
      </div>
      <Field>
        <FieldLabel htmlFor="pi-plugin-source">导入Pi原生扩展</FieldLabel>
        <Input
          id="pi-plugin-source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="本地文件/目录绝对路径、npm:包名或Git来源"
          disabled={busy}
        />
        <FieldDescription>
          添加后保持停用。npm/Git来源需要明确安装；本地来源直接引用原路径。
        </FieldDescription>
        <Button
          variant="outline"
          disabled={busy || !source.trim()}
          onClick={() =>
            void run(async () => {
              await service.add(source.trim())
              setSource("")
            })
          }
        >
          添加来源
        </Button>
      </Field>
      {error && <p role="alert">{error}</p>}
      {readError && <p role="alert">{readError}</p>}
      {plugins.map((plugin) => (
        <PluginItem
          key={plugin.id}
          plugin={plugin}
          busy={busy}
          onConfigure={(plugin, enabled, configuration) =>
            void run(() =>
              service.configure({
                id: plugin.id,
                revision: plugin.revision,
                enabled,
                configuration,
              })
            )
          }
          onPackage={(id, action) =>
            void run(() => service.package(id, action))
          }
        >
          {plugin.state === "active" && renderPage(plugin)}
        </PluginItem>
      ))}
    </div>
  )
}
