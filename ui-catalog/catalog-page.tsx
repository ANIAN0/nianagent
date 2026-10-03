import { PanelsTopLeft, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { CatalogNavigation } from "./catalog-navigation"
import { CatalogDocs } from "./catalog-docs"
import { CatalogOverview } from "./catalog-overview"
import { CatalogPreviewFrame } from "./catalog-preview-frame"
import { CatalogToolbar } from "./catalog-toolbar"
import { CatalogLayout } from "./catalog-layout"
import { useCatalogController } from "./use-catalog-controller"

export function CatalogPage() {
  const controller = useCatalogController()
  const { selection, narrow, panel, setPanel, theme, width, height } =
    controller
  const { entry, state } = selection
  const navigation = (
    <CatalogNavigation
      component={selection.component}
      stateId={selection.stateId}
      view={selection.view}
      query={controller.query}
      onQueryChange={controller.setQuery}
      onNavigate={controller.navigate}
      hrefFor={controller.hrefFor}
    />
  )
  const missing = (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{entry ? "没有这个状态" : "没有这个组件"}</EmptyTitle>
        <EmptyDescription>
          请从组件树选择可用项，或检查链接中的标识。
        </EmptyDescription>
      </EmptyHeader>
      {entry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => controller.navigate(entry)}
        >
          查看组件概览
        </Button>
      ) : narrow ? (
        <Button variant="outline" size="sm" onClick={() => setPanel("tree")}>
          打开组件树
        </Button>
      ) : null}
    </Empty>
  )
  const preview = (
    <main className="catalog-preview-panel" aria-label="组件预览">
      <CatalogToolbar
        key={`${selection.component}-${selection.stateId}-${selection.view}`}
        controller={controller}
      />
      {!entry || (selection.view === "canvas" && !state) ? (
        missing
      ) : selection.view === "docs" ? (
        <CatalogOverview
          key={entry.id}
          entry={entry}
          theme={theme}
          revision={controller.revision}
          stateId={selection.stateId}
          onInspectState={controller.inspectState}
          onNavigate={controller.navigate}
          hrefFor={controller.hrefFor}
        />
      ) : (
        <div className="catalog-canvas">
          <div className="catalog-canvas-label">
            <PanelsTopLeft aria-hidden="true" /> {state!.name}
            <span>
              {width} × {height}
            </span>
          </div>
          <CatalogPreviewFrame
            key={`${controller.previewUrl}-${controller.revision}`}
            mode="canvas"
            src={controller.previewUrl}
            title={`${entry.name} · ${state!.name}`}
            initialHeight={height}
            width={width}
            height={height}
          />
        </div>
      )}
    </main>
  )
  const docs = entry ? (
    <CatalogDocs
      key={entry.id}
      entry={entry}
      stateId={selection.stateId}
      onNavigate={controller.navigate}
      hrefFor={controller.hrefFor}
    />
  ) : (
    <aside className="catalog-scroll" aria-label="组件文档">
      {missing}
    </aside>
  )
  return (
    <CatalogLayout
      narrow={narrow}
      panel={panel}
      onPanelChange={setPanel}
      navigation={navigation}
      preview={preview}
      docs={docs}
    />
  )
}
