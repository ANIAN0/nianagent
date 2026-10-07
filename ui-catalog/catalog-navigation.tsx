import { Search, X, SearchX, ChevronRight } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { entries, type CatalogMetadata } from "./catalog"
import { storySections, type StorySection } from "./catalog-sections"

export function CatalogNavigation({
  component,
  stateId,
  section,
  query,
  pageFilter,
  onQueryChange,
  onPageFilterChange,
  onNavigate,
  hrefFor,
}: {
  component: string
  stateId?: string
  section?: StorySection
  query: string
  pageFilter: string
  onQueryChange: (query: string) => void
  onPageFilterChange: (page: string) => void
  onNavigate: (entry: CatalogMetadata, state?: string) => void
  hrefFor: (entry: CatalogMetadata, state?: string) => string
}) {
  const selectionKey = `${component}:${section ?? ""}:${stateId ?? ""}`
  const currentPath = () =>
    entries.some(
      (entry) => entry.id === component && entry.layer === "复合组件"
    )
      ? [component, `${component}:${section ?? "normal"}`]
      : []
  const [expansion, setExpansion] = useState(() => ({
    selectionKey,
    groups: new Set(currentPath()),
  }))
  // Selection opens its path once. Presentation changes preserve manual collapse.
  if (expansion.selectionKey !== selectionKey)
    setExpansion({
      selectionKey,
      groups: new Set([...expansion.groups, ...currentPath()]),
    })
  const toggleGroup = (group: string) => {
    setExpansion((previous) => {
      const groups = new Set(previous.groups)
      if (groups.has(group)) groups.delete(group)
      else groups.add(group)
      return { ...previous, groups }
    })
  }
  const pages = [...new Set(entries.flatMap((entry) => entry.pages))]
  const matches = entries
    .filter(
      (entry) =>
        (!pageFilter || entry.pages.includes(pageFilter)) &&
        `${entry.name} ${entry.group} ${entry.layer}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
    )
    .sort((left, right) => left.order - right.order)
  const basic = matches.filter((entry) => entry.layer === "基础组件")
  const stories = matches.filter((entry) => entry.layer === "复合组件")
  const pageEntries = matches.filter((entry) => entry.layer === "页面")
  const link = (entry: CatalogMetadata) => (
    <a
      key={entry.id}
      className="catalog-link"
      aria-current={component === entry.id ? "page" : undefined}
      href={hrefFor(entry)}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
          return
        event.preventDefault()
        onNavigate(entry)
      }}
    >
      {entry.name}
    </a>
  )
  return (
    <nav className="catalog-navigation" aria-label="组件目录">
      <div className="catalog-search">
        <div className="catalog-page-filter" aria-label="关联页面筛选">
          <span className="catalog-filter-label">关联页面</span>
          <div className="catalog-filter-options">
            {["", ...pages].map((page) => (
              <Button
                key={page}
                size="xs"
                variant={pageFilter === page ? "secondary" : "ghost"}
                aria-pressed={pageFilter === page}
                aria-label={page ? `筛选${page}组件` : "显示全部页面组件"}
                onClick={() => onPageFilterChange(page)}
              >
                {page || "全部"}
              </Button>
            ))}
          </div>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索组件或用户故事"
            placeholder="搜索组件或用户故事"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="清除组件搜索"
                onClick={() => onQueryChange("")}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      <div className="catalog-tree-scroll">
        {basic.length > 0 && (
          <section aria-label="基础组件">
            <h2 className="catalog-layer">基础组件</h2>
            {[...new Set(basic.map((entry) => entry.group))].map((group) => (
              <details
                className="catalog-flow-group"
                key={group}
                open={basic.some(
                  (entry) => entry.id === component && entry.group === group
                )}
              >
                <summary className="catalog-group">
                  <ChevronRight aria-hidden="true" />
                  {group}
                </summary>
                {basic.filter((entry) => entry.group === group).map(link)}
              </details>
            ))}
          </section>
        )}
        {stories.length > 0 && (
          <section aria-label="复合组件用户故事">
            <h2 className="catalog-layer">复合组件</h2>
            {stories.map((entry) => (
              <details
                className="catalog-story-group"
                key={entry.id}
                open={expansion.groups.has(entry.id)}
              >
                <summary
                  className="catalog-group"
                  onClick={(event) => {
                    event.preventDefault()
                    event.currentTarget.focus()
                    toggleGroup(entry.id)
                  }}
                >
                  <ChevronRight aria-hidden="true" />
                  {entry.group}
                </summary>
                {storySections.map((item) => (
                  <details
                    className="catalog-section-group"
                    key={item.id}
                    open={expansion.groups.has(`${entry.id}:${item.id}`)}
                  >
                    <summary
                      key={item.id}
                      className="catalog-group"
                      onClick={(event) => {
                        event.preventDefault()
                        event.currentTarget.focus()
                        toggleGroup(`${entry.id}:${item.id}`)
                      }}
                    >
                      <ChevronRight aria-hidden="true" />
                      {item.name}
                    </summary>
                    {entry.states
                      .filter((state) => state.section === item.id)
                      .map((state) => (
                        <a
                          key={state.id}
                          className="catalog-link catalog-state-link"
                          aria-current={
                            entry.id === component && stateId === state.id
                              ? "step"
                              : undefined
                          }
                          href={hrefFor(entry, state.id)}
                          onClick={(event) => {
                            if (
                              event.ctrlKey ||
                              event.metaKey ||
                              event.shiftKey ||
                              event.altKey
                            )
                              return
                            event.preventDefault()
                            onNavigate(entry, state.id)
                          }}
                        >
                          {state.name}
                        </a>
                      ))}
                  </details>
                ))}
              </details>
            ))}
          </section>
        )}
        {pageEntries.length > 0 && (
          <section aria-label="页面组件">
            <h2 className="catalog-layer">页面</h2>
            {pageEntries.map(link)}
          </section>
        )}
        {!matches.length && (
          <Empty role="status">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>没有匹配项</EmptyTitle>
              <EmptyDescription>可按组件名或用户故事搜索。</EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onQueryChange("")}
            >
              清除搜索
            </Button>
          </Empty>
        )}
      </div>
      <p className="catalog-navigation-footnote">
        {basic.length} 基础组件 · {stories.length} 用户故事 ·{" "}
        {pageEntries.length} 页面
      </p>
    </nav>
  )
}
