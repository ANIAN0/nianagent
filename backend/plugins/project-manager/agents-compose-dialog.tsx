import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Choice, ProjectDialog } from "./panel-controls"
import { invoke, type Snippet, type ResourceDialogProps } from "./service"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { DialogFooter } from "@/components/ui/dialog"
import { MarkdownEditor } from "@/components/markdown-editor"
export function AgentsComposeDialog({
  projectId,
  pending,
  error,
  run,
  buildPreview,
  original,
}: ResourceDialogProps & { original: string }) {
  const [library, setLibrary] = useState<Snippet[]>()
  const [templates, setTemplates] = useState<
    { id: string; name: string; ids: string[] }[]
  >([])
  const [templateName, setTemplateName] = useState("")
  const [merge, setMerge] = useState<string>()
  const [chosen, setChosen] = useState<string[]>([])
  async function prepare(change: object) {
    await run(async () => {
      await buildPreview(change)
      setLibrary(undefined)
    })
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const data = await invoke<{
              snippets: Snippet[]
              templates: typeof templates
              selected: string[]
            }>("listLibrary", { projectId })
            setLibrary(data.snippets)
            setTemplates(data.templates)
            setChosen(data.selected)
            setTemplateName("")
            setMerge(undefined)
          })
        }
      >
        选用片段或模板
      </Button>
      <ProjectDialog
        open={Boolean(library)}
        onOpenChange={(v) => {
          if (!v && !pending) setLibrary(undefined)
        }}
        title="组合项目指令"
      >
        {templates.length > 0 && (
          <label>
            选用模板{" "}
            <Choice
              label="选用模板"
              placeholder="选择模板"
              options={templates.map((t) => ({ value: t.id, label: t.name }))}
              onChange={(id) =>
                setChosen(templates.find((t) => t.id === id)?.ids ?? [])
              }
            />
          </label>
        )}
        <div className="max-h-[55vh] space-y-2 overflow-auto">
          {library?.length === 0 && <p>片段库为空</p>}
          {library?.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <Checkbox
                checked={chosen.includes(s.id)}
                onCheckedChange={(v) =>
                  setChosen((ids) =>
                    v ? [...ids, s.id] : ids.filter((id) => id !== s.id)
                  )
                }
              />
              {s.name}
            </label>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <ol className="max-h-36 overflow-y-auto">
          {chosen.map((id, i) => (
            <li key={id} className="flex items-center gap-2">
              <span className="flex-1">
                {library?.find((s) => s.id === id)?.name ?? "已删除的片段"}
              </span>
              {[-1, 1].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant="ghost"
                  disabled={!chosen[i + d]}
                  onClick={() => {
                    const next = [...chosen]
                    ;[next[i], next[i + d]] = [next[i + d], next[i]]
                    setChosen(next)
                  }}
                >
                  {d < 0 ? "上移" : "下移"}
                </Button>
              ))}
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Input
            aria-label="模板名称"
            placeholder="模板名称"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <Button
            disabled={pending || !chosen.length || !templateName.trim()}
            variant="outline"
            onClick={() =>
              run(async () => {
                const id = await invoke<string>("saveTemplate", {
                  name: templateName.trim(),
                  ids: chosen,
                })
                setTemplates([
                  ...templates,
                  { id, name: templateName.trim(), ids: chosen },
                ])
                setTemplateName("")
              })
            }
          >
            另存为模板
          </Button>
        </div>
        {error && merge === undefined && (
          <Button variant="ghost" onClick={() => setMerge(original)}>
            手工合并原文
          </Button>
        )}
        {merge !== undefined && (
          <MarkdownEditor
            value={merge}
            onChange={setMerge}
            ariaLabel="手工合并全文"
          />
        )}
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              prepare({
                kind: "agents.append",
                snippetIds: chosen,
                resolution: merge,
              })
            }
          >
            预览组合
          </Button>
        </DialogFooter>
      </ProjectDialog>
    </>
  )
}
