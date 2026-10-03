import { useEffect, useRef, type KeyboardEvent } from "react"
import { Search, X, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import type { ModelOperation, NavigationItem } from "./types"

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
  selected?: ModelOperation
  query: string
  onQueryChange: (value: string) => void
  onSelect: (operation: ModelOperation) => void
  onModuleSelect?: (module: string) => void
  selectedModule?: string
}) {
  const root = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = normalized
    ? items.filter((item) =>
        `${item.id} ${item.title} ${item.module}`
          .toLocaleLowerCase()
          .includes(normalized)
      )
    : items
  const modules = [...new Set(filtered.map((item) => item.module))]

  useEffect(() => {
    if (!normalized)
      root.current
        ?.querySelector<HTMLElement>("[aria-current='page']")
        ?.scrollIntoView({ block: "nearest" })
  }, [selected, normalized])

  function focusAdjacent(event: KeyboardEvent<HTMLElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const links = [
      ...(root.current?.querySelectorAll<HTMLAnchorElement>(
        "[data-operation-link]"
      ) ?? []),
    ]
    const index = links.indexOf(event.target as HTMLAnchorElement)
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
        <div className="api-navigation-label">
          <span>功能接口</span>
          <span>{items.length}</span>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            aria-label="搜索接口"
            placeholder="搜索名称、标识或模块"
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
                  ?.querySelector<HTMLAnchorElement>("[data-operation-link]")
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
            找到 {filtered.length} 个接口
          </p>
        )}
      </div>
      <div className="api-navigation-list moon-scrollbar">
        {filtered.length ? (
          modules.map((module) => (
            <section className="api-navigation-group" key={module}>
              <h2>
                {onModuleSelect ? (
                  <Button
                    variant="section"
                    className="api-module-heading"
                    aria-current={
                      selectedModule === module ? "page" : undefined
                    }
                    onClick={() => onModuleSelect(module)}
                  >
                    {module}
                    <span>
                      {filtered.filter((item) => item.module === module).length}
                    </span>
                  </Button>
                ) : (
                  module
                )}
              </h2>
              {filtered
                .filter((item) => item.module === module)
                .map((item) => (
                  <a
                    href={`?operation=${encodeURIComponent(item.id)}`}
                    key={item.id}
                    data-operation-link
                    aria-current={item.id === selected ? "page" : undefined}
                    className={cn(
                      "api-operation-link",
                      item.id === selected && "api-operation-link-active"
                    )}
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
            </section>
          ))
        ) : (
          <Empty className="api-navigation-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>没有匹配的接口</EmptyTitle>
              <EmptyDescription>
                尝试接口名称、调用标识或模块名称。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
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
            </EmptyContent>
          </Empty>
        )}
      </div>
      <p className="api-navigation-hint">↑ ↓ 定位接口 · Enter 打开</p>
    </nav>
  )
}
