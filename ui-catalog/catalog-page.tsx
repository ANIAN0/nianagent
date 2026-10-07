import { SearchX } from "lucide-react"
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
import { CatalogStandard } from "./catalog-standard"
import { CatalogComponentShell } from "./catalog-component-shell"
import { CatalogPreviewFrame } from "./catalog-preview-frame"
import { CatalogToolbar } from "./catalog-toolbar"
import { CatalogLayout } from "./catalog-layout"
import { useCatalogController } from "./use-catalog-controller"
import { storySectionName } from "./catalog-sections"

export function CatalogPage() {
  const controller = useCatalogController()
  const { selection, narrow, panel, setPanel, theme, width, height } =
    controller
  const { entry, state } = selection
  const missing = (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>此项不在当前目录</EmptyTitle>
        <EmptyDescription>当前只创建首页输入框相关组件。</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" asChild>
        <a href="/ui-catalog/">返回目录</a>
      </Button>
    </Empty>
  )
  return (
    <CatalogLayout
      narrow={narrow}
      panel={panel}
      onPanelChange={setPanel}
      navigation={
        <CatalogNavigation
          component={selection.component}
          stateId={selection.selectedStateId}
          section={selection.section}
          query={controller.query}
          pageFilter={controller.pageFilter}
          onPageFilterChange={controller.setPageFilter}
          onQueryChange={controller.setQuery}
          onNavigate={controller.navigate}
          hrefFor={controller.hrefFor}
        />
      }
      preview={
        <main className="catalog-preview-panel" aria-label="组件展示">
          {entry && (
            <header className="catalog-entry-heading">
              <p className="catalog-eyebrow">
                {entry.layer} /{" "}
                {selection.section
                  ? storySectionName(selection.section)
                  : entry.group}
              </p>
              <div className="catalog-heading-row">
                <h1>{entry.name}</h1>
                {entry.pages.map((page) => (
                  <Button
                    key={page}
                    size="xs"
                    variant="outline"
                    aria-label={`按${page}筛选组件`}
                    onClick={() => controller.setPageFilter(page)}
                  >
                    {page}
                  </Button>
                ))}
              </div>
              {entry.description && <p>{entry.description}</p>}
            </header>
          )}
          {!entry ? (
            missing
          ) : entry.stage === "structure" ? (
            <CatalogComponentShell section={selection.section} />
          ) : (
            <>
              <CatalogToolbar
                key={selection.component}
                controller={controller}
              />
              {selection.view === "canvas" && !state ? (
                missing
              ) : selection.view === "docs" ? (
                <CatalogStandard
                  entry={entry}
                  section={selection.section}
                  onNavigate={controller.navigate}
                  hrefFor={controller.hrefFor}
                />
              ) : (
                <div className="catalog-canvas">
                  <div className="catalog-canvas-label">
                    <strong>{state!.name}</strong>
                    <span>
                      {width} × {height} · {theme === "dark" ? "深色" : "浅色"}
                    </span>
                  </div>
                  <CatalogPreviewFrame
                    key={controller.previewUrl + controller.revision}
                    mode="canvas"
                    src={controller.previewUrl}
                    title={entry.name + " · " + state!.name}
                    initialHeight={height}
                    width={width}
                    height={height}
                  />
                </div>
              )}
            </>
          )}
        </main>
      }
      docs={
        entry ? (
          <CatalogDocs
            key={entry.id}
            entry={entry}
            stateId={selection.selectedStateId}
            section={selection.section}
            onNavigate={controller.navigate}
            hrefFor={controller.hrefFor}
          />
        ) : (
          <aside className="catalog-scroll">{missing}</aside>
        )
      }
    />
  )
}
