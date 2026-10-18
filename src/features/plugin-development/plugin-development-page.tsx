import { useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ReadingLayout } from "../developer-tools/reading-layout"
import { DeveloperHeader } from "../developer-tools/developer-header"
import { pluginSpecSections } from "./spec-content"
import "./plugin-development.css"

const markdownComponents: Components = {
  table: ({ children }) => <Table variant="compact">{children}</Table>,
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}
export type PluginDevelopmentPageProps = {
  section?: string
  onSectionChange?: (section: string) => void
  onReturn?: () => void
  /** Independent tools supply the shared header once at the document root. */
  header?: boolean
}
/** Read-only: no plugin runtime, RPC, session or native service is mounted. */
export function PluginDevelopmentPage({
  section,
  onSectionChange,
  onReturn,
  header = true,
}: PluginDevelopmentPageProps) {
  const [localSection, setLocalSection] = useState(pluginSpecSections[0].id)
  const [query, setQuery] = useState("")
  const active =
    pluginSpecSections.find((item) => item.id === (section ?? localSection)) ??
    pluginSpecSections[0]
  const matches = pluginSpecSections.filter((item) =>
    `${item.title}\n${item.body}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const select = (id: string) => {
    if (onSectionChange) onSectionChange(id)
    else setLocalSection(id)
  }
  return (
    <section className="reader-surface" aria-label="插件开发">
      {header && (
        <DeveloperHeader
          title="插件开发"
          onPluginSection={select}
          actions={
            onReturn ? (
              <Button variant="ghost" size="sm" onClick={onReturn}>
                <ArrowLeft data-icon="inline-start" />
                返回开发工具
              </Button>
            ) : undefined
          }
        />
      )}
      <ReadingLayout
        selectionKey={`plugin:${active.id}`}
        navigationLabel="插件规范目录"
        navigation={
          <nav
            className="plugin-development-navigation"
            aria-label="插件规范目录"
          >
            <div className="plugin-development-search">
              <Input
                aria-label="筛选规范章节"
                placeholder="筛选规范章节"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="plugin-development-chapters">
              {matches.map((item) => (
                <a
                  key={item.id}
                  href={`?section=${encodeURIComponent(item.id)}`}
                  aria-current={item.id === active.id ? "page" : undefined}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) return
                    event.preventDefault()
                    select(item.id)
                  }}
                >
                  {item.title}
                </a>
              ))}
              {!matches.length && <p>没有匹配章节。可清空筛选。</p>}
            </div>
          </nav>
        }
      >
        <article className="plugin-development-reading">
          <header>
            <p className="reader-kicker">插件开发 / 正式规范</p>
            <h1>{active.title}</h1>
            <p>Moon 插件接口 1 · Pi 运行接口 1.3.0</p>
          </header>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {active.body}
          </ReactMarkdown>
        </article>
      </ReadingLayout>
    </section>
  )
}
