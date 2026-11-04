import { useEffect, useRef, useState } from "react"
import { Search, X, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { entries, type CatalogMetadata } from "./catalog"
import { storySections } from "./catalog-sections"

export function catalogMatches(entry: CatalogMetadata, query: string) {
  const needle = query.trim().toLocaleLowerCase()
  const matches = (text: string) => text.toLocaleLowerCase().includes(needle)
  return {
    entry: matches(
      `${entry.name} ${entry.group} ${entry.source} ${entry.description} ${entry.boundary} ${entry.story?.goal ?? ""} ${entry.standards.map((rule) => `${rule.name} ${rule.rule}`).join(" ")}`
    ),
    states: entry.states.filter((state) =>
      matches(
        `${state.name} ${state.condition} ${state.expected} ${state.steps.join(" ")}`
      )
    ),
  }
}
/** Directories are the screens you work on; pages sit directly inside their screen. */
const groupOrder = [
  "会话",
  "首页",
  "设置与启动",
  "插件",
  "文件工作栏",
  "操作与选择",
  "输入与表单",
  "浮层与导航",
  "内容与反馈",
  "数据展示",
]
export function CatalogNavigation({
  component,
  stateId,
  query,
  onQueryChange,
  onClearFilters,
  onNavigate,
  hrefFor,
}: {
  component: string
  stateId?: string
  query: string
  onQueryChange: (value: string) => void
  onClearFilters: () => void
  onNavigate: (entry: CatalogMetadata, state?: string) => void
  hrefFor: (entry: CatalogMetadata, state?: string) => string
}) {
  const root = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    [component]: true,
  })
  const expansionKey = (id: string) =>
    query.trim() ? `search:${query.trim()}:${id}` : id
  const matches = entries
    .filter(
      (entry) =>
        catalogMatches(entry, query).entry ||
        catalogMatches(entry, query).states.length
    )
    .sort((a, b) => a.order - b.order)
  const groups = [...new Set(matches.map((entry) => entry.group))].sort(
    (a, b) => {
      const left = groupOrder.indexOf(a)
      const right = groupOrder.indexOf(b)
      return (
        (left === -1 ? groupOrder.length : left) -
          (right === -1 ? groupOrder.length : right) || a.localeCompare(b)
      )
    }
  )
  const [previousComponent, setPreviousComponent] = useState(component)
  if (previousComponent !== component) {
    setPreviousComponent(component)
    setExpanded((current) => ({ ...current, [component]: true }))
  }
  useEffect(() => {
    root.current
      ?.querySelector("[aria-current='page']")
      ?.scrollIntoView({ block: "nearest" })
  }, [component, stateId])
  const navigate = (
    event: React.MouseEvent<HTMLAnchorElement>,
    entry: CatalogMetadata,
    state?: string
  ) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    event.preventDefault()
    setExpanded((current) => ({ ...current, [expansionKey(entry.id)]: true }))
    onNavigate(entry, state)
  }
  const entryNode = (entry: CatalogMetadata) => {
    const found = catalogMatches(entry, query)
    const states = query.trim() && !found.entry ? found.states : entry.states
    const hasStates = entry.stage !== "structure" && states.length > 0
    return (
      <Collapsible
        key={entry.id}
        open={expanded[expansionKey(entry.id)] ?? !!query.trim()}
        onOpenChange={(open) =>
          setExpanded((current) => ({
            ...current,
            [expansionKey(entry.id)]: open,
          }))
        }
      >
        <div
          className="catalog-component-row"
          data-selected={component === entry.id}
        >
          {hasStates ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${entry.name}的场景`}
              >
                <ChevronRight />
              </Button>
            </CollapsibleTrigger>
          ) : (
            <span className="catalog-tree-spacer" />
          )}
          <a
            href={hrefFor(entry)}
            className="catalog-component-link"
            title={entry.name}
            aria-current={
              component === entry.id && !hasStates ? "page" : undefined
            }
            onClick={(event) => navigate(event, entry)}
          >
            {entry.name}
          </a>
        </div>
        {hasStates && (
          <CollapsibleContent className="catalog-scenarios">
            {storySections.map((section) => {
              const rows = states.filter(
                (state) => state.section === section.id
              )
              return (
                rows.length > 0 && (
                  <div key={section.id}>
                    <p className="catalog-scenario-category">{section.name}</p>
                    {rows.map((state) => (
                      <a
                        key={state.id}
                        className={cn("catalog-link", "catalog-scene-link")}
                        href={hrefFor(entry, state.id)}
                        aria-current={
                          component === entry.id && stateId === state.id
                            ? "page"
                            : undefined
                        }
                        title={state.name}
                        onClick={(event) => navigate(event, entry, state.id)}
                      >
                        <span
                          className="catalog-state-dot"
                          aria-hidden="true"
                        />
                        {state.name}
                      </a>
                    ))}
                  </div>
                )
              )
            })}
          </CollapsibleContent>
        )}
      </Collapsible>
    )
  }
  return (
    <nav ref={root} className="catalog-navigation" aria-label="组件目录">
      <div className="catalog-search">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索组件或场景"
            placeholder="搜索组件或场景"
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
      <div className="catalog-tree-scroll moon-scrollbar">
        {!matches.some((entry) => entry.id === component) &&
          entries.find((entry) => entry.id === component) && (
            <section>
              <p className="catalog-group-label">当前组件</p>
              {entryNode(entries.find((entry) => entry.id === component)!)}
            </section>
          )}
        <a
          className="catalog-link"
          href="/ui-catalog/"
          aria-current={!component ? "page" : undefined}
        >
          页面与组件总览
        </a>
        {groups.map((group) => (
          <section key={group}>
            <h3 className="catalog-group-label">{group}</h3>
            {matches
              .filter((entry) => entry.group === group)
              .map(entryNode)}
          </section>
        ))}
        {!matches.length && (
          <div className="catalog-no-results" role="status">
            <p>没有匹配的组件或场景</p>
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              清除搜索
            </Button>
          </div>
        )}
      </div>
      <p className="catalog-navigation-footnote">{matches.length} 个组件</p>
    </nav>
  )
}
