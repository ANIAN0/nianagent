import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { isTauri } from "@tauri-apps/api/core"
import { operations, schemas, type Schema } from "../backend/contract.mjs"
import { modelCall } from "@/features/models/model-service"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { ThemeProvider } from "@/components/theme-provider"
import architecture from "../ARCHITECTURE.md?raw"
import type { ModelOperation } from "@/features/models/model-contract.generated"
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table"
import "@/index.css"
function SchemaFields({ schema }: { schema: Schema }) {
  const rows: {
    path: string
    required: boolean
    type: string
    description: string
    constraints: string
  }[] = []
  function walk(value: Schema, path: string, required: boolean) {
    const resolved = value.$ref ? schemas[value.$ref] : value
    const type =
      value.$ref ||
      resolved.type ||
      resolved.anyOf?.map((option) => option.type).join(" | ") ||
      "unknown"
    if (path)
      rows.push({
        path,
        required,
        type,
        description: resolved.description || "",
        constraints: [
          resolved.enum?.join(" / "),
          resolved.minimum !== undefined ? `最小 ${resolved.minimum}` : "",
          resolved.maxLength !== undefined
            ? `最多 ${resolved.maxLength} 字符`
            : "",
          resolved.maxItems !== undefined ? `最多 ${resolved.maxItems} 项` : "",
          resolved.pattern,
        ]
          .filter(Boolean)
          .join("；"),
      })
    if (resolved.properties)
      for (const [key, child] of Object.entries(resolved.properties))
        walk(
          child,
          path ? `${path}.${key}` : key,
          !!resolved.required?.includes(key)
        )
    if (resolved.items) walk(resolved.items, `${path || "结果"}[]`, true)
  }
  walk(schema, "", true)
  return rows.length ? (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>字段</TableHead>
          <TableHead>类型 / 必填</TableHead>
          <TableHead>说明与约束</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.path}>
            <TableCell>{row.path}</TableCell>
            <TableCell>
              {row.type} · {row.required ? "必填" : "可选"}
            </TableCell>
            <TableCell>
              {row.description} {row.constraints}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ) : (
    <p className="py-3 text-sm text-muted-foreground">
      {schema.type === "null" ? "成功返回 null。" : "无业务字段，传入空对象。"}
    </p>
  )
}
function Catalog() {
  const initial =
    new URLSearchParams(location.search).get("operation") || "list"
  const [operation, setOperation] = useState(
    Object.hasOwn(operations, initial) ? (initial as ModelOperation) : "list"
  )
  const definition = operations[operation]
  const [input, setInput] = useState(
    JSON.stringify(definition.example, null, 2)
  )
  const [result, setResult] = useState("")
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  function select(name: ModelOperation) {
    request.current?.abort()
    setBusy(false)
    setOperation(name)
    setInput(JSON.stringify(operations[name].example, null, 2))
    setResult("")
    history.replaceState(null, "", `?operation=${name}`)
  }
  async function run() {
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const value = await modelCall(
        operation,
        JSON.parse(input),
        controller.signal
      )
      if (!controller.signal.aborted) setResult(JSON.stringify(value, null, 2))
    } catch (error) {
      if (!controller.signal.aborted)
        setResult(error instanceof Error ? error.message : "请求失败")
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1>Moon · 接口目录</h1>
        <a href="/">返回应用</a>
      </header>
      <div className="flex flex-1 flex-wrap">
        <nav
          aria-label="接口模块"
          className="flex w-64 flex-col gap-1 border-r p-4"
        >
          <h2 className="mb-3 font-medium">模型配置</h2>
          <Input
            aria-label="搜索接口"
            placeholder="搜索接口"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {Object.entries(operations)
            .filter(([key, value]) =>
              `${key} ${value.title}`
                .toLowerCase()
                .includes(query.toLowerCase())
            )
            .map(([key, value]) => (
              <Button
                key={key}
                variant={key === operation ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => select(key as ModelOperation)}
              >
                {value.title}
              </Button>
            ))}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col gap-5 p-6">
          <h2 className="text-xl font-medium">{definition.title}</h2>
          <p className="text-sm text-muted-foreground">
            已实现 ·{" "}
            {isTauri() ? "Tauri → Node stdio" : "同源开发服务 → Node stdio"} ·{" "}
            {operation}
          </p>
          <p>行为：{definition.effect}</p>
          <p>
            必填参数：{definition.input.join("、") || "无"}；返回：
            {definition.result}
          </p>
          <p>调用条件与取消：{definition.condition}</p>
          <p>错误与恢复：{definition.errors}</p>
          <p className="text-sm text-muted-foreground">
            失败通过 error
            字符串返回，不返回凭据或原始提供者响应。加载页面不发起调用。
          </p>
          <details>
            <summary>请求字段与约束</summary>
            <SchemaFields schema={definition.request} />
          </details>
          <details>
            <summary>返回字段与约束</summary>
            <SchemaFields schema={definition.response} />
          </details>
          <Field>
            <FieldLabel htmlFor="rpc-input">请求参数 JSON</FieldLabel>
            <Textarea
              id="rpc-input"
              value={input}
              rows={12}
              onChange={(event) => setInput(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void run()}>
              执行真实调用
            </Button>
            <Button
              variant="outline"
              disabled={!busy}
              onClick={() => {
                request.current?.abort()
                setBusy(false)
                setResult("已取消。")
              }}
            >
              取消
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setInput("{}")
                setResult("")
              }}
            >
              清空输入与结果
            </Button>
          </div>
          <pre
            aria-label="接口响应"
            className="max-h-96 overflow-auto rounded-lg border p-4 text-sm"
          >
            {result || "尚未执行"}
          </pre>
          <details>
            <summary>模块与数据归属（ARCHITECTURE.md）</summary>
            <pre className="mt-3 text-sm whitespace-pre-wrap">
              {architecture}
            </pre>
          </details>
        </main>
      </div>
    </div>
  )
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <Catalog />
  </ThemeProvider>
)
