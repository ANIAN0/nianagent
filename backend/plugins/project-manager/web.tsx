import { ProjectLayout, useConfirmation } from "./panel-controls"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { PreviewDialog } from "./preview-dialog"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SkillsDialog } from "./skills-dialog"
import { AgentsComposeDialog } from "./agents-compose-dialog"
import { MarkdownEditor } from "@/components/markdown-editor"
import {
  invoke,
  type Project,
  type SkillSection,
  skillLabels,
  type Detail,
} from "./service"
import { McpPanel } from "./mcp-panel"
import { useProjectChange } from "./use-project-change"
import type { PluginWebModule } from "@/features/plugins/plugin-api"

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

function Resources({ title, data }: { title: string; data: SkillSection }) {
  return (
    <section className="space-y-2 border-b pb-4">
      <h3 className="font-semibold">
        {title} · {data.items.length}
      </h3>
      {data.error && (
        <p role="alert" className="text-destructive">
          {data.error}
        </p>
      )}
      {data.items.map((item) => (
        <div
          key={item.name + item.path}
          className="flex flex-wrap justify-between gap-2 text-sm"
        >
          <span className="break-all" title={item.path}>
            {item.name}
          </span>
          <Badge variant="secondary">{skillLabels[item.state]}</Badge>
        </div>
      ))}
      {!data.items.length && !data.error && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>项目中未发现{title}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}

function Page() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState("")
  const [query, setQuery] = useState("")
  const [version, setVersion] = useState(0)
  const [detail, setDetail] = useState<Detail>()
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState(false)
  const [listError, setListError] = useState("")
  const [loading, setLoading] = useState(true)
  const selected = projects.find((row) => row.id === projectId)
  const dirty = editing && draft !== detail?.agents.content
  const { confirm, dialog } = useConfirmation()
  const {
    preview,
    pending,
    error,
    setError,
    lastResult,
    hasReceipt,
    run,
    buildPreview,
    prepare,
    recover,
    apply,
    closePreview,
    reset: resetChange,
  } = useProjectChange({
    projectId,
    expectedRevision: detail?.revision,
    onApplied: () => {
      setEditing(false)
      setVersion((v) => v + 1)
    },
  })
  async function discard() {
    return !dirty || (await confirm("放弃尚未保存的项目指令？"))
  }
  async function navigate(id: string) {
    if (!(await discard())) return
    setProjectId(id)
    setDetail(undefined)
    setEditing(false)
    resetChange()
  }
  useEffect(() => {
    const controller = new AbortController()
    invoke<Project[]>("listProjects", {}, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setProjects(rows)
          setListError("")
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setListError(message(e))
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [version])
  useEffect(() => {
    if (!projectId) return
    const controller = new AbortController()
    invoke<Detail>("inspectProject", { projectId }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDetail(data)
          setDraft(data.agents.content)
          setError("")
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e))
      })
    return () => controller.abort()
  }, [projectId, version, setError])
  async function add() {
    if (!(await discard())) return
    await run(async () => {
      const picked = await invoke<{ cancelled: boolean; path: string }>(
        "chooseDirectory"
      )
      if (picked.cancelled) return
      const rows = await invoke<Project[]>("listProjects")
      setProjects(rows)
      setEditing(false)
      setDetail(undefined)
      setProjectId(rows.find((p) => p.path === picked.path)?.id ?? "")
      setVersion((v) => v + 1)
      setQuery("")
    })
  }
  const visible = projects.filter((p) =>
    (p.name + " " + p.path).toLowerCase().includes(query.toLowerCase())
  )
  return (
    <ProjectLayout>
      {dialog}
      <div className="grid gap-6 @[880px]:grid-cols-[240px_minmax(0,1fr)]">
        <aside
          className={selected ? "hidden space-y-3 @[880px]:block" : "space-y-3"}
        >
          <Button onClick={add} disabled={pending}>
            添加项目目录
          </Button>
          <Input
            aria-label="搜索项目"
            placeholder="搜索名称或路径"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {listError && (
            <p role="alert">
              {listError}{" "}
              <Button onClick={() => setVersion((v) => v + 1)}>重试</Button>
            </p>
          )}
          {loading && (
            <Skeleton aria-label="正在读取项目" className="h-12 w-full" />
          )}
          {!visible.length && query && (
            <Button variant="ghost" onClick={() => setQuery("")}>
              无匹配项目 · 清除搜索
            </Button>
          )}
          {visible.map((p) => (
            <Button
              key={p.id}
              variant={p.id === projectId ? "secondary" : "ghost"}
              className="h-auto w-full flex-col items-start overflow-hidden"
              disabled={pending}
              onClick={() => {
                if (projectId !== p.id) navigate(p.id)
              }}
            >
              <span>{p.name}</span>
              <span
                title={p.path}
                className="max-w-full truncate text-xs text-muted-foreground"
              >
                {p.path}
              </span>
            </Button>
          ))}
        </aside>
        <main className="min-w-0 space-y-4">
          {selected && (
            <header className="space-y-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => navigate("")}
                className="@[880px]:hidden"
              >
                返回项目
              </Button>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="text-sm break-all text-muted-foreground">
                {selected.path}
              </p>
              <Button
                variant="outline"
                disabled={pending}
                onClick={async () => {
                  if (await discard()) {
                    setEditing(false)
                    setVersion((v) => v + 1)
                  }
                }}
              >
                刷新
              </Button>
              {selected.sources.includes("custom") && (
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={async () => {
                    if (
                      (await discard()) &&
                      (await confirm("从手动登记清单移除此目录？"))
                    )
                      void run(async () => {
                        await invoke("unregister", { projectId })
                        setProjectId("")
                        setDetail(undefined)
                        setEditing(false)
                        setVersion((v) => v + 1)
                      })
                  }}
                >
                  取消登记
                </Button>
              )}
            </header>
          )}
          {error && (
            <Alert className="border-destructive text-destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {selected && hasReceipt && (
            <Button variant="ghost" disabled={pending} onClick={recover}>
              查看最近操作回执
            </Button>
          )}
          {lastResult && (
            <p role="status" className="break-all whitespace-pre-wrap">
              {lastResult}
            </p>
          )}
          {selected && !detail && !error && (
            <Skeleton aria-label="正在读取项目配置" className="h-24 w-full" />
          )}
          {selected && detail && (
            <>
              <Resources title="Skills" data={detail.skills} />
              <SkillsDialog
                key={projectId}
                projectId={projectId}
                pending={pending}
                error={error}
                run={run}
                buildPreview={buildPreview}
                disabled={editing}
                data={detail.skills}
              />
              <McpPanel
                key={projectId}
                projectId={projectId}
                data={detail.mcp}
                disabled={pending || editing}
                prepare={prepare}
              />
              <section className="space-y-3">
                <h3 className="font-semibold">AGENTS.md</h3>
                {detail.agents.error ? (
                  <p role="alert">{detail.agents.error}</p>
                ) : (
                  <>
                    {editing ? (
                      <MarkdownEditor
                        ariaLabel="项目指令"
                        value={draft}
                        onChange={setDraft}
                      />
                    ) : (
                      <pre className="max-h-96 overflow-auto text-sm break-words whitespace-pre-wrap">
                        {detail.agents.content ||
                          (detail.agents.exists
                            ? "文件为空"
                            : "项目尚无 AGENTS.md")}
                      </pre>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {editing ? (
                        <>
                          <Button
                            disabled={pending || !dirty}
                            onClick={() =>
                              prepare({ kind: "agents.edit", content: draft })
                            }
                          >
                            预览修改
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={pending}
                            onClick={async () => {
                              if (await discard()) {
                                setEditing(false)
                                setDraft(detail.agents.content)
                              }
                            }}
                          >
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => setEditing(true)}
                          >
                            编辑原文
                          </Button>
                          <AgentsComposeDialog
                            key={projectId}
                            projectId={projectId}
                            pending={pending}
                            error={error}
                            run={run}
                            buildPreview={buildPreview}
                            original={detail.agents.content}
                          />
                        </>
                      )}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </main>

        <PreviewDialog
          projectName={selected?.name ?? ""}
          preview={preview}
          pending={pending}
          error={error}
          onClose={closePreview}
          onApply={apply}
        />
      </div>
    </ProjectLayout>
  )
}
export default {
  id: "project-manager",
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "manager", component: Page }],
} satisfies PluginWebModule
