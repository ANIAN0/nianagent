import type { FeedbackDescription } from "@/lib/operation-issue"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HomeSidebar } from "./home-sidebar"
import { ConversationSearch } from "./conversation-search"
import type { HomeData, Conversation } from "./home-types"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"
import { useNavigationBoundary } from "./navigation-boundary"

export function AppShell({
  data,
  activeConversationId,
  onNew,
  onSelectConversation,
  onSettings,
  historyState,
  historyError,
  historyIssue,
  onHistoryRetry,
  children,
}: {
  data: HomeData
  activeConversationId?: string
  onNew: (workspaceId?: string) => void
  onSelectConversation: (conversation: Conversation) => void
  onSettings?: () => void
  historyState?: HistoryState
  historyError?: string
  historyIssue?: FeedbackDescription
  onHistoryRetry?: () => void
  children: ReactNode
}) {
  const { run: runNavigation, blocked: navigationBlocked } =
    useNavigationBoundary()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [notice, setNotice] = useState("")
  const main = useRef<HTMLElement>(null)
  const focusNewHomeAfterClose = useRef(false)
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault()
        runNavigation(() => {
          setSearchOpen((open) => !open)
          setMobileOpen(false)
        })
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault()
        runNavigation(() => {
          if (window.matchMedia("(min-width: 768px)").matches)
            setSidebarOpen((open) => !open)
          else setMobileOpen((open) => !open)
        })
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [runNavigation])
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
    onClose: () => runNavigation(() => setSidebarOpen((open) => !open)),
    onNew: (id?: string) => {
      runNavigation(() => {
        focusNewHomeAfterClose.current = mobileOpen
        onNew(id)
        setMobileOpen(false)
        setNotice("")
      })
    },
    onSearch: () => {
      runNavigation(() => {
        setMobileOpen(false)
        setSearchOpen(true)
      })
    },
    onSettings: onSettings
      ? () => {
          runNavigation(() => {
            setMobileOpen(false)
            onSettings()
          })
        }
      : undefined,
    onNotice: (message: string) => {
      runNavigation(() => {
        setMobileOpen(false)
        setNotice(message)
      })
    },
  }
  function resize(width: number) {
    setSidebarWidth(Math.max(240, Math.min(360, width)))
  }
  return (
    <div
      data-sidebar={sidebarOpen ? "expanded" : "collapsed"}
      className="flex h-dvh overflow-hidden bg-background text-foreground"
    >
      <aside
        className="relative hidden shrink-0 border-r border-sidebar-border md:block"
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
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                resize(event.clientX)
            }}
            onPointerUp={(event) =>
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          />
        )}
      </aside>
      <main ref={main} className="relative flex min-w-0 flex-1 flex-col">
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开导航"
          className="absolute top-3 left-3 z-10 md:hidden"
          disabled={navigationBlocked}
          onClick={() => runNavigation(() => setMobileOpen(true))}
        >
          <PanelLeft />
        </Button>
        {children}
      </main>
      <Dialog
        open={mobileOpen && !navigationBlocked}
        onOpenChange={(open) => runNavigation(() => setMobileOpen(open))}
      >
        <DialogContent
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
          className="inset-y-0 left-0 h-dvh w-80 max-w-[calc(100vw-48px)] translate-x-0 translate-y-0 gap-0 rounded-none p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Moon 导航</DialogTitle>
            <DialogDescription>导航与本地历史会话</DialogDescription>
          </DialogHeader>
          <HomeSidebar
            {...sidebarProps}
            onClose={() => runNavigation(() => setMobileOpen(false))}
          />
        </DialogContent>
      </Dialog>
      <ConversationSearch
        data={data}
        historyState={historyState}
        historyError={historyError}
        historyIssue={historyIssue}
        onHistoryRetry={onHistoryRetry}
        open={searchOpen && !navigationBlocked}
        onOpenChange={(open) => runNavigation(() => setSearchOpen(open))}
        onSelect={(item) => runNavigation(() => onSelectConversation(item))}
      />
      <Dialog
        open={!!notice}
        onOpenChange={(open) => {
          if (!open) setNotice("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Moon</DialogTitle>
            <DialogDescription>{notice}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}
