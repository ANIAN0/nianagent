import { DefinitionForm, type Definition } from "./definition-form"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Choice, ProjectDialog, useConfirmation } from "./panel-controls"
import { invoke, type McpSection } from "./service"

const clients = ["Moon / Pi", "Codex", "Claude Code", "Antigravity"]
export function McpPanel({
  projectId,
  data,
  disabled,
  prepare,
}: {
  projectId: string
  data: McpSection
  disabled: boolean
  prepare: (change: object) => Promise<void>
}) {
  const { confirm, dialog } = useConfirmation()
  const [open, setOpen] = useState(false)
  const [definitions, setDefinitions] = useState<string[]>([])
  const [definition, setDefinition] = useState("")
  const [name, setName] = useState("")
  const [updating, setUpdating] = useState(false)
  const [initial, setInitial] = useState<Definition>()
  const [creating, setCreating] = useState(false)
  const [targets, setTargets] = useState<string[]>(["Moon / Pi"])
  const [trusted, setTrusted] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [inherited, setInherited] = useState<McpSection>()
  const [status, setStatus] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    invoke<boolean>("projectTrust", { projectId }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setTrusted(value)
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setStatus(e instanceof Error ? e.message : String(e))
      })
    return () => controller.abort()
  }, [projectId])
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setStatus("")
    try {
      await fn()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 border-b pb-4">
      <h3 className="font-semibold">MCP · {data.items.length}</h3>
      {data.error && <p role="alert">{data.error}</p>}
      {data.items.map((row) => {
        const client = row.client
        return (
          <div
            className="flex flex-wrap items-center gap-2 text-sm"
            key={row.path + row.name}
          >
            <span className="min-w-0 flex-1 break-all" title={row.path}>
              {row.name} · {row.client} ·{" "}
              {row.scope === "personal" ? "个人配置" : "项目配置"} · 加载未验证
            </span>
            {client === clients[0] && trusted && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || disabled}
                onClick={() =>
                  run(async () => {
                    const r = await invoke<{
                      state: string
                      testedAt: string
                      error: string
                    }>("verifyMcp", { projectId, entryName: row.name })
                    setStatus([r.state, r.testedAt, r.error].join(" "))
                  })
                }
              >
                验证连接
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || disabled}
              onClick={() =>
                run(async () => {
                  const values = await invoke<string[]>("listDefinitions")
                  if (!values.length) throw new Error("请先登记服务定义。")
                  setDefinitions(values)
                  setDefinition(
                    values.includes(row.name) ? row.name : values[0]
                  )
                  setName(row.name)
                  setTargets([client])
                  setUpdating(true)
                  setCreating(false)
                  setOpen(true)
                })
              }
            >
              更新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || disabled}
              onClick={() =>
                run(async () => {
                  await invoke("importMcp", {
                    projectId,
                    target: client,
                    entryName: row.name,
                  })
                  setStatus("已登记到定义库")
                })
              }
            >
              登记定义
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || disabled}
              onClick={() =>
                prepare({
                  kind: "mcp.remove",
                  target: client,
                  entryName: row.name,
                })
              }
            >
              移除
            </Button>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || disabled}
          onClick={() =>
            run(async () => {
              const values = await invoke<string[]>("listDefinitions")
              setDefinitions(values)
              setDefinition(values[0] ?? "")
              setName(values[0] ?? "")
              setUpdating(false)
              setTargets([clients[0]])
              setInitial(undefined)
              setCreating(!values.length)
              setOpen(true)
            })
          }
        >
          添加项目服务
        </Button>
        <Button
          variant="ghost"
          disabled={busy || disabled || trusted === undefined}
          onClick={async () => {
            if (
              await confirm(
                trusted
                  ? "撤销此项目的 Pi 信任？"
                  : "允许 Pi 加载此目录中的项目配置？项目 MCP 可启动本机进程。"
              )
            )
              void run(async () =>
                setTrusted(
                  await invoke<boolean>("projectTrust", {
                    projectId,
                    trusted: !trusted,
                  })
                )
              )
          }}
        >
          {trusted ? "撤销 Pi 项目信任" : "信任此 Pi 项目"}
        </Button>
      </div>
      <Button
        variant="ghost"
        disabled={busy || disabled}
        onClick={() =>
          run(async () =>
            setInherited(
              inherited
                ? undefined
                : await invoke<McpSection>("inheritedMcp", { projectId })
            )
          )
        }
      >
        {inherited ? "收起个人服务" : "查看个人服务来源"}
      </Button>
      {inherited && (
        <div className="space-y-2 text-sm">
          {inherited.error && <p role="alert">{inherited.error}</p>}
          {!inherited.items.length && !inherited.error && (
            <p>可读取的个人配置中没有服务</p>
          )}
          {inherited.items.map((row) => (
            <div className="break-all" key={row.path + row.name}>
              {row.name} · {row.client} ·{" "}
              {row.scope === "personal" ? "个人配置" : "项目配置"} · 加载未验证
              · {row.path}
              {row.client === "Moon / Pi" &&
                data.items.some(
                  (p) => p.name === row.name && p.client === "Moon / Pi"
                ) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || disabled}
                    onClick={() =>
                      prepare({ kind: "mcp.cleanup", entryName: row.name })
                    }
                  >
                    预览移除个人项
                  </Button>
                )}
            </div>
          ))}
        </div>
      )}
      {status && (
        <p role="status" className="text-sm break-words">
          {status}
        </p>
      )}
      {dialog}
      <ProjectDialog
        open={open}
        onOpenChange={setOpen}
        title={creating ? "登记 MCP 定义" : "添加项目服务"}
      >
        {creating ? (
          <DefinitionForm
            busy={busy}
            initial={initial}
            save={({ revision, ...fields }) =>
              void run(async () => {
                await invoke("saveDefinition", {
                  ...fields,
                  expectedRevision: revision,
                })
                setDefinitions(await invoke<string[]>("listDefinitions"))
                setDefinition(fields.name)
                if (!updating) setName(fields.name)
                setCreating(false)
              })
            }
          />
        ) : (
          <>
            <label>
              服务定义
              <Choice
                label="服务定义"
                value={definition}
                options={definitions.map((value) => ({ value, label: value }))}
                onChange={(value) => {
                  setDefinition(value)
                  if (!updating) setName(value)
                }}
              />
            </label>
            <Input
              disabled={updating}
              aria-label="项目中的服务名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {clients.map((c) => (
              <label key={c} className="flex items-center gap-2">
                <Checkbox
                  disabled={updating}
                  checked={targets.includes(c)}
                  onCheckedChange={(v) =>
                    setTargets((current) =>
                      v ? [...current, c] : current.filter((x) => x !== c)
                    )
                  }
                />
                {c}
              </label>
            ))}
            <Button
              disabled={
                busy || disabled || !targets.length || !name || !definition
              }
              onClick={() => {
                setOpen(false)
                void prepare(
                  updating
                    ? {
                        kind: "mcp.update",
                        target: targets[0],
                        definitionId: definition,
                        entryName: name,
                      }
                    : {
                        kind: "mcp.bind",
                        definitionId: definition,
                        entryName: name,
                        targets,
                      }
                )
              }}
            >
              预览写入
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(true)
                setInitial(undefined)
                setName("")
              }}
            >
              新建服务定义
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                run(async () => {
                  setInitial(
                    await invoke<Definition>("readDefinition", {
                      name: definition,
                    })
                  )
                  setCreating(true)
                })
              }
            >
              编辑定义
            </Button>
          </>
        )}
        {status && <p role="alert">{status}</p>}
      </ProjectDialog>
    </section>
  )
}
