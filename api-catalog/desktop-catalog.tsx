import { DeferredContent } from "./components/deferred-content"
import { Input } from "@/components/ui/input"
import type { Schema, SchemaRegistry } from "./components/types"
import { useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import {
  desktopCommandMetadata,
  desktopSchemaMetadata,
  type DesktopCommand,
} from "@/contracts/desktop.generated"
import { desktopCall } from "@/features/settings/desktop-service"
import {
  desktopIssue,
  DesktopFeedback,
} from "@/features/settings/settings-feedback"
import { Button } from "@/components/ui/button"
import { CatalogHeader } from "./components/catalog-header"
import { useTheme } from "@/components/theme-provider"
import type { DesktopIssue } from "@/contracts/desktop.generated"

const entries = Object.entries(desktopCommandMetadata) as [
  DesktopCommand,
  (typeof desktopCommandMetadata)[DesktopCommand],
][]
function documentationSchema(value: unknown): Schema {
  const schema = value as {
    nullable?: unknown
    type?: string
    $ref?: string
    properties?: Record<string, unknown>
    items?: unknown
    enum?: string[]
  }
  if (schema.nullable)
    return { anyOf: [documentationSchema(schema.nullable), { type: "null" }] }
  if (schema.$ref) return { $ref: schema.$ref }
  if (schema.properties)
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(schema.properties).map(([key, property]) => [
          key,
          documentationSchema(property),
        ])
      ),
      required: Object.keys(schema.properties),
      additionalProperties: false,
    }
  if (schema.items)
    return { type: "array", items: documentationSchema(schema.items) }
  return schema as Schema
}
const schemas: SchemaRegistry = Object.fromEntries(
  Object.entries(desktopSchemaMetadata).map(([key, value]) => [
    key,
    documentationSchema(value),
  ])
)
const loadFields = () =>
  import("./components/schema-field-table").then((module) => ({
    default: module.SchemaFieldTable,
  }))
function DesktopFields({ label, schema }: { label: string; schema: Schema }) {
  return (
    <DeferredContent
      load={loadFields}
      props={{ label, schema, schemas }}
      label={label}
      fallback={<p role="status">正在载入字段…</p>}
    />
  )
}
export function DesktopApiCatalog() {
  const { theme, setTheme } = useTheme()
  const initial = new URLSearchParams(location.search).get("desktop")
  const [selected, setSelected] = useState<DesktopCommand>(
    entries.some(([id]) => id === initial)
      ? (initial as DesktopCommand)
      : "desktop_get_state"
  )
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const [issue, setIssue] = useState<DesktopIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const [mobileNavigation, setMobileNavigation] = useState(false)
  const definition = desktopCommandMetadata[selected]
  const filtered = entries.filter(([id, item]) =>
    `${id} ${item.title} ${item.module}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  )
  const callable =
    selected === "desktop_get_state" || selected === "update_check"
  async function read() {
    if (!callable || busy) return
    setBusy(true)
    setIssue(null)
    try {
      const value =
        selected === "desktop_get_state"
          ? await desktopCall("desktop_get_state", undefined)
          : await desktopCall("update_check", undefined)
      setResult(JSON.stringify(value, null, 2))
    } catch (error) {
      setIssue(desktopIssue(error))
    } finally {
      setBusy(false)
    }
  }
  const navigation = (
    <nav className="p-4" aria-label="桌面接口模块">
      <label
        className="text-xs text-muted-foreground"
        htmlFor="desktop-api-search"
      >
        搜索桌面接口
      </label>
      <Input
        id="desktop-api-search"
        className="mt-2 mb-4 w-full rounded-md border p-2 text-sm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {[...new Set(filtered.map(([, item]) => item.module))].map((module) => (
        <section className="mb-4" key={module}>
          <h2 className="mb-2 text-xs text-muted-foreground">{module}</h2>
          {filtered
            .filter(([, item]) => item.module === module)
            .map(([id, item]) => (
              <a
                href={`?desktop=${encodeURIComponent(id)}`}
                key={id}
                aria-current={id === selected ? "page" : undefined}
                className="api-operation-link"
                onClick={(event) => {
                  if (
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return
                  event.preventDefault()
                  history.replaceState(
                    null,
                    "",
                    `?desktop=${encodeURIComponent(id)}`
                  )
                  setSelected(id)
                  setResult(null)
                  setIssue(null)
                  setMobileNavigation(false)
                }}
              >
                <span>{item.title}</span>
                <code>{id}</code>
              </a>
            ))}
        </section>
      ))}
      <Button variant="outline" asChild>
        <a href="?operation=list">业务接口目录</a>
      </Button>
    </nav>
  )
  return (
    <div className="api-catalog-root">
      <CatalogHeader
        environment={isTauri() ? "Tauri 原生宿主" : "浏览器 · 原生调用不可用"}
        theme={theme}
        onThemeChange={setTheme}
        onOpenNavigation={() => setMobileNavigation((value) => !value)}
      />
      <div className="api-catalog-layout">
        <aside className="api-catalog-sidebar">{navigation}</aside>
        <main className="api-catalog-workspace">
          {mobileNavigation && <div className="border-b">{navigation}</div>}
          <section className="space-y-6 p-6">
            <header>
              <p className="mb-2 text-xs text-muted-foreground">
                {definition.module}
              </p>
              <h2 className="text-xl font-semibold">{definition.title}</h2>
              <code className="text-xs">{selected}</code>
            </header>
            <p className="text-sm leading-6">{definition.effect}</p>
            <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 text-sm">
              <dt className="text-muted-foreground">请求</dt>
              <dd>
                {definition.input ?? "无参数"}
                {definition.input ? " · 唯一 input 参数" : ""}
              </dd>
              <dt className="text-muted-foreground">响应</dt>
              <dd>{definition.result ?? "null"}</dd>
              <dt className="text-muted-foreground">实现</dt>
              <dd className="break-all">{definition.source}</dd>
              <dt className="text-muted-foreground">错误</dt>
              <dd>
                DesktopIssue：code / message / recovery /
                activities。传输结果未知先读取状态，不自动重发。
              </dd>
            </dl>
            {definition.input && (
              <section className="space-y-3">
                <h3 className="font-semibold">请求字段</h3>
                <DesktopFields
                  label="桌面请求"
                  schema={schemas[definition.input]}
                />
              </section>
            )}
            {definition.result && (
              <section className="space-y-3">
                <h3 className="font-semibold">响应字段</h3>
                <DesktopFields
                  label="桌面响应"
                  schema={schemas[definition.result]}
                />
              </section>
            )}
            <section className="space-y-3 border-t pt-6">
              <h3 className="font-semibold">正式调用与恢复边界</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                数据迁移、下载、安装和偏好写入从“设置 →
                应用”进入完整流程。维护保存与启动确认由主窗口按当前身份自动应答，接口目录不会伪造确认。
              </p>
              {callable && (
                <Button
                  disabled={busy || !isTauri()}
                  onClick={() => void read()}
                >
                  {busy ? "正在调用…" : "读取真实宿主结果"}
                </Button>
              )}
              {!isTauri() && (
                <p className="text-sm text-muted-foreground">
                  当前浏览器未连接 Tauri 原生能力，不能执行桌面命令。
                </p>
              )}
              {issue && <DesktopFeedback issue={issue} />}
              {result && (
                <pre className="max-h-96 overflow-auto rounded-md border p-4 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
                  {result}
                </pre>
              )}
            </section>
          </section>
        </main>
      </div>
    </div>
  )
}
