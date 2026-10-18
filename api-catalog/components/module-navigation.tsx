import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Search, X, ChevronRight } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { operationUrl } from "../catalog-data"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import type { NavigationItem } from "./types"
export function ModuleNavigation({
  items,
  selected,
  query,
  onQueryChange,
  onSelect,
  onModuleSelect,
  selectedModule,
}: {
  items: NavigationItem[]
  selected?: string
  query: string
  onQueryChange: (value: string) => void
  onSelect: (operation: string) => void
  onModuleSelect?: (module: string) => void
  selectedModule?: string
}) {
  const root = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const filtered = normalized
    ? items.filter((item) =>
        `${item.id} ${item.title} ${item.module} ${item.effect ?? ""}`
          .toLocaleLowerCase()
          .includes(normalized)
      )
    : items
  const modules = [...new Set(filtered.map((item) => item.module))]
  const [previousModule, setPreviousModule] = useState(selectedModule)
  if (previousModule !== selectedModule) {
    setPreviousModule(selectedModule)
    if (selectedModule)
      setExpanded((current) => ({ ...current, [selectedModule]: true }))
  }
  useEffect(() => {
    root.current
      ?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView({ block: "nearest" })
  }, [selected, selectedModule])
  function focusAdjacent(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const links = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        "[data-operation-link]"
      ) ?? []),
    ]
    const index = links.indexOf(event.target as HTMLElement)
    if (index < 0 || !links.length) return
    event.preventDefault()
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) %
            links.length
    links[next]?.focus()
  }
  return (
    <nav
      ref={root}
      className="api-module-navigation"
      aria-label="接口模块"
      onKeyDown={focusAdjacent}
    >
      <div className="api-navigation-search">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            aria-label="搜索接口"
            placeholder="搜索功能、接口或模块"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault()
                onQueryChange("")
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                root.current
                  ?.querySelector<HTMLElement>("[data-operation-link]")
                  ?.focus()
              }
            }}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="清除接口搜索"
                onClick={() => {
                  onQueryChange("")
                  search.current?.focus()
                }}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {normalized && (
          <p className="api-search-count" role="status">
            {filtered.length} 个匹配接口
          </p>
        )}
      </div>
      <div className="api-navigation-list moon-scrollbar">
        {!normalized && (
          <Button
            data-select-item
            data-operation-link
            variant="section"
            className="api-module-heading"
            aria-current={selectedModule === "all" ? "page" : undefined}
            onClick={() => onModuleSelect?.("all")}
          >
            全部模块<span>{items.length}</span>
          </Button>
        )}
        {modules.map((module) => {
          const expansionKey = normalized ? `${normalized}:${module}` : module
          return (
            <Collapsible
              className="api-navigation-group"
              key={module}
              open={
                expanded[expansionKey] ??
                (!!normalized || selectedModule === module)
              }
              onOpenChange={(open) =>
                setExpanded((current) => ({ ...current, [expansionKey]: open }))
              }
            >
              <div className="api-module-row">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${module}的接口`}
                  >
                    <ChevronRight />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  data-select-item
                  data-operation-link={!normalized ? true : undefined}
                  variant="section"
                  className="api-module-heading"
                  aria-current={
                    !selected && selectedModule === module ? "page" : undefined
                  }
                  onClick={() => onModuleSelect?.(module)}
                >
                  {module}
                  <span>
                    {filtered.filter((item) => item.module === module).length}
                  </span>
                </Button>
              </div>
              <CollapsibleContent>
                {filtered
                  .filter((item) => item.module === module)
                  .map((item) => (
                    <a
                      href={operationUrl(item.id)}
                      key={item.id}
                      data-operation-link
                      aria-current={item.id === selected ? "page" : undefined}
                      className="api-operation-link"
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.shiftKey ||
                          event.altKey
                        )
                          return
                        event.preventDefault()
                        onSelect(item.id)
                      }}
                    >
                      <span>{item.title}</span>
                      <code>{item.id}</code>
                    </a>
                  ))}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
        {!filtered.length && (
          <div className="api-navigation-empty" role="status">
            <p>没有匹配的接口</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onQueryChange("")
                search.current?.focus()
              }}
            >
              清除搜索
            </Button>
          </div>
        )}
      </div>
      <p className="api-navigation-hint">↑ ↓ 定位 · Enter 打开</p>
    </nav>
  )
}
