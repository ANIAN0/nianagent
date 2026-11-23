import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import type {
  ConversationSnapshot,
  ExtensionPresentation,
  MaterialReference,
  RpcRequests,
} from "@/contracts/rpc.generated"
import type { PluginContext, PluginWebModule } from "./plugin-api"
import {
  refreshPluginRegistry,
  usePluginRegistry,
  reportPluginLifecycleFailure,
} from "./plugin-web"
import { callPlugin, subscribePluginEvent } from "./plugin-service"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"
import { rpcCall } from "@/lib/rpc/client"
import { PageErrorBoundary } from "@/components/feedback/page-error-boundary"
import { PluginSidebar, type PluginSidebarEntry } from "./plugin-sidebar"
import { PluginInteractionRequest } from "./plugin-interaction"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  GUIDE,
  tabKey,
  openSidebarTab,
  closeSidebarTab,
  readSidebarLayout,
  emptySidebarLayout,
  saveSidebarLayout,
  type PluginSidebarLayout,
} from "./plugin-sidebar-state"
import "./plugins.css"

export type PluginSessionRegistry = ReturnType<typeof usePluginRegistry>
type SessionProps = {
  sessionId: string
  cwd: string
  active: boolean
  onMaterial: (material: MaterialReference) => void
  snapshot?: ConversationSnapshot
  onReload?: () => void
  children: ReactNode
}
const SessionContext = createContext<null | {
  context: (id: string, tabId?: string, resource?: string) => PluginContext
  modules: PluginSessionRegistry["entries"]
}>(null)
export function usePluginSession() {
  return useContext(SessionContext)
}

// Subscription owns the controller, including StrictMode's release/reconnect.
// Rendering only reads its snapshot and never revives an already aborted signal.
function createPluginLifetime(identity: unknown) {
  let controller: AbortController | undefined
  const listeners = new Set<() => void>()
  return {
    identity,
    getSnapshot: () => controller?.signal ?? null,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      if (!controller) {
        controller = new AbortController()
        for (const changed of listeners) changed()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          controller?.abort()
          controller = undefined
        }
      }
    },
  }
}
function usePluginLifetime(identity: unknown) {
  const owner = useMemo(() => createPluginLifetime(identity), [identity])
  return useSyncExternalStore(owner.subscribe, owner.getSnapshot, () => null)
}
const inactiveSignal = AbortSignal.abort()

function PluginTabUnavailable({
  title = "插件内容暂时无法显示",
  message,
  reload,
}: {
  title?: string
  message: string
  reload: () => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [issue, setIssue] = useState("")
  return (
    <Alert className="m-4 w-auto">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{issue || message}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setPending(true)
            setIssue("")
            void reload()
              .catch((error) =>
                setIssue(
                  error instanceof Error
                    ? error.message
                    : "重新加载失败，请重试。"
                )
              )
              .finally(() => setPending(false))
          }}
        >
          {pending ? "正在重新加载…" : "重新加载插件"}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function PluginSessionTab({
  getContext,
  pluginId,
  tabId,
  resource,
  Content,
  payload,
  visible,
}: {
  getContext: (
    pluginId: string,
    tabId?: string,
    resource?: string
  ) => PluginContext
  pluginId: string
  tabId: string
  resource?: string
  Content: NonNullable<PluginWebModule["tabs"]>[number]["component"]
  payload: unknown
  visible: boolean
}) {
  const lifetime = usePluginLifetime(null)
  const context = useMemo(
    () => getContext(pluginId, tabId, resource),
    [getContext, pluginId, tabId, resource]
  )
  const signal = useMemo(
    () => AbortSignal.any([context.signal, lifetime ?? inactiveSignal]),
    [context.signal, lifetime]
  )
  const scoped = useMemo<PluginContext>(
    () => ({
      ...context,
      signal,
      openTab: (id, value) => {
        if (!signal.aborted) context.openTab(id, value)
      },
      closeTab: (id, resource) => {
        if (!signal.aborted) context.closeTab(id, resource)
      },
      reference: (value) => {
        if (!signal.aborted) context.reference(value)
      },
      call: (operation, input, requestedSignal) =>
        context.call(
          operation,
          input,
          requestedSignal ? AbortSignal.any([signal, requestedSignal]) : signal
        ),
      onEvent: (event, listener) => {
        if (signal.aborted) return () => {}
        const off = subscribePluginEvent(context.pluginId, event, listener)
        signal.addEventListener("abort", off, { once: true })
        return () => {
          signal.removeEventListener("abort", off)
          off()
        }
      },
    }),
    [context, signal]
  )
  if (!lifetime) return null
  return (
    <Content {...scoped} active={context.active && visible} payload={payload} />
  )
}

/** Only the host owns the conversation container; plugins provide tab bodies. */
export function PluginSessionHost(props: SessionProps) {
  const registry = usePluginRegistry()
  return (
    <PluginSessionWorkspace
      key={props.sessionId}
      {...props}
      registry={registry}
    />
  )
}

/** The formal assembly also accepts isolated registry/services for the catalog. */
export function PluginSessionWorkspace({
  sessionId,
  cwd,
  active,
  onMaterial,
  snapshot,
  onReload,
  children,
  registry,
  call = callPlugin,
  reload = refreshPluginRegistry,
  reply = (request) => rpcCall("conversationApprovalReply", request),
}: SessionProps & {
  registry: PluginSessionRegistry
  call?: typeof callPlugin
  reload?: () => Promise<void>
  reply?: (
    request: RpcRequests["conversationApprovalReply"]
  ) => Promise<unknown>
}) {
  const [initialLayout] = useState(() => {
    try {
      return { layout: readSidebarLayout(sessionId), error: "" }
    } catch {
      return {
        layout: emptySidebarLayout(),
        error: "插件面板布局无法读取，原记录保留。请检查本机存储后重新读取。",
      }
    }
  })
  const [layout, setLayout] = useState(initialLayout.layout)
  const [layoutReadError, setLayoutReadError] = useState(initialLayout.error)
  const [layoutWriteError, setLayoutWriteError] = useState("")
  const current = useRef(layout)
  const material = useRef(onMaterial)
  const snapshotRef = useRef(snapshot)
  useLayoutEffect(() => {
    current.current = layout
    material.current = onMaterial
    snapshotRef.current = snapshot
  }, [layout, onMaterial, snapshot])
  const identity = useMemo(
    () => ({ sessionId, active, entries: registry.entries }),
    [sessionId, active, registry.entries]
  )
  const lifetime = usePluginLifetime(identity)
  const update = useCallback(
    (fn: (previous: PluginSidebarLayout) => PluginSidebarLayout) => {
      setLayout((previous) => {
        const next = fn(previous)
        return next
      })
    },
    []
  )
  useEffect(() => {
    if (layoutReadError) return
    let cancelled = false
    void Promise.resolve()
      .then(() => {
        if (cancelled) return
        saveSidebarLayout(sessionId, layout)
        setLayoutWriteError("")
      })
      .catch(() => {
        if (!cancelled)
          setLayoutWriteError(
            "插件面板布局尚未保存。当前调整仍待保存，请检查本机存储后重试。"
          )
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, layout, layoutReadError])
  const context = useMemo(
    () =>
      (pluginId: string, tabId?: string, resource?: string): PluginContext => {
        const lifetimeSignal = lifetime ?? inactiveSignal
        const descriptor = registry.entries.find(
          (entry) => entry.descriptor.id === pluginId
        )?.descriptor
        const enabled = () =>
          active &&
          !lifetimeSignal.aborted &&
          registry.entries.some(
            (entry) =>
              entry.descriptor.id === pluginId &&
              entry.descriptor.state === "active"
          )
        return {
          pluginId,
          sessionId,
          cwd,
          resource,
          active,
          signal: lifetimeSignal,
          openTab: (id, payload) => {
            const entry = registry.entries.find(
              (item) => item.descriptor.id === pluginId
            )
            const hasInteraction =
              snapshotRef.current?.approvals?.some(
                (request) =>
                  request.kind !== "tool" &&
                  (request.pluginId || "pi") === pluginId
              ) ||
              snapshotRef.current?.pluginUi?.some(
                (ui) => ui.pluginId === pluginId && ui.lines.length
              )
            const registered =
              id === "pi-interaction"
                ? hasInteraction
                : entry?.module?.tabs?.some((tab) => tab.id === id) &&
                  entry.descriptor.contributions.some(
                    (item) =>
                      item.kind === "session-tab" &&
                      item.id === id &&
                      (!isRemoteWeb() || item.remote)
                  )
            if (!enabled() || !registered) return
            const definition = entry?.module?.tabs?.find((tab) => tab.id === id)
            const resource = definition?.resourceKey?.(payload)
            if (
              definition?.resourceKey &&
              (typeof resource !== "string" || !resource)
            )
              return
            const title =
              resource && definition?.title
                ? definition.title(resource)
                : entry?.descriptor.contributions.find(
                    (item) => item.kind === "session-tab" && item.id === id
                  )?.title
            update((previous) =>
              openSidebarTab(previous, {
                pluginId,
                id,
                resource,
                title: typeof title === "string" ? title : id,
                payload,
              })
            )
          },
          closeTab: (id, requestedResource) => {
            if (!enabled()) return
            const selected = current.current.tabs.find(
              (tab) =>
                tab.pluginId === pluginId &&
                tabKey(tab) === current.current.selected
            )
            const targetId = id || tabId || selected?.id
            if (!targetId) return
            const targetResource =
              requestedResource ??
              (targetId === tabId
                ? resource
                : targetId === selected?.id
                  ? selected.resource
                  : undefined)
            const candidates = current.current.tabs.filter(
              (tab) =>
                tab.pluginId === pluginId &&
                tab.id === targetId &&
                (targetResource === undefined ||
                  tab.resource === targetResource)
            )
            if (candidates.length === 1)
              update((previous) =>
                closeSidebarTab(previous, tabKey(candidates[0]))
              )
          },
          reference: (value) => {
            if (enabled()) material.current(value)
          },
          call: <T,>(operation: string, input: object, signal?: AbortSignal) =>
            descriptor
              ? call<T>(
                  pluginId,
                  operation,
                  input,
                  sessionId,
                  signal
                    ? AbortSignal.any([signal, lifetimeSignal])
                    : lifetimeSignal,
                  descriptor.generation
                )
              : Promise.reject(new Error("插件身份尚未确认，请重新加载。")),
          onEvent: (event, listener) => {
            if (!enabled()) return () => {}
            const off = subscribePluginEvent(pluginId, event, listener)
            lifetimeSignal.addEventListener("abort", off, { once: true })
            return () => {
              lifetimeSignal.removeEventListener("abort", off)
              off()
            }
          },
        }
      },
    [sessionId, cwd, active, lifetime, registry.entries, update, call]
  )
  useEffect(() => {
    if (!lifetime || lifetime.aborted) return
    const disposers: { id: string; dispose: () => void }[] = []
    if (active)
      for (const entry of registry.entries) {
        if (entry.descriptor.state !== "active") continue
        try {
          const dispose = entry.module?.connectSession?.(
            context(entry.descriptor.id)
          )
          if (dispose) disposers.push({ id: entry.descriptor.id, dispose })
        } catch {
          reportPluginLifecycleFailure(entry.descriptor.id, "连接")
        }
      }
    return () => {
      disposers.reverse().forEach(({ id, dispose }) => {
        try {
          dispose()
        } catch {
          reportPluginLifecycleFailure(id, "释放")
        }
      })
    }
  }, [context, active, lifetime, registry.entries])
  const requests =
    snapshot?.approvals?.filter((request) => request.kind !== "tool") || []
  const entries: PluginSidebarEntry[] = registry.entries
    .filter((entry) => entry.descriptor.enabled)
    .flatMap((entry) =>
      entry.descriptor.contributions
        .filter(
          (item) =>
            item.kind === "session-tab" && (!isRemoteWeb() || item.remote)
        )
        .map((contribution) => {
          const tab =
            entry.descriptor.state === "active"
              ? entry.module?.tabs?.find((tab) => tab.id === contribution.id)
              : undefined
          const Content = tab?.component
          return {
            pluginId: entry.descriptor.id,
            id: contribution.id,
            title: contribution.title,
            owner: entry.descriptor.name,
            pending: 0,
            resource: !!tab?.resourceKey,
            unavailable: !tab,
            icon: tab?.icon,
            description: tab?.description,
            render: (
              openedTab: import("./plugin-sidebar-state").PluginTab,
              visible: boolean
            ) => (
              <PageErrorBoundary
                key={`${entry.descriptor.id}:${entry.descriptor.generation}`}
              >
                {Content ? (
                  <PluginSessionTab
                    getContext={context}
                    pluginId={entry.descriptor.id}
                    tabId={contribution.id}
                    resource={openedTab.resource}
                    Content={Content}
                    visible={visible}
                    payload={openedTab.payload}
                  />
                ) : (
                  <PluginTabUnavailable
                    message={
                      entry.error ||
                      entry.descriptor.error ||
                      "插件尚未完成加载或未注册此内容。"
                    }
                    reload={reload}
                  />
                )}
              </PageErrorBoundary>
            ),
          }
        })
    )
  const unavailablePlugins = registry.entries.filter((entry) =>
    entries.some(
      (item) => item.pluginId === entry.descriptor.id && item.unavailable
    )
  )
  const uiIds = new Set([
    ...(snapshot?.pluginUi || [])
      .filter((ui) => ui.lines.length)
      .map((ui) => ui.pluginId),
    ...requests.map((request) => request.pluginId || "pi"),
  ])
  for (const pluginId of uiIds) {
    const entry = registry.entries.find(
      (item) =>
        item.descriptor.id === pluginId && item.descriptor.state === "active"
    )
    if (!entry && pluginId !== "pi") continue
    const pending = requests.filter(
      (request) => (request.pluginId || "pi") === pluginId
    )
    entries.push({
      pluginId,
      id: "pi-interaction",
      title: `${entry?.descriptor.name || "Pi 扩展"} · 交互`,
      icon: MessageSquare,
      owner: entry?.descriptor.name || "Pi 扩展",
      pending: pending.length,
      render: () => (
        <div className="plugin-interaction">
          {pending.map((request) => (
            <PluginInteractionRequest
              key={request.id}
              request={request}
              sessionId={sessionId}
              epoch={snapshot?.epoch || ""}
              onReload={onReload}
              onReply={(value) =>
                reply({
                  sessionId,
                  approvalId: request.id,
                  runId: request.runId,
                  value,
                })
              }
            />
          ))}
          {(snapshot?.pluginUi || [])
            .find((ui) => ui.pluginId === pluginId)
            ?.lines.map((line, index) => (
              <p className="plugin-interaction-copy" key={index}>
                {line}
              </p>
            ))}
        </div>
      ),
    })
  }
  const membership = entries
    .map(({ pluginId, id }) => tabKey({ pluginId, id }))
    .join("\n")
  const [knownMembership, setKnownMembership] = useState<string | null>(null)
  if (registry.entries.length && membership !== knownMembership) {
    setKnownMembership(membership)
    const keys = new Set(membership.split("\n"))
    setLayout((previous) => {
      const tabs = previous.tabs.filter((tab) =>
        keys.has(tabKey({ pluginId: tab.pluginId, id: tab.id }))
      )
      if (tabs.length === previous.tabs.length) return previous
      const selected =
        previous.selected === GUIDE ||
        tabs.some((tab) => tabKey(tab) === previous.selected)
          ? previous.selected
          : tabs.length
            ? tabKey(tabs.at(-1)!)
            : previous.guide
              ? GUIDE
              : ""
      return {
        ...previous,
        tabs,
        selected,
        expanded: previous.expanded && !!selected,
      }
    })
  }
  const value = useMemo(
    () => ({ context, modules: registry.entries }),
    [context, registry.entries]
  )
  if (layoutReadError)
    return (
      <SessionContext value={value}>
        {children}
        <p role="alert">{layoutReadError}</p>
        <Button
          variant="outline"
          onClick={() => {
            try {
              setLayout(readSidebarLayout(sessionId))
              setLayoutReadError("")
            } catch {
              setLayoutReadError("插件面板布局仍无法读取，原记录保留。")
            }
          }}
        >
          重新读取面板布局
        </Button>
      </SessionContext>
    )
  return (
    <SessionContext value={value}>
      <PluginSidebar
        sessionId={sessionId}
        active={active}
        layout={layout}
        entries={entries}
        error={registry.error}
        recovery={
          unavailablePlugins.length
            ? unavailablePlugins.map((entry) => (
                <PluginTabUnavailable
                  key={entry.descriptor.id}
                  title={`${entry.descriptor.name}暂时无法显示`}
                  message={
                    entry.error ||
                    entry.descriptor.error ||
                    "插件尚未完成加载或未注册会话内容。"
                  }
                  reload={reload}
                />
              ))
            : undefined
        }
        onOpen={(tab) => {
          if (
            active &&
            entries.some(
              (entry) => entry.pluginId === tab.pluginId && entry.id === tab.id
            )
          )
            update((previous) =>
              openSidebarTab(previous, {
                pluginId: tab.pluginId,
                id: tab.id,
                title: tab.title,
                payload: tab.payload,
              })
            )
        }}
        onSelect={(key) =>
          update((previous) => ({
            ...previous,
            selected: key,
            guide: previous.guide || key === GUIDE,
            expanded: true,
          }))
        }
        onClose={(key) => update((previous) => closeSidebarTab(previous, key))}
        onCollapse={() =>
          update((previous) => ({ ...previous, expanded: false }))
        }
        onExpand={() =>
          update((previous) => {
            const retained = previous.tabs.some(
              (tab) =>
                tabKey(tab) === previous.selected &&
                entries.some(
                  (entry) =>
                    entry.pluginId === tab.pluginId && entry.id === tab.id
                )
            )
            if ((previous.selected === GUIDE && previous.guide) || retained)
              return { ...previous, expanded: true }
            const doors = entries.filter(
              (entry) => !entry.resource && !entry.unavailable
            )
            if (doors.length > 0)
              return openSidebarTab(previous, {
                pluginId: doors[0].pluginId,
                id: doors[0].id,
                title: doors[0].title,
              })
            return { ...previous, guide: true, selected: GUIDE, expanded: true }
          })
        }
        onWidthChange={(width) =>
          update((previous) => ({
            ...previous,
            width: Math.max(320, Math.min(720, width)),
          }))
        }
      >
        {layoutWriteError && (
          <Alert>
            <AlertDescription>{layoutWriteError}</AlertDescription>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  saveSidebarLayout(sessionId, layout)
                  setLayoutWriteError("")
                } catch {
                  setLayoutWriteError(
                    "插件面板布局仍未保存，请检查本机存储后重试。"
                  )
                }
              }}
            >
              重试保存布局
            </Button>
          </Alert>
        )}
        {children}
      </PluginSidebar>
    </SessionContext>
  )
}

export function PluginDelivery({
  delivery,
  records = [delivery],
}: {
  delivery: ExtensionPresentation
  records?: ExtensionPresentation[]
}) {
  const host = usePluginSession()
  const entry = host?.modules.find(
    (entry) =>
      entry.descriptor.id === delivery.pluginId &&
      entry.descriptor.state === "active"
  )
  const Component = entry?.descriptor.contributions.some(
    (c) =>
      c.kind === "delivery" &&
      c.id === delivery.kind &&
      c.version === delivery.version &&
      (!isRemoteWeb() || c.remote)
  )
    ? entry.module?.deliveries?.find(
        (item) => item.id === delivery.kind && item.version === delivery.version
      )?.component
    : undefined
  const summary = records
    .map((record) => record.summary || "已有交付记录，当前无法加载专用展示。")
    .join("\n")
  return (
    <div className="plugin-delivery" data-plugin={delivery.pluginId}>
      {Component && host && delivery.pluginId && entry ? (
        <DeliveryBoundary
          key={`${delivery.pluginId}:${entry.descriptor.generation}:${delivery.kind}:${delivery.version}`}
          fallback={summary}
        >
          <Component
            delivery={delivery}
            deliveries={records}
            context={host.context(delivery.pluginId)}
          />
        </DeliveryBoundary>
      ) : (
        <p>{summary}</p>
      )}
    </div>
  )
}
import { Component as ReactComponent } from "react"
class DeliveryBoundary extends ReactComponent<
  { children: ReactNode; fallback: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div role="alert">
        <p>交付视图加载失败。以下为已保存的交付摘要：</p>
        <p>{this.props.fallback}</p>
      </div>
    ) : (
      this.props.children
    )
  }
}

export function PluginDeliveryList({
  records,
}: {
  records: ExtensionPresentation[]
}) {
  const groups = new Map<string, ExtensionPresentation[]>()
  for (const record of records) {
    const key = `${record.pluginId || "legacy"}:${record.kind}:${record.version}`
    const group = groups.get(key) || []
    group.push(record)
    groups.set(key, group)
  }
  return (
    <div aria-label="本轮交付">
      {[...groups].map(([key, group]) => (
        <PluginDelivery key={key} delivery={group[0]} records={group} />
      ))}
    </div>
  )
}
