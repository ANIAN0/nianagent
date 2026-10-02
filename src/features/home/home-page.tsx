import { useEffect, useState } from "react"
import { PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HomeComposer } from "./home-composer"
import { HomeSidebar } from "./home-sidebar"
import { ConversationSearch } from "./conversation-search"
import type { HomeData, SubmitWork } from "./home-types"

export function HomePage({
  data,
  onSubmit,
}: {
  data: HomeData
  onSubmit: SubmitWork
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string>()
  const [draftKey, setDraftKey] = useState(0)
  const [notice, setNotice] = useState("")
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault()
        setSearchOpen((open) => !open)
        setMobileOpen(false)
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault()
        if (window.matchMedia("(min-width: 768px)").matches)
          setSidebarOpen((open) => !open)
        else setMobileOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])
  const sidebarProps = {
    data,
    onClose: () => setSidebarOpen((open) => !open),
    onNew: (id?: string) => {
      setWorkspaceId(id)
      setDraftKey((key) => key + 1)
      setMobileOpen(false)
      setNotice("")
    },
    onSearch: () => {
      setMobileOpen(false)
      setSearchOpen(true)
    },
    onNotice: (message: string) => {
      setMobileOpen(false)
      setNotice(message)
    },
  }
  function resize(width: number) {
    setSidebarWidth(Math.max(240, Math.min(360, width)))
  }
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
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
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开导航"
          className="absolute top-3 left-3 z-10 md:hidden"
          onClick={() => setMobileOpen(true)}
        >
          <PanelLeft />
        </Button>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <HomeComposer
            key={draftKey}
            data={data}
            initialDraft={{ workspaceId }}
            onSubmit={onSubmit}
          />
        </div>
      </main>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className="inset-y-0 left-0 h-dvh w-80 max-w-[calc(100vw-48px)] translate-x-0 translate-y-0 gap-0 rounded-none p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Moon 导航</DialogTitle>
            <DialogDescription>导航和模拟历史会话</DialogDescription>
          </DialogHeader>
          <HomeSidebar {...sidebarProps} onClose={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>
      <ConversationSearch
        data={data}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSelect={(item) =>
          setNotice(`“${item.title}”是模拟历史记录，对话页面尚未实现。`)
        }
      />
      <Dialog
        open={!!notice}
        onOpenChange={(open) => {
          if (!open) setNotice("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>首页演示</DialogTitle>
            <DialogDescription>{notice}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  )
}
