import { useEffect, useRef, useState } from "react"
import { FileText, Diamond, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { entries, catalogUrl, symbolOf, type CatalogEntry } from "./catalog"

export function CatalogNavigation({
  component,
  stateId,
  view,
  onNavigate,
}: {
  component: string
  stateId: string
  view: string
  onNavigate: (entry: CatalogEntry, state?: string) => void
}) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const active = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" })
  }, [component, stateId, view])
  const matches = entries.filter((entry) =>
    `${entry.name} ${symbolOf(entry)} ${entry.group} ${entry.states.map((s) => s.name).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase())
  )
  function link(entry: CatalogEntry, name: string, state?: string) {
    const selected =
      component === entry.id &&
      (state ? view === "canvas" && stateId === state : view === "docs")
    return (
      <a
        key={state ?? "docs"}
        ref={selected ? active : undefined}
        className="catalog-link"
        aria-current={selected ? "page" : undefined}
        href={catalogUrl(entry, state)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return
          event.preventDefault()
          onNavigate(entry, state)
        }}
      >
        {state ? <Diamond size={12} /> : <FileText size={13} />}
        {name}
      </a>
    )
  }
  return (
    <nav className="catalog-navigation" aria-label="组件树">
      <div className="catalog-search">
        <Input
          aria-label="搜索组件"
          placeholder="搜索名称、组件或状态…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="catalog-tree-scroll">
        {(["页面", "复合组件", "基础组件"] as const).map((layer) => {
          const items = matches.filter((entry) => entry.layer === layer)
          if (!items.length) return null
          return (
            <section key={layer}>
              <h2 className="catalog-layer">{layer}</h2>
              {[...new Set(items.map((entry) => entry.group))].map((group) => (
                <div key={group}>
                  <h3 className="catalog-group">{group}</h3>
                  {items
                    .filter((entry) => entry.group === group)
                    .map((entry) => (
                      <details
                        key={`${entry.id}-${component}-${!!query}`}
                        open={
                          !!query ||
                          component === entry.id ||
                          expanded[entry.id]
                        }
                        onToggle={(event) => {
                          const open = event.currentTarget.open
                          setExpanded((old) =>
                            old[entry.id] === open
                              ? old
                              : { ...old, [entry.id]: open }
                          )
                        }}
                      >
                        <summary title={symbolOf(entry)}>
                          <ChevronRight aria-hidden="true" size={14} />
                          {entry.name}
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
        {!matches.length && <p role="status">没有匹配的组件或状态</p>}
      </div>
    </nav>
  )
}
