import { useEffect, useRef, useState } from "react"
import {
  FileText,
  Diamond,
  ChevronRight,
  Search,
  SearchX,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
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
import { entries, symbolOf, type CatalogMetadata } from "./catalog"

export function CatalogNavigation({
  component,
  stateId,
  view,
  query,
  onQueryChange,
  onNavigate,
  hrefFor,
}: {
  component: string
  stateId: string
  view: string
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (entry: CatalogMetadata, state?: string) => void
  hrefFor: (entry: CatalogMetadata, state?: string) => string
}) {
  const [expanded, setExpanded] = useState<
    Record<string, { open: boolean; selection: string }>
  >({})
  const active = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" })
  }, [component, stateId, view])
  const matches = entries.filter((entry) =>
    `${entry.name} ${symbolOf(entry)} ${entry.group} ${entry.states.map((s) => s.name).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  function link(entry: CatalogMetadata, name: string, state?: string) {
    const selected =
      component === entry.id &&
      (state ? view === "canvas" && stateId === state : view === "docs")
    return (
      <a
        key={state ?? "docs"}
        ref={selected ? active : undefined}
        className="catalog-link"
        aria-current={selected ? "page" : undefined}
        href={hrefFor(entry, state)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return
          event.preventDefault()
          onNavigate(entry, state)
        }}
      >
        {state ? (
          <Diamond aria-hidden="true" size={12} />
        ) : (
          <FileText aria-hidden="true" size={13} />
        )}
        <span>{name}</span>
      </a>
    )
  }
  return (
    <nav className="catalog-navigation" aria-label="组件树">
      <div className="catalog-search">
        <div className="catalog-search-heading">
          <strong>组件</strong>
          <span>{entries.length} 项</span>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索组件"
            placeholder="名称、组件或状态"
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
        {!!query.trim() && (
          <p className="catalog-search-count" role="status">
            找到 {matches.length} 个组件
          </p>
        )}
      </div>
      <div className="catalog-tree-scroll">
        {(["页面", "复合组件", "基础组件"] as const).map((layer) => {
          const items = matches.filter((entry) => entry.layer === layer)
          if (!items.length) return null
          return (
            <section key={layer}>
              <h2 className="catalog-layer">
                {layer}
                <span>{items.length}</span>
              </h2>
              {[...new Set(items.map((entry) => entry.group))].map((group) => (
                <div key={group}>
                  <h3 className="catalog-group">{group}</h3>
                  {items
                    .filter((entry) => entry.group === group)
                    .map((entry) => (
                      <details
                        key={`${entry.id}-${component}-${!!query}`}
                        open={
                          !!query.trim() ||
                          (expanded[entry.id]?.selection === component
                            ? expanded[entry.id]!.open
                            : component === entry.id ||
                              expanded[entry.id]?.open)
                        }
                        onToggle={(event) => {
                          const open = event.currentTarget.open
                          if (query.trim()) return
                          setExpanded((old) =>
                            old[entry.id]?.open === open &&
                            old[entry.id]?.selection === component
                              ? old
                              : {
                                  ...old,
                                  [entry.id]: { open, selection: component },
                                }
                          )
                        }}
                      >
                        <summary title={symbolOf(entry)}>
                          <ChevronRight aria-hidden="true" size={14} />
                          <span>{entry.name}</span>
                          <small>{entry.states.length}</small>
                        </summary>
                        <div className="catalog-story-links">
                          {link(entry, "组件概览")}
                          {entry.states.map((state) =>
                            link(entry, state.name, state.id)
                          )}
                        </div>
                      </details>
                    ))}
                </div>
              ))}
            </section>
          )
        })}
        {!matches.length && (
          <Empty role="status">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>没有匹配的组件</EmptyTitle>
              <EmptyDescription>换一个组件名称或状态关键词。</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onQueryChange("")}
              >
                清除搜索
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </div>
    </nav>
  )
}
