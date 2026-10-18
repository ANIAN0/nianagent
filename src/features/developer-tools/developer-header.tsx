import { useEffect, useRef, useState, type ReactNode } from "react"
import { Moon, Sun, Search, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useTheme } from "@/components/theme-provider"
import { pluginSpecSections } from "../plugin-development/spec-content"
import "./reading.css"

export type DeveloperSearchItem = {
  id: string
  title: string
  section: string
  hierarchy: string
  text: string
  href: string
}
const developerSections = [
  { title: "项目结构", href: "/project/" },
  { title: "页面与组件", href: "/ui-catalog/" },
  { title: "接口查询", href: "/api-catalog/" },
  { title: "插件开发", href: "/devtools/plugin-development.html" },
] as const
const pluginItems = pluginSpecSections.map((section) => ({
  id: section.id,
  title: section.title,
  section: "插件开发",
  hierarchy: "插件开发规范",
  text: section.body,
  href: `/devtools/plugin-development.html?section=${encodeURIComponent(section.id)}`,
}))
export function DeveloperHeader({
  title,
  loadSearch,
  actions,
  onPluginSection,
}: {
  title: string
  loadSearch?: (
    publish?: (items: DeveloperSearchItem[]) => void
  ) => Promise<DeveloperSearchItem[]>
  actions?: ReactNode
  onPluginSection?: (id: string) => void
}) {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<DeveloperSearchItem[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const results = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setLoading(!!loadSearch)
        setOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [loadSearch])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (loadSearch) {
      void Promise.resolve()
        .then(() =>
          loadSearch((value) => {
            if (!cancelled) {
              setItems(value)
              setError("")
            }
          })
        )
        .then(
          (value) => {
            if (!cancelled) {
              setItems(value)
              setError("")
            }
          },
          (cause: unknown) => {
            if (!cancelled)
              setError(
                cause instanceof Error ? cause.message : "搜索内容加载失败"
              )
          }
        )
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    return () => {
      cancelled = true
    }
  }, [open, loadSearch])
  const needle = query.trim().toLowerCase()
  const found = (loadSearch ? items : pluginItems)
    .filter((item) =>
      `${item.title} ${item.hierarchy} ${item.text}`
        .toLowerCase()
        .includes(needle)
    )
    .slice(0, 60)
  const nav =
    import.meta.env.DEV && loadSearch
      ? developerSections
      : developerSections.slice(-1)
  return (
    <header className="reader-header">
      <a className="reader-brand" href={nav[0].href}>
        <span className="reader-moon" aria-hidden="true">
          ◕
        </span>
        <strong>Moon</strong>
        <span>开发工具</span>
      </a>
      <nav aria-label="开发工具栏目" className="reader-sections">
        {nav.map((section) => (
          <a
            key={section.href}
            href={section.href}
            aria-current={title === section.title ? "page" : undefined}
          >
            {section.title}
          </a>
        ))}
      </nav>
      <div className="reader-header-actions">
        <Button
          ref={trigger}
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(!!loadSearch)
            setOpen(true)
          }}
        >
          <Search data-icon="inline-start" />
          <span>搜索</span>
          <kbd>Ctrl K</kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
          onClick={() => {
            const next = theme === "dark" ? "light" : "dark"
            setTheme(next)
            const params = new URLSearchParams(location.search)
            params.set("theme", next)
            history.replaceState(
              history.state,
              "",
              `${location.pathname}?${params}${location.hash}`
            )
            window.dispatchEvent(new Event("moon-devtools-location"))
          }}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        {actions ?? (
          <Button variant="ghost" size="icon-sm" asChild>
            <a
              href={import.meta.env.BASE_URL}
              aria-label="打开 Moon 工作台"
              target="_blank"
              rel="noreferrer"
            >
              <ArrowUpRight />
            </a>
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          variant="reader"
          className="reader-search-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogTitle>搜索开发内容</DialogTitle>
          <Input
            ref={input}
            aria-label="搜索开发内容"
            placeholder="标题、用途、章节、文件路径或接口标识…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                results.current?.querySelector<HTMLAnchorElement>("a")?.focus()
              }
            }}
          />
          <p className="reader-search-count" role="status">
            {loading
              ? items.length
                ? `${found.length}${found.length === 60 ? "+" : ""} 条结果 · 正在补充文件索引…`
                : "正在读取内容…"
              : error ||
                `${found.length}${found.length === 60 ? "+" : ""} 条结果 · ↑ ↓ 选择，Enter 打开`}
          </p>
          <div
            ref={results}
            className="reader-search-results"
            onKeyDown={(event) => {
              const links = [
                ...(results.current?.querySelectorAll<HTMLAnchorElement>("a") ??
                  []),
              ]
              const index = links.indexOf(
                document.activeElement as HTMLAnchorElement
              )
              if (event.key === "ArrowDown") {
                event.preventDefault()
                links[(index + 1) % links.length]?.focus()
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                if (index <= 0) input.current?.focus()
                else links[index - 1]?.focus()
              }
            }}
          >
            {found.map((item) => {
              const position = item.text.toLowerCase().indexOf(needle)
              return (
                <a
                  key={item.id}
                  href={item.href}
                  onClick={(event) => {
                    if (onPluginSection && item.section === "插件开发") {
                      event.preventDefault()
                      onPluginSection(item.id)
                      setOpen(false)
                    }
                  }}
                >
                  <small>
                    {item.section} / {item.hierarchy}
                  </small>
                  <strong>{item.title}</strong>
                  <span>
                    {item.text
                      .slice(
                        Math.max(0, position - 35),
                        Math.max(0, position - 35) + 160
                      )
                      .replace(/[#`*]/g, "")}
                  </span>
                </a>
              )
            })}
            {!loading && !error && !found.length && (
              <p>没有匹配内容。可尝试组件名、文件名或操作标识。</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  )
}
