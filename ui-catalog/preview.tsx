import { TooltipProvider } from "@/components/ui/tooltip"
import { Component, useEffect, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { readSelection } from "./catalog"
import "@/index.css"
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
      <main role="alert" className="p-6">
        预览渲染失败：{this.state.error}
      </main>
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
const selection = readSelection()
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
      <PreviewBoundary>
        {!selection.entry ? (
          <p role="alert">找不到组件：{selection.component}</p>
        ) : !selection.state ? (
          <p role="alert">找不到状态：{selection.stateId}</p>
        ) : (
          selection.state.render()
        )}
      </PreviewBoundary>
    </TooltipProvider>
  </ThemeProvider>
)
