import type { FeedbackDescription } from "@/lib/operation-issue"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { notifyToast } from "@/components/ui/notification-toast"
import { HomeSidebar } from "./home-sidebar"
import type { PrimaryNavigationActive } from "./primary-navigation"
import { ConversationSearch } from "./conversation-search"
import type { ConversationRowActions } from "./conversation-row-menu"
import type {
  ComposerData,
  Conversation,
  Workspace,
} from "@/lib/composer/types"
import type { HistoryState } from "@/lib/submission/conversation-handoff"
import { useNavigationBoundary } from "@/lib/navigation/navigation-boundary"

const sidebarLayoutKey = "moon.navigation.layout.v1"
const wideNavigationQuery = "(min-width: 1024px)"
const desktopNavigationQuery = "(min-width: 768px)"

const clampSidebarWidth = (width: number) => Math.max(240, Math.min(360, width))

type SidebarDrag = {
  pointerId: number
  startX: number
  startWidth: number
  width: number
  frame: number | null
}

function readSidebarLayout() {
  try {
    const raw = localStorage.getItem(sidebarLayoutKey)
    if (raw === null) return { open: true, width: 280, storageError: "" }
    const saved = JSON.parse(raw)
    if (
      !saved ||
      typeof saved.open !== "boolean" ||
      !Number.isFinite(saved.width)
    )
      throw new Error("Invalid navigation preferences")
    return {
      open: saved.open as boolean,
      width: clampSidebarWidth(saved.width),
      storageError: "",
    }
  } catch {
    return {
      open: true,
      width: 280,
      storageError:
        "导航布局无法读取，原记录保留，当前无法保存布局调整。请检查本机存储后重新加载。",
    }
  }
}

export function AppShell({
  data,
  activeConversationId,
  onNew,
  onSelectConversation,
  onSettings,
  onPlugins,
  rowActions,
  activeNav,
  historyState,
  historyError,
  historyIssue,
  onHistoryRetry,
  hideNavigation = false,
  children,
}: {
  data: ComposerData
  activeConversationId?: string
  onNew: (workspaceId?: string) => void
  onSelectConversation: (conversation: Conversation) => void
  onSettings?: () => void
  onPlugins?: () => void
  rowActions?: ConversationRowActions
  activeNav?: PrimaryNavigationActive
  historyState?: HistoryState
  historyError?: string
  historyIssue?: FeedbackDescription
  onHistoryRetry?: () => void
  hideNavigation?: boolean
  children: ReactNode
}) {
  const { run: runNavigation, blocked: navigationBlocked } =
    useNavigationBoundary()
  const [sidebarLayout, setSidebarLayout] = useState(readSidebarLayout)
  const [wideNavigation, setWideNavigation] = useState(
    () => window.matchMedia(wideNavigationQuery).matches
  )
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchTarget, setSearchTarget] = useState<Workspace | "all" | null>(
    null
  )
  const sidebar = useRef<HTMLElement>(null)
  const drag = useRef<SidebarDrag | null>(null)
  const main = useRef<HTMLElement>(null)
  const focusNewHomeAfterClose = useRef(false)
  useEffect(() => {
    if (sidebarLayout.storageError) {
      notifyToast(sidebarLayout.storageError, { tone: "warning" })
    }
  }, [sidebarLayout.storageError])
  const sidebarOpen = wideNavigation ? sidebarLayout.open : compactSidebarOpen
  const sidebarWidth = sidebarLayout.width
  const toggleSidebar = useCallback(() => {
    if (wideNavigation)
      setSidebarLayout((layout) => ({ ...layout, open: !layout.open }))
    else setCompactSidebarOpen((open) => !open)
  }, [wideNavigation])
  useEffect(() => {
    if (sidebarLayout.storageError) return
    let cancelled = false
    void Promise.resolve()
      .then(() => {
        if (cancelled) return
        localStorage.setItem(
          sidebarLayoutKey,
          JSON.stringify({
            open: sidebarLayout.open,
            width: sidebarLayout.width,
          })
        )
      })
      .catch(() => {
        if (!cancelled)
          notifyToast("导航布局调整未保存，请检查本机存储。", {
            tone: "warning",
          })
      })
    return () => {
      cancelled = true
    }
  }, [sidebarLayout])
  useEffect(() => {
    const wide = window.matchMedia(wideNavigationQuery)
    const desktop = window.matchMedia(desktopNavigationQuery)
    function updateNavigation() {
      setWideNavigation(wide.matches)
      setCompactSidebarOpen(false)
      if (desktop.matches) setMobileOpen(false)
    }
    wide.addEventListener("change", updateNavigation)
    desktop.addEventListener("change", updateNavigation)
    return () => {
      wide.removeEventListener("change", updateNavigation)
      desktop.removeEventListener("change", updateNavigation)
    }
  }, [])
  const startNewConversation = useCallback(
    (workspaceId?: string) =>
      runNavigation(() => {
        focusNewHomeAfterClose.current = mobileOpen
        onNew(workspaceId)
        setMobileOpen(false)
      }),
    [runNavigation, onNew, mobileOpen]
  )
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault()
        startNewConversation()
        return
      }
      if (
        !hideNavigation &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault()
        runNavigation(() => {
          setSearchTarget((target) => (target ? null : "all"))
          setMobileOpen(false)
        })
      }
      if (
        !hideNavigation &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault()
        runNavigation(() => {
          if (window.matchMedia(desktopNavigationQuery).matches) toggleSidebar()
          else setMobileOpen((open) => !open)
        })
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [hideNavigation, runNavigation, startNewConversation, toggleSidebar])
  function openSearch(workspace?: Workspace) {
    runNavigation(() => {
      setMobileOpen(false)
      setSearchTarget(workspace ?? "all")
    })
  }
  const sidebarProps = {
    data,
    activeConversationId,
    historyState,
    historyError,
    historyIssue,
    onHistoryRetry,
    onSelectConversation: (item: Conversation) => {
      runNavigation(() => {
        setMobileOpen(false)
        onSelectConversation(item)
      })
    },
    onClose: () => runNavigation(toggleSidebar),
    onNew: startNewConversation,
    onSearch: () => openSearch(),
    onSearchWorkspace: openSearch,
    onSettings: onSettings
      ? () => {
          runNavigation(() => {
            setMobileOpen(false)
            onSettings()
          })
        }
      : undefined,
    onPlugins: onPlugins
      ? () =>
          runNavigation(() => {
            setMobileOpen(false)
            onPlugins()
          })
      : undefined,
    onNotice: (message: string) => {
      runNavigation(() => {
        setMobileOpen(false)
        notifyToast(message, { tone: "info" })
      })
    },
    actions: rowActions,
    activeNav,
  }
  useLayoutEffect(
    () => () => {
      const frame = drag.current?.frame
      if (frame != null) cancelAnimationFrame(frame)
      drag.current = null
    },
    [sidebarOpen]
  )
  function resize(width: number) {
    const next = clampSidebarWidth(width)
    setSidebarLayout((layout) =>
      next === layout.width ? layout : { ...layout, width: next }
    )
  }
  function previewWidth(separator: HTMLElement, width: number) {
    if (sidebar.current) sidebar.current.style.width = `${width}px`
    separator.setAttribute("aria-valuenow", String(width))
  }
  function finishResize(
    separator: HTMLElement,
    pointerId: number,
    clientX?: number
  ) {
    const current = drag.current
    if (!current || current.pointerId !== pointerId) return
    drag.current = null
    if (current.frame != null) cancelAnimationFrame(current.frame)
    const width =
      clientX === undefined
        ? current.startWidth
        : clampSidebarWidth(current.startWidth + clientX - current.startX)
    previewWidth(separator, width)
    if (clientX !== undefined) resize(width)
  }
  return (
    <div
      data-sidebar={sidebarOpen ? "expanded" : "collapsed"}
      className="flex h-dvh overflow-hidden bg-background text-foreground"
    >
      <aside
        ref={sidebar}
        className={
          hideNavigation
            ? "hidden"
            : "relative hidden shrink-0 border-r border-sidebar-border md:block"
        }
        style={{ width: sidebarOpen ? sidebarWidth : 56 }}
      >
        <HomeSidebar {...sidebarProps} collapsed={!sidebarOpen} />
        {sidebarOpen && (
          <div
            role="separator"
            tabIndex={0}
            aria-label="调整侧栏宽度"
            aria-orientation="vertical"
            aria-valuemin={240}
            aria-valuemax={360}
            aria-valuenow={sidebarWidth}
            className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-primary/15 focus-visible:bg-primary/30"
            onDoubleClick={() => resize(280)}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault()
                resize(
                  event.key === "Home"
                    ? 240
                    : event.key === "End"
                      ? 360
                      : sidebarWidth + (event.key === "ArrowRight" ? 8 : -8)
                )
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startWidth: sidebarWidth,
                width: sidebarWidth,
                frame: null,
              }
            }}
            onPointerMove={(event) => {
              const current = drag.current
              if (!current || current.pointerId !== event.pointerId) return
              current.width = clampSidebarWidth(
                current.startWidth + event.clientX - current.startX
              )
              if (current.frame != null) return
              const separator = event.currentTarget
              current.frame = requestAnimationFrame(() => {
                current.frame = null
                previewWidth(separator, current.width)
              })
            }}
            onPointerUp={(event) =>
              finishResize(event.currentTarget, event.pointerId, event.clientX)
            }
            onPointerCancel={(event) =>
              finishResize(event.currentTarget, event.pointerId)
            }
            onLostPointerCapture={(event) =>
              finishResize(event.currentTarget, event.pointerId)
            }
          />
        )}
      </aside>
      <Sheet
        open={mobileOpen && !navigationBlocked && !hideNavigation}
        onOpenChange={(open) => runNavigation(() => setMobileOpen(open))}
      >
        <main
          ref={main}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {!hideNavigation && (
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="打开导航"
                className="absolute top-3 left-3 z-10 md:hidden"
                disabled={navigationBlocked}
              >
                <PanelLeft />
              </Button>
            </SheetTrigger>
          )}
          {children}
        </main>
        <SheetContent
          side="left"
          onCloseAutoFocus={(event) => {
            if (!focusNewHomeAfterClose.current) return
            focusNewHomeAfterClose.current = false
            event.preventDefault()
            requestAnimationFrame(() =>
              main.current
                ?.querySelector<HTMLElement>("[data-composer-editor]")
                ?.focus({ preventScroll: true })
            )
          }}
          className="h-dvh min-h-0 max-w-[calc(100vw-48px)] min-w-0 gap-0 overflow-hidden p-0 data-[side=left]:w-80"
          showCloseButton={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>moon 导航</SheetTitle>
            <SheetDescription>导航与本地历史会话</SheetDescription>
          </SheetHeader>
          <HomeSidebar
            {...sidebarProps}
            shortcuts={false}
            onClose={() => runNavigation(() => setMobileOpen(false))}
          />
        </SheetContent>
      </Sheet>
      <ConversationSearch
        data={data}
        historyState={historyState}
        historyError={historyError}
        historyIssue={historyIssue}
        onHistoryRetry={onHistoryRetry}
        workspace={
          searchTarget && searchTarget !== "all" ? searchTarget : undefined
        }
        open={!!searchTarget && !navigationBlocked && !hideNavigation}
        onOpenChange={(open) =>
          runNavigation(() =>
            setSearchTarget((target) => (open ? (target ?? "all") : null))
          )
        }
        onSelect={(item) => runNavigation(() => onSelectConversation(item))}
      />
    </div>
  )
}
