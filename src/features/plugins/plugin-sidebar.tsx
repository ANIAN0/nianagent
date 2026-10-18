import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type ComponentType,
} from "react"
import {
  Box,
  Compass,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  X,
} from "lucide-react"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  GUIDE,
  tabKey,
  type PluginTab,
  type PluginSidebarLayout,
} from "./plugin-sidebar-state"
import "./plugin-sidebar.css"

export type PluginSidebarEntry = {
  pluginId: string
  id: string
  title: string
  owner: string
  pending: number
  resource?: boolean
  unavailable?: boolean
  icon?: ComponentType<{ className?: string }>
  description?: string
  render: (tab: PluginTab, visible: boolean) => ReactNode
}
const Controls = createContext<null | {
  expanded: boolean
  pending: number
  available: boolean
  open: () => void
}>(null)

/** A core window control, never an arbitrary plugin header contribution. */
export function PluginSidebarToggle() {
  const controls = useContext(Controls)
  if (!controls || controls.expanded || !controls.available) return null
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="plugin-sidebar-toggle"
      aria-label={
        controls.pending
          ? `打开右侧栏，${controls.pending} 项待回复`
          : "打开右侧栏"
      }
      title="打开右侧栏"
      aria-expanded={false}
      onClick={controls.open}
    >
      <PanelRightOpen />
      {!!controls.pending && (
        <span className="plugin-sidebar-attention" aria-hidden />
      )}
    </Button>
  )
}

export function PluginSidebar({
  sessionId,
  active,
  layout,
  entries,
  error,
  recovery,
  onOpen,
  onSelect,
  onClose,
  onCollapse,
  onExpand,
  onWidthChange,
  children,
}: {
  sessionId: string
  recovery?: ReactNode
  active: boolean
  layout: PluginSidebarLayout
  entries: PluginSidebarEntry[]
  error?: string
  onOpen: (tab: PluginTab) => void
  onSelect: (key: string) => void
  onClose: (key: string) => void
  onCollapse: () => void
  onExpand: () => void
  onWidthChange: (width: number) => void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLElement>(null)
  const track = useRef<PanelImperativeHandle>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const wasExpanded = useRef(false)
  const previousSelection = useRef(layout.selected)
  const [room, setRoom] = useState(0)
  const [trackWidth, setTrackWidth] = useState(layout.width)
  const [fullscreen, setFullscreen] = useState(false)
  const compact = room > 0 && room < 768
  const overlay = fullscreen || compact
  const opened = layout.tabs.filter((tab) =>
    entries.some(
      (entry) => entry.pluginId === tab.pluginId && entry.id === tab.id
    )
  )
  const expanded =
    active && layout.expanded && (layout.guide || opened.length > 0)
  const pending = new Map(
    entries.map((entry) => [entry.pluginId, entry.pending])
  )
  const pendingCount = [...pending.values()].reduce(
    (sum, count) => sum + count,
    0
  )
  useLayoutEffect(() => {
    if (!root.current) return
    setRoom(root.current.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) =>
      setRoom(entry.contentRect.width)
    )
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (
      expanded &&
      (!wasExpanded.current || previousSelection.current !== layout.selected)
    ) {
      if (!wasExpanded.current)
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
      if (!pane.current?.contains(document.activeElement))
        pane.current?.focus({ preventScroll: true })
    } else if (!expanded && wasExpanded.current) {
      const previous = returnFocus.current
      if (previous?.isConnected && !previous.closest("[hidden], [inert]"))
        previous.focus({ preventScroll: true })
      else
        root.current
          ?.querySelector<HTMLButtonElement>(".plugin-sidebar-toggle")
          ?.focus({ preventScroll: true })
    }
    wasExpanded.current = expanded
    previousSelection.current = layout.selected
  }, [expanded, layout.selected])
  useEffect(() => {
    if (overlay && expanded && !pane.current?.contains(document.activeElement))
      pane.current?.focus({ preventScroll: true })
  }, [overlay, expanded])
  const definition = (tab: PluginTab) =>
    entries.find(
      (entry) => entry.pluginId === tab.pluginId && entry.id === tab.id
    )
  const doors = entries.filter((entry) => !entry.resource && !entry.unavailable)
  const focusSelected = (key: string) => {
    requestAnimationFrame(() => {
      const target = Array.from(
        pane.current?.querySelectorAll<HTMLElement>("[role='tab']") || []
      ).find((node) => node.dataset.tabKey === key)
      target?.focus({ preventScroll: true })
    })
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return
    if (
      event.key === "Escape" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !(event.target as HTMLElement).closest(
        "[role='menu'], [role='dialog'], [data-escape-handled]"
      )
    ) {
      event.preventDefault()
      event.stopPropagation()
      onCollapse()
    }
    if (overlay && event.key === "Tab") {
      const targets = Array.from(
        pane.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex='0']"
        ) || []
      ).filter(
        (node) =>
          !node.closest("[hidden], [inert]") && node.getClientRects().length
      )
      const first = targets[0],
        last = targets.at(-1)
      if (
        (event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === pane.current)) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
  }
  return (
    <Controls
      value={{
        expanded,
        pending: pendingCount,
        available: active && (!!entries.length || !!error),
        open: onExpand,
      }}
    >
      <div
        ref={root}
        className="plugin-session-host"
        data-sidebar-presentation={overlay ? "fullscreen" : "push"}
      >
        <ResizablePanelGroup
          orientation="horizontal"
          onLayoutChanged={(_sizes, meta) => {
            if (meta.isUserInteraction && expanded && !overlay) {
              const width = track.current?.getSize().inPixels
              if (width) onWidthChange(Math.round(width))
            }
          }}
        >
          <ResizablePanel id="conversation" minSize={compact ? 0 : "360px"}>
            <div className="plugin-session-main" inert={expanded && overlay}>
              {children}
            </div>
          </ResizablePanel>
          {expanded && !compact && (
            <>
              <ResizableHandle
                aria-label="调整右侧栏宽度"
                disabled={fullscreen}
                aria-hidden={fullscreen || undefined}
              />
              <ResizablePanel
                id="plugin-track"
                panelRef={track}
                defaultSize={`${layout.width}px`}
                minSize="320px"
                maxSize={`${Math.min(720, Math.max(320, room - 360))}px`}
                onResize={(size) => setTrackWidth(size.inPixels)}
              >
                <div aria-hidden />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <aside
          ref={pane}
          className="plugin-session-pane"
          aria-label="会话右侧栏"
          tabIndex={-1}
          hidden={!expanded}
          inert={!expanded}
          onKeyDown={keydown}
          style={{ "--plugin-pane-width": `${trackWidth}px` } as CSSProperties}
        >
          <Tabs
            value={layout.selected}
            onValueChange={onSelect}
            className="plugin-pane-tabs"
          >
            <header className="plugin-pane-strip">
              <div className="plugin-pane-tab-scroll">
                <TabsList variant="line" aria-label="已打开的插件标签">
                  {layout.guide && (
                    <div className="plugin-pane-tab">
                      <TabsTrigger value={GUIDE} data-tab-key={GUIDE}>
                        <Compass data-icon="inline-start" />
                        插件
                      </TabsTrigger>
                      {!!opened.length && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="关闭插件入口页"
                          onClick={() => {
                            onClose(GUIDE)
                            focusSelected(tabKey(opened[0]))
                          }}
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  )}
                  {opened.map((tab, index) => {
                    const key = tabKey(tab),
                      entry = definition(tab)!
                    const Icon = entry.icon
                    return (
                      <div
                        className="plugin-pane-tab"
                        key={key}
                        data-selected={layout.selected === key}
                      >
                        <TabsTrigger
                          value={key}
                          data-tab-key={key}
                          title={tab.title || entry.title}
                        >
                          {Icon && <Icon />}
                          <span className="truncate">
                            {tab.title || entry.title}
                          </span>
                          {!!entry.pending && (
                            <span
                              className="plugin-tab-pending"
                              aria-label={`${entry.pending} 项待回复`}
                            >
                              待回复
                            </span>
                          )}
                        </TabsTrigger>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`关闭${tab.title || entry.title}`}
                          onClick={() => {
                            onClose(key)
                            if (layout.selected === key) {
                              const next =
                                opened[index + 1] || opened[index - 1]
                              if (next) focusSelected(tabKey(next))
                              else if (layout.guide) focusSelected(GUIDE)
                            } else focusSelected(layout.selected)
                          }}
                        >
                          <X />
                        </Button>
                      </div>
                    )
                  })}
                </TabsList>
              </div>
              <div className="plugin-pane-controls">
                {!layout.guide && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="打开插件入口"
                    title="打开插件入口"
                    onClick={() => onSelect(GUIDE)}
                  >
                    <Plus />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    overlay
                      ? compact
                        ? "退出全屏并返回会话"
                        : "还原分栏"
                      : "全屏查看右侧栏"
                  }
                  title={
                    overlay
                      ? compact
                        ? "退出全屏并返回会话"
                        : "还原分栏"
                      : "全屏查看右侧栏"
                  }
                  onClick={() => {
                    if (room < 768 && overlay) {
                      setFullscreen(false)
                      onCollapse()
                    } else setFullscreen((value) => !value)
                  }}
                >
                  {overlay ? <Minimize2 /> : <Maximize2 />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={overlay ? "返回会话" : "收起右侧栏"}
                  title={overlay ? "返回会话" : "收起右侧栏"}
                  onClick={onCollapse}
                >
                  <PanelRightClose />
                </Button>
              </div>
            </header>
            {error && (
              <Alert className="plugin-pane-error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {layout.guide && (
              <TabsContent
                value={GUIDE}
                forceMount
                hidden={layout.selected !== GUIDE}
                className="plugin-pane-body"
              >
                {recovery}
                {doors.length ? (
                  <nav className="plugin-guide" aria-label="会话插件入口">
                    <Compass className="plugin-guide-compass" aria-hidden />
                    <div className="plugin-guide-entries">
                      {doors.map((entry) => {
                        const Icon = entry.icon || Box
                        return (
                          <Button
                            key={tabKey({
                              pluginId: entry.pluginId,
                              id: entry.id,
                            })}
                            variant="sidebar-entry"
                            size="sidebar-entry"
                            onClick={() =>
                              onOpen({ pluginId: entry.pluginId, id: entry.id })
                            }
                          >
                            <Icon className="plugin-guide-entry-icon" />
                            <span className="plugin-guide-entry-text">
                              <span>{entry.title}</span>
                              {doors.length <= 4 && entry.description && (
                                <span className="plugin-guide-description">
                                  {entry.description}
                                </span>
                              )}
                            </span>
                            {!!entry.pending && (
                              <Badge variant="secondary">待回复</Badge>
                            )}
                          </Button>
                        )
                      })}
                    </div>
                  </nav>
                ) : !recovery ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>暂无可用的会话插件</EmptyTitle>
                      <EmptyDescription>
                        在插件详情启用提供会话标签的插件。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : null}
              </TabsContent>
            )}
            {opened.map((tab) => {
              const key = tabKey(tab),
                entry = definition(tab)!
              const visible = expanded && layout.selected === key
              return (
                <TabsContent
                  key={`${sessionId}:${key}`}
                  value={key}
                  forceMount
                  hidden={!visible}
                  inert={!visible}
                  className="plugin-pane-body"
                >
                  {entry.render(tab, visible)}
                </TabsContent>
              )
            })}
          </Tabs>
        </aside>
      </div>
    </Controls>
  )
}
