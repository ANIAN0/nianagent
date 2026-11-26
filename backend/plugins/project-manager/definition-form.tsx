import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Choice } from "./panel-controls"

export type Definition = {
  name: string
  args: string[]
  command: string
  url: string
  envRefs: Record<string, string>
  headerRefs: Record<string, string>
  revision?: number
}
type Row = { id: string; name: string; value: string }
function row(name = "", value = ""): Row {
  return { id: crypto.randomUUID(), name, value }
}
function rows(refs: Record<string, string> = {}) {
  return Object.entries(refs).map(([name, value]) => row(name, value))
}
function Fields({
  items,
  setItems,
  title,
  paired,
}: {
  items: Row[]
  setItems: (items: Row[]) => void
  title: string
  paired?: boolean
}) {
  function update(id: string, field: "name" | "value", value: string) {
    setItems(
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    )
  }
  return (
    <fieldset className="space-y-2">
      <legend>{title}</legend>
      {items.map((item, i) => (
        <div className="flex flex-wrap gap-2" key={item.id}>
          {paired && (
            <Input
              className="min-w-28 flex-1"
              aria-label={title + "名称 " + (i + 1)}
              placeholder="名称"
              value={item.name}
              onChange={(e) => update(item.id, "name", e.target.value)}
            />
          )}
          <Input
            className="min-w-28 flex-1"
            aria-label={title + "值 " + (i + 1)}
            placeholder={paired ? "来源环境变量" : "参数"}
            value={item.value}
            onChange={(e) => update(item.id, "value", e.target.value)}
          />
          <Button
            variant="ghost"
            type="button"
            aria-label={"移除" + title + (i + 1)}
            onClick={() => setItems(items.filter((r) => r.id !== item.id))}
          >
            移除
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => setItems([...items, row()])}
      >
        添加{title}
      </Button>
    </fieldset>
  )
}

export function DefinitionForm({
  initial,
  busy,
  save,
}: {
  initial?: Definition
  busy: boolean
  save: (definition: Definition) => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [transport, setTransport] = useState(initial?.url ? "http" : "stdio")
  const [command, setCommand] = useState(initial?.command ?? ""),
    [url, setUrl] = useState(initial?.url ?? "")
  const [args, setArgs] = useState(
    () => initial?.args.map((value) => row("", value)) ?? []
  )
  const [env, setEnv] = useState(() => rows(initial?.envRefs)),
    [headers, setHeaders] = useState(() => rows(initial?.headerRefs))
  const stdio = transport === "stdio",
    refs = stdio ? env : headers
  const valid =
    refs.every((r) => r.name.trim() && r.value.trim()) &&
    new Set(refs.map((r) => r.name.trim())).size === refs.length
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid || busy) return
        const mapped = Object.fromEntries(
          refs.map((r) => [r.name.trim(), r.value.trim()])
        )
        save({
          name: name.trim(),
          command: stdio ? command.trim() : "",
          args: stdio ? args.map((r) => r.value) : [],
          url: stdio ? "" : url.trim(),
          envRefs: stdio ? mapped : {},
          headerRefs: stdio ? {} : mapped,
          revision: initial?.revision,
        })
      }}
    >
      <label>
        定义名称
        <Input
          required
          disabled={!!initial}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <Choice
        label="传输方式"
        value={transport}
        options={[
          { value: "stdio", label: "本地命令（stdio）" },
          { value: "http", label: "HTTP" },
        ]}
        onChange={setTransport}
      />
      {stdio ? (
        <>
          <label>
            可执行命令
            <Input
              required
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </label>
          <Fields title="参数" items={args} setItems={setArgs} />
          <Fields paired title="环境变量" items={env} setItems={setEnv} />
        </>
      ) : (
        <>
          <label>
            服务 URL
            <Input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <Fields paired title="请求头" items={headers} setItems={setHeaders} />
        </>
      )}
      {!valid && (
        <p role="alert">请填写每行的名称和来源环境变量，名称须唯一。</p>
      )}
      <Button disabled={busy || !name.trim() || !valid}>保存到定义库</Button>
    </form>
  )
}
