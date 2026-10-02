import { useEffect, useState, useSyncExternalStore } from "react"
import { Moon, ArrowUpRight, Download } from "lucide-react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { readSelection, catalogUrl, type CatalogEntry } from "./catalog"
import { CatalogNavigation } from "./catalog-navigation"
import { CatalogDocs } from "./catalog-docs"
import { CatalogOverview } from "./catalog-overview"
import "@/index.css"
import "./catalog.css"
import designUrl from "../DESIGN.md?url"

const narrowMedia = window.matchMedia("(max-width: 959px)")
const subscribeNarrow = (callback: () => void) => {
  narrowMedia.addEventListener("change", callback)
  return () => narrowMedia.removeEventListener("change", callback)
}
function Catalog() {
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => narrowMedia.matches
  )
  const [selection, setSelection] = useState(() => readSelection())
  const [width, setWidth] = useState(selection.entry?.viewport.width ?? 800)
  const [height, setHeight] = useState(selection.entry?.viewport.height ?? 600)
  const [theme, setTheme] = useState("light")
  const [revision, setRevision] = useState(0)
  const [panel, setPanel] = useState("preview")
  useEffect(() => {
    const change = () => {
      const next = readSelection()
      setSelection(next)
      setWidth(next.entry?.viewport.width ?? 800)
      setHeight(next.entry?.viewport.height ?? 600)
    }
    window.addEventListener("popstate", change)
    return () => window.removeEventListener("popstate", change)
  }, [])
  const { entry, state } = selection
  const previewUrl = `./preview.html?${new URLSearchParams({ component: selection.component, state: selection.stateId, theme })}`
  function navigate(item: CatalogEntry, state?: string) {
    history.pushState(null, "", catalogUrl(item, state))
    setSelection(readSelection())
    setWidth(item.viewport.width)
    setHeight(item.viewport.height)
    setPanel("preview")
  }
  const navigation = (
    <CatalogNavigation
      component={selection.component}
      stateId={selection.stateId}
      view={selection.view}
      onNavigate={navigate}
    />
  )
  const preview = (
    <main className="flex h-full min-w-0 flex-col">
      <div className="catalog-viewbar">
        {entry && (
          <>
            <Button
              variant={selection.view === "docs" ? "secondary" : "ghost"}
              onClick={() => navigate(entry)}
            >
              组件概览
            </Button>
            <Button
              variant={selection.view === "canvas" ? "secondary" : "ghost"}
              onClick={() => navigate(entry, selection.stateId)}
            >
              状态画布
            </Button>
          </>
        )}
        <span className="catalog-current">
          {entry?.name}
          {selection.view === "canvas" ? ` / ${state?.name ?? "未知状态"}` : ""}
        </span>
      </div>
      <div className="catalog-tools">
        {selection.view === "canvas" && (
          <>
            <Label htmlFor="viewport-width">宽</Label>
            <Input
              id="viewport-width"
              type="number"
              min={240}
              max={2560}
              value={width}
              className="w-24"
              onChange={(event) =>
                setWidth(
                  Math.max(240, Math.min(2560, Number(event.target.value)))
                )
              }
            />
            <Label htmlFor="viewport-height">高</Label>
            <Input
              id="viewport-height"
              type="number"
              min={240}
              max={1600}
              value={height}
              className="w-24"
              onChange={(event) =>
                setHeight(
                  Math.max(240, Math.min(1600, Number(event.target.value)))
                )
              }
            />
          </>
        )}
        <Button
          variant="outline"
          onClick={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
        >
          {theme === "light" ? "切换深色" : "切换浅色"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setRevision((current) => current + 1)}
        >
          重置状态
        </Button>
        <Button variant="outline" asChild>
          <a href={previewUrl} target="_blank" rel="noreferrer">
            独立打开
          </a>
        </Button>
      </div>
      {selection.view === "docs" && entry ? (
        <CatalogOverview
          key={entry.id}
          entry={entry}
          theme={theme}
          revision={revision}
          onNavigate={navigate}
        />
      ) : (
        <div className="catalog-canvas min-h-0 flex-1 overflow-auto">
          <iframe
            key={`${previewUrl}-${revision}`}
            title="真实组件预览"
            src={previewUrl}
            width={width}
            height={height}
            className="mx-auto block shrink-0 border bg-background"
            style={{ width, height, maxWidth: "none" }}
          />
        </div>
      )}
    </main>
  )
  const docs = entry ? (
    <CatalogDocs
      key={entry.id}
      entry={entry}
      stateId={selection.view === "canvas" ? selection.stateId : undefined}
      onNavigate={navigate}
    />
  ) : (
    <aside className="catalog-scroll" role="alert">
      找不到指定组件，请从组件树选择。
    </aside>
  )
  return (
    <div className="catalog-app flex h-dvh flex-col overflow-hidden">
      <header className="catalog-header">
        <a href="/ui-catalog/" className="catalog-brand">
          <Moon aria-hidden="true" size={24} /> <strong>Moon</strong>
          <span>组件与设计</span>
        </a>
        <div>
          <a href="/">
            打开首页 <ArrowUpRight aria-hidden="true" size={14} />
          </a>
          <a href={designUrl} download="DESIGN.md">
            DESIGN.md <Download aria-hidden="true" size={14} />
          </a>
        </div>
      </header>
      <div className="catalog-mobile-toolbar border-b p-2">
        {(
          [
            ["tree", "组件"],
            ["preview", "预览"],
            ["docs", "文档"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={panel === value ? "secondary" : "ghost"}
            aria-pressed={panel === value}
            onClick={() => setPanel(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {!narrow ? (
        <div className="catalog-desktop min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="20%" minSize="15%">
              {navigation}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="55%" minSize="25%">
              {preview}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="25%" minSize="15%">
              {docs}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="catalog-mobile min-h-0 flex-1">
          <div hidden={panel !== "tree"} className="h-full">
            {navigation}
          </div>
          <div hidden={panel !== "docs"} className="h-full">
            {docs}
          </div>
          <div hidden={panel !== "preview"} className="h-full">
            {preview}
          </div>
        </div>
      )}
    </div>
  )
}
const root = createRoot(document.getElementById("root")!)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
root.render(
  <ThemeProvider storageKey={null} defaultTheme="light">
    <Catalog />
  </ThemeProvider>
)
