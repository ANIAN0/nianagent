import { TooltipProvider } from "@/components/ui/tooltip"
import { ComposerToaster } from "@/components/composer/composer-notification"
import { Button } from "@/components/ui/button"
import { Component, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { loadCatalogEntry } from "./catalog-loader"
import type { CatalogEntry } from "./catalog-types"
import "@/index.css"

function reportStatus(status: "ready" | "error", message?: string) {
  window.parent.postMessage(
    { type: "moon-preview-status", status, message, search: location.search },
    location.origin
  )
}

function PreviewError({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  useEffect(() => {
    reportStatus("error", message)
  }, [message])
  return (
    <main role="alert" className="p-6 text-sm">
      <p>{message}</p>
      <div className="mt-3 flex gap-3">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试载入
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => location.reload()}>
          重新加载页面
        </Button>
      </div>
    </main>
  )
}

class PreviewBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    return this.state.error ? (
      <PreviewError message={`预览渲染失败：${this.state.error}`} />
    ) : (
      this.props.children
    )
  }
}
function PreviewSizeReporter() {
  useEffect(() => {
    if (new URLSearchParams(location.search).get("mode") !== "overview") return
    const root = document.getElementById("root")!
    const report = () =>
      window.parent.postMessage(
        {
          type: "moon-preview-size",
          height: root.getBoundingClientRect().height,
          search: location.search,
        },
        location.origin
      )
    const observer = new ResizeObserver(report)
    observer.observe(root)
    report()
    return () => observer.disconnect()
  }, [])
  return null
}
const params = new URLSearchParams(location.search)
const component = params.get("component") ?? "home-page"
const requestedState = params.get("state")

function SelectedState({ entry }: { entry: CatalogEntry }) {
  const stateId = requestedState ?? entry.states[0]?.id ?? "default"
  const state = entry.states.find((item) => item.id === stateId)
  useEffect(() => {
    if (state) reportStatus("ready")
  }, [state])
  if (!state) return <PreviewError message={`找不到状态：${stateId}`} />
  return state.render()
}

function PreviewApplication() {
  const [result, setResult] = useState<{
    entry?: CatalogEntry
    error?: string
  }>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    loadCatalogEntry(component).then(
      (entry) => {
        if (active) setResult({ entry })
      },
      (error: unknown) => {
        if (active)
          setResult({
            error: error instanceof Error ? error.message : "组件载入失败",
          })
      }
    )
    return () => {
      active = false
    }
  }, [attempt])
  if (result.error)
    return (
      <PreviewError
        message={`组件载入失败：${result.error}`}
        onRetry={() => {
          setResult({})
          setAttempt((value) => value + 1)
        }}
      />
    )
  if (!result.entry)
    return (
      <main className="p-6 text-sm" role="status" aria-live="polite">
        正在载入组件…
      </main>
    )
  return (
    <PreviewBoundary>
      <SelectedState entry={result.entry} />
    </PreviewBoundary>
  )
}

const theme =
  new URLSearchParams(location.search).get("theme") === "dark"
    ? "dark"
    : "light"
const root = createRoot(document.getElementById("root")!)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
root.render(
  <ThemeProvider defaultTheme={theme} storageKey={null}>
    <PreviewSizeReporter />
    <TooltipProvider>
      <PreviewApplication />
      <ComposerToaster />
    </TooltipProvider>
  </ThemeProvider>
)
