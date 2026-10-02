import { useState } from "react"
import { PanelLeftOpen } from "lucide-react"
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

export function HomePage() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [draftKey, setDraftKey] = useState(0)
  const [notice, setNotice] = useState("")
  const sidebarProps = {
    onClose: () => {
      setSidebarOpen(false)
      setMobileOpen(false)
    },
    onNew: () => {
      setDraftKey((key) => key + 1)
      setMobileOpen(false)
      setNotice("")
    },
    onNotice: (message: string) => {
      setMobileOpen(false)
      setNotice(message)
    },
  }
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {sidebarOpen && (
        <aside className="hidden w-64 shrink-0 border-r md:block">
          <HomeSidebar {...sidebarProps} />
        </aside>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="打开导航"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <PanelLeftOpen />
          </Button>
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="展开侧栏"
              className="hidden md:inline-flex"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen />
            </Button>
          )}
          <span className="text-sm text-muted-foreground">新建会话</span>
        </header>
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="my-auto w-full py-8">
            <HomeComposer key={draftKey} />
          </div>
        </div>
      </main>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          className="inset-y-0 left-0 h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Moon 导航</DialogTitle>
            <DialogDescription>导航和模拟历史会话</DialogDescription>
          </DialogHeader>
          <HomeSidebar {...sidebarProps} />
        </DialogContent>
      </Dialog>
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
