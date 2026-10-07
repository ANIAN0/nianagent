import { TooltipProvider } from "@/components/ui/tooltip"
import { ComposerToaster } from "@/components/composer/composer-notification"
import { Component, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { loadCatalogEntry } from "./catalog-loader"
import type { CatalogEntry } from "./catalog-types"
import { CatalogComponentShell } from "./catalog-component-shell"
import { readStorySection } from "./catalog-sections"
import "@/index.css"
import { installPreviewStorage } from "./fixtures/memory-storage"
import { CatalogPreviewStatus } from "./catalog-preview-status"

installPreviewStorage()
const embedded =
  new URLSearchParams(location.search).get("embedded") === "1" &&
  window.parent !== window

function reportStatus(status: "ready" | "error", message?: string) {
  window.parent.postMessage(
    { type: "moon-preview-status", status, message, search: location.search },
    location.origin
  )
}

function PreviewError({ message }: { message: string }) {
  useEffect(() => {
    reportStatus("error", message)
  }, [message])
  return (
    <main className="catalog-standalone-status" hidden={embedded}>
      {!embedded && (
        <CatalogPreviewStatus
          error={message}
          onRetry={() => location.reload()}
        />
      )}
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
const component = params.get("component") ?? "home-composer"
const requestedState = params.get("state")

function SelectedState({ entry }: { entry: CatalogEntry }) {
  const stateId = requestedState ?? entry.states[0]?.id ?? "default"
  const state = entry.states.find((item) => item.id === stateId)
  const [released, setReleased] = useState(!embedded)
  useEffect(() => {
    if (!embedded || (!state && entry.stage !== "structure")) return
    // Block initial focus inside the child document, not only on its iframe.
    const release = requestAnimationFrame(() => setReleased(true))
    return () => cancelAnimationFrame(release)
  }, [state, entry.stage])
  useEffect(() => {
    if (released && (state || entry.stage === "structure"))
      reportStatus("ready")
  }, [released, state, entry.stage])
  if (!state && entry.stage !== "structure")
    return <PreviewError message={`找不到状态：${stateId}`} />
  return (
    <div inert={!released} style={{ display: "contents" }}>
      {entry.stage === "structure" ? (
        <CatalogComponentShell
          section={
            entry.layer === "复合组件"
              ? readStorySection(params.get("section"))
              : undefined
          }
        />
      ) : (
        state!.render()
      )}
    </div>
  )
}

function PreviewApplication() {
  const [result, setResult] = useState<{
    entry?: CatalogEntry
    error?: string
  }>({})
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
  }, [])
  if (result.error)
    return <PreviewError message={`组件载入失败：${result.error}`} />
  if (!result.entry)
    return (
      <main className="catalog-standalone-status" hidden={embedded}>
        {!embedded && <CatalogPreviewStatus />}
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
