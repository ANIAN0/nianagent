import { Component, useEffect, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider, useTheme } from "@/components/theme-provider"
import { DeveloperHeader } from "@/features/developer-tools/developer-header"
import type { DeveloperSearchItem } from "@/features/developer-tools/developer-header"
import { TooltipProvider } from "@/components/ui/tooltip"
import { NotificationToaster } from "@/components/ui/notification-toast"
import { Button } from "@/components/ui/button"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { useToolSearch } from "./location"
import "@/index.css"
import "./devtools.css"

const loadSearch = import.meta.env.DEV
  ? (publish?: (items: DeveloperSearchItem[]) => void) =>
      import("./content-index").then((module) =>
        module.loadDeveloperSearch(publish)
      )
  : undefined

class ToolBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    return this.state.error ? (
      <div className="devtools-loading">
        <OperationFeedback
          title="页面载入失败"
          message={this.state.error}
          notify={false}
          actions={
            <Button variant="outline" onClick={() => location.reload()}>
              重新载入
            </Button>
          }
        />
      </div>
    ) : (
      this.props.children
    )
  }
}

function ToolPage({ title, children }: { title: string; children: ReactNode }) {
  const search = useToolSearch()
  const urlTheme = new URLSearchParams(search).get("theme")
  const { setTheme } = useTheme()
  useEffect(() => {
    if (urlTheme === "dark" || urlTheme === "light") setTheme(urlTheme)
  }, [urlTheme, setTheme])
  return (
    <div className="devtools-app reader-surface">
      <a className="devtools-skip" href="#devtools-content">
        跳到内容
      </a>
      <DeveloperHeader title={title} loadSearch={loadSearch} />
      <ToolBoundary>{children}</ToolBoundary>
      <NotificationToaster />
    </div>
  )
}

export function mountTool(title: string, page: ReactNode) {
  document.title = `Moon · ${title}`
  const root = createRoot(document.getElementById("root")!)
  if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
  root.render(
    <ThemeProvider
      storageKey="moon-developer-theme"
      defaultTheme={
        new URLSearchParams(location.search).get("theme") === "dark"
          ? "dark"
          : "light"
      }
    >
      <TooltipProvider>
        <ToolPage title={title}>{page}</ToolPage>
      </TooltipProvider>
    </ThemeProvider>
  )
}
