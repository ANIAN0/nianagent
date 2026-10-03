import { useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { CatalogLayout } from "../catalog-layout"
import { CatalogToolbar } from "../catalog-toolbar"
import { CatalogNavigation } from "../catalog-navigation"
import { CatalogDocs } from "../catalog-docs"
import { CatalogViewportControls } from "../catalog-viewport-controls"
import { CatalogSource } from "../catalog-source"
import { CatalogOverview } from "../catalog-overview"
import {
  catalogUrl,
  entries,
  type CatalogMetadata,
  type readSelection,
} from "../catalog"
import type { useCatalogController } from "../use-catalog-controller"
import "../catalog.css"

const sampleEntry: CatalogMetadata = entries.find(
  (entry) => entry.id === "button"
)!

/** Catalog UI demonstrations use in-memory controls and never mutate browser history. */
function useDemoController(
  canvas = true,
  initialQuery = ""
): ReturnType<typeof useCatalogController> {
  const { theme, setTheme } = useTheme()
  const [selection, setSelection] = useState<ReturnType<typeof readSelection>>({
    entry: sampleEntry,
    state: sampleEntry.states[0],
    component: sampleEntry.id,
    stateId: sampleEntry.states[0]!.id,
    view: canvas ? "canvas" : "docs",
  })
  const [width, setWidth] = useState(640)
  const [height, setHeight] = useState(240)
  const [revision, setRevision] = useState(0)
  const [panel, setPanel] = useState("preview")
  const [query, setQuery] = useState(initialQuery)
  const resolvedTheme = theme === "dark" ? "dark" : "light"
  return {
    selection,
    width,
    height,
    revision,
    panel,
    setPanel,
    query,
    setQuery,
    narrow: false,
    theme: resolvedTheme,
    previewUrl: `./preview.html?component=${selection.component}&state=${selection.stateId}&theme=${resolvedTheme}`,
    hrefFor: catalogUrl,
    inspectState: (stateId) =>
      setSelection((current) => ({
        ...current,
        stateId,
        state: current.entry?.states.find((state) => state.id === stateId),
        view: "docs",
      })),
    navigate: (entry, stateId) =>
      setSelection({
        entry,
        state: entry.states.find(
          (state) => state.id === (stateId ?? entry.states[0]!.id)
        ),
        component: entry.id,
        stateId: stateId ?? entry.states[0]!.id,
        view: stateId ? "canvas" : "docs",
      }),
    setViewport: (nextWidth, nextHeight) => {
      setWidth(nextWidth)
      setHeight(nextHeight)
    },
    toggleTheme: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    shareUrl: () =>
      new URL(
        `/ui-catalog/?component=${selection.component}&state=${selection.stateId}&theme=${resolvedTheme}&width=${width}&height=${height}`,
        location.origin
      ).href,
    reset: () => setRevision((value) => value + 1),
  }
}

export function CatalogToolbarExample({
  overview = false,
}: {
  overview?: boolean
}) {
  const controller = useDemoController(!overview)
  return (
    <div className="catalog-preview-panel">
      <CatalogToolbar controller={controller} />
      <div className="p-6">
        <Button key={controller.revision}>正式 Button 示例</Button>
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          当前尺寸 {controller.width} × {controller.height} · 重置{" "}
          {controller.revision} 次
        </p>
      </div>
    </div>
  )
}

export function CatalogLayoutExample({ narrow = false }: { narrow?: boolean }) {
  const controller = useDemoController()
  const navigate = controller.navigate
  return (
    <CatalogLayout
      narrow={narrow}
      panel={controller.panel}
      onPanelChange={controller.setPanel}
      navigation={
        <CatalogNavigation
          component={controller.selection.component}
          stateId={controller.selection.stateId}
          view={controller.selection.view}
          query={controller.query}
          onQueryChange={controller.setQuery}
          onNavigate={navigate}
          hrefFor={catalogUrl}
        />
      }
      preview={
        <main className="catalog-preview-panel">
          <CatalogToolbar controller={controller} />
          <div className="p-6">
            <Button key={controller.revision}>正式组件预览</Button>
            <p className="mt-4 text-sm text-muted-foreground">
              演示布局注入正式组件，避免目录预览自身造成递归。
            </p>
          </div>
        </main>
      }
      docs={
        <CatalogDocs
          key={controller.selection.component}
          entry={controller.selection.entry!}
          stateId={
            controller.selection.view === "canvas"
              ? controller.selection.stateId
              : undefined
          }
          onNavigate={navigate}
          hrefFor={catalogUrl}
        />
      }
    />
  )
}

export function CatalogViewportExample() {
  const [size, setSize] = useState({ width: 640, height: 480 })
  return (
    <div className="p-6">
      <CatalogViewportControls
        {...size}
        defaultViewport={{ width: 640, height: 480 }}
        onChange={(width, height) => setSize({ width, height })}
      />
      <p className="mt-4 text-sm text-muted-foreground" role="status">
        已应用 {size.width} × {size.height}{" "}
        px。输入无效时保留草稿，实际尺寸不变。
      </p>
    </div>
  )
}

export function CatalogNavigationExample({
  empty = false,
}: {
  empty?: boolean
}) {
  const controller = useDemoController(
    true,
    empty ? "无此组件 catalog 999" : ""
  )
  return (
    <CatalogNavigation
      component={controller.selection.component}
      stateId={controller.selection.stateId}
      view={controller.selection.view}
      query={controller.query}
      onQueryChange={controller.setQuery}
      onNavigate={controller.navigate}
      hrefFor={catalogUrl}
    />
  )
}

export function CatalogDocsExample() {
  const controller = useDemoController()
  return (
    <CatalogDocs
      key={controller.selection.component}
      entry={controller.selection.entry!}
      stateId={controller.selection.stateId}
      onNavigate={controller.navigate}
      hrefFor={catalogUrl}
    />
  )
}

export function CatalogOverviewExample() {
  const controller = useDemoController(false)
  return (
    <CatalogOverview
      entry={sampleEntry}
      theme={controller.theme}
      revision={controller.revision}
      stateId={controller.selection.stateId}
      onInspectState={controller.inspectState}
      onNavigate={controller.navigate}
      hrefFor={catalogUrl}
    />
  )
}

export function CatalogSourceExample({
  failure = false,
  slow = false,
}: {
  failure?: boolean
  slow?: boolean
}) {
  const [readSource] = useState(() => {
    let calls = 0
    return async (_entry: CatalogMetadata, signal?: AbortSignal) => {
      calls += 1
      if (slow)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 2500)
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer)
              reject(new DOMException("已取消", "AbortError"))
            },
            { once: true }
          )
        })
      if (failure && calls === 1)
        throw new Error("当前源码暂时不可读取，请重试。")
      return "// 展示读取边界的示例内容；正式文档按需读取对应源码。\nexport function Example() {\n  return <Button>开始</Button>\n}"
    }
  })
  return (
    <div className="catalog-docs p-6">
      <CatalogSource entry={sampleEntry} readSource={readSource} defaultOpen />
    </div>
  )
}
