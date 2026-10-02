import "./home.css"
import { useRef, useState } from "react"
import { InputGroup } from "@/components/ui/input-group"
import { Field, FieldGroup } from "@/components/ui/field"
import { WorkspacePicker } from "./workspace-picker"
import { PromptInput } from "./prompt-input"
import { ComposerToolbar } from "./composer-toolbar"
import { SelectedMaterials } from "./selected-materials"
import { thinkingOptions } from "./thinking-picker"
import type { HomeData, HomeDraft, SubmitWork } from "./home-types"

export type HomeComposerProps = {
  data: Pick<HomeData, "workspaces" | "models" | "materials" | "tools">
  initialDraft?: Partial<HomeDraft>
  onSubmit: SubmitWork
}
export function HomeComposer({
  data,
  initialDraft = {},
  onSubmit,
}: HomeComposerProps) {
  const { models, materials, tools } = data
  const [workspaces, setWorkspaces] = useState(data.workspaces)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<HomeDraft>(() => ({
    workspaceId:
      workspaces.find((item) => item.id === initialDraft.workspaceId)?.id ??
      workspaces[0]?.id ??
      "",
    text: initialDraft.text ?? "",
    model: models.includes(initialDraft.model ?? "")
      ? initialDraft.model!
      : (models[0] ?? ""),
    thinking:
      thinkingOptions.find((value) => value === initialDraft.thinking) ??
      "中等",
    materials: initialDraft.materials ?? [],
    session: initialDraft.session ?? {
      toolIds: tools.map((tool) => tool.id),
      instructionScope: "all",
    },
  }))
  const [result, setResult] = useState("")
  const canSubmit =
    !!draft.text.trim() &&
    workspaces.some((item) => item.id === draft.workspaceId) &&
    models.includes(draft.model)
  function change(patch: Partial<HomeDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setResult("")
  }
  function submit() {
    if (!canSubmit) return
    setResult(onSubmit({ ...draft, text: draft.text.trim() }))
  }
  return (
    <section className="home-launch" aria-label="新建工作">
      <h1 className="mb-3 text-center text-[26px] leading-8 font-medium">
        开始一项工作
      </h1>
      <WorkspacePicker
        workspaces={workspaces}
        onAdd={(item) =>
          setWorkspaces((current) =>
            current.some((entry) => entry.id === item.id)
              ? current
              : [...current, item]
          )
        }
        value={draft.workspaceId}
        onChange={(workspaceId) => change({ workspaceId })}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <FieldGroup>
          <Field>
            <InputGroup
              ref={anchorRef}
              className="rounded-2xl bg-card shadow-sm has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card"
            >
              <PromptInput
                value={draft.text}
                onChange={(text) => change({ text })}
                onSubmit={submit}
              />
              <SelectedMaterials
                materials={draft.materials}
                onRemove={(id) =>
                  change({
                    materials: draft.materials.filter((item) => item.id !== id),
                  })
                }
              />
              <ComposerToolbar
                anchorRef={anchorRef}
                data={{ materials, models, tools }}
                workspacePath={
                  workspaces.find((item) => item.id === draft.workspaceId)?.path
                }
                draft={draft}
                canSubmit={canSubmit}
                onChange={change}
                onAddMaterial={(item) => {
                  setDraft((current) =>
                    current.materials.some(
                      (selected) => selected.id === item.id
                    )
                      ? current
                      : { ...current, materials: [...current.materials, item] }
                  )
                  setResult("")
                }}
              />
            </InputGroup>
          </Field>
        </FieldGroup>
      </form>
      {result && (
        <p
          role="status"
          className="mt-4 rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground"
        >
          {result}
        </p>
      )}
    </section>
  )
}
