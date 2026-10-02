import {
  homeSessionId,
  SessionServiceContext,
  lastHomeWorkspace,
  rememberHomeWorkspace,
} from "@/features/session/session-service"
import { effectiveThinking } from "./model-thinking"
import "./home.css"
import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { InputGroup } from "@/components/ui/input-group"
import { Field, FieldGroup } from "@/components/ui/field"
import { WorkspacePicker } from "./workspace-picker"
import { PromptInput } from "./prompt-input"
import { ComposerToolbar } from "./composer-toolbar"
import { SelectedMaterials } from "./selected-materials"
import type { HomeData, HomeDraft, SubmitWork, Workspace } from "./home-types"

export type HomeComposerProps = {
  data: Pick<
    HomeData,
    | "workspaces"
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelCatalog"
    | "materials"
    | "tools"
  >
  initialDraft?: Partial<HomeDraft>
  onSubmit: SubmitWork
  onWorkspaceAdd?: (workspace: Workspace) => void
}
export function HomeComposer({
  data,
  initialDraft = {},
  onSubmit,
  onWorkspaceAdd,
}: HomeComposerProps) {
  const sessionService = useContext(SessionServiceContext)
  const { models, materials, tools } = data
  const [addedWorkspaces, setWorkspaces] = useState<typeof data.workspaces>([])
  const workspaces = [
    ...data.workspaces,
    ...addedWorkspaces.filter(
      (item) => !data.workspaces.some((workspace) => workspace.id === item.id)
    ),
  ]
  const anchorRef = useRef<HTMLDivElement>(null)
  const [rawDraft, setDraft] = useState<HomeDraft>(() => ({
    workspaceId:
      workspaces.find(
        (item) =>
          item.id ===
          (initialDraft.workspaceId ??
            (sessionService ? lastHomeWorkspace() : undefined))
      )?.id ??
      workspaces[0]?.id ??
      "",
    text: initialDraft.text ?? "",
    model: models.includes(initialDraft.model ?? "")
      ? initialDraft.model!
      : (models[0] ?? ""),
    thinking: initialDraft.thinking ?? "中等",
    materials: initialDraft.materials ?? [],
    session: initialDraft.session ?? {
      toolIds: tools.map((tool) => tool.id),
      instructionScope: "all",
    },
  }))
  const draft = {
    ...rawDraft,
    thinking: effectiveThinking(
      rawDraft.thinking,
      data.modelThinking?.[rawDraft.model]
    ),
  }
  const workspacePath =
    workspaces.find((item) => item.id === draft.workspaceId)?.path ?? ""
  const sessionId = useMemo(
    () => (sessionService ? homeSessionId(workspacePath) : crypto.randomUUID()),
    [sessionService, workspacePath]
  )
  const [result, setResult] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const submitRequest = useRef<AbortController | null>(null)
  const configRequest = useRef<AbortController | null>(null)
  const [readySession, setReadySession] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    configRequest.current = controller
    if (sessionService && workspacePath) {
      Promise.all([
        sessionService.catalog(workspacePath, controller.signal),
        sessionService.read(sessionId, controller.signal),
      ])
        .then(([catalog, saved]) => {
          if (controller.signal.aborted) return
          const options = saved ?? catalog.defaults
          setDraft((draft) => ({
            ...draft,
            session: {
              toolIds: [...options.toolIds],
              instructionScope: options.instructionScope,
            },
          }))
          setReadySession(sessionId)
          setResult("")
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setResult(error instanceof Error ? error.message : String(error))
        })
    }
    return () => {
      controller.abort()
      submitRequest.current?.abort()
    }
  }, [sessionService, sessionId, workspacePath])
  const canSubmit =
    !submitting &&
    (!sessionService || readySession === sessionId) &&
    !!draft.text.trim() &&
    !!workspacePath &&
    workspaces.some((item) => item.id === draft.workspaceId) &&
    models.includes(draft.model)
  function change(patch: Partial<HomeDraft>) {
    if (
      patch.workspaceId !== undefined &&
      patch.workspaceId !== rawDraft.workspaceId
    ) {
      setReadySession("")
      configRequest.current?.abort()
      submitRequest.current?.abort()
    }
    setDraft((current) => ({ ...current, ...patch }))
    setResult("")
    if (patch.session) {
      configRequest.current?.abort()
      setReadySession(sessionId)
    }
  }
  async function submit() {
    if (!canSubmit) return
    submitRequest.current?.abort()
    const controller = new AbortController()
    submitRequest.current = controller
    setSubmitting(true)
    try {
      const result = await onSubmit(
        {
          ...draft,
          sessionId,
          text: draft.text.trim(),
          modelLabel:
            data.modelLabels?.[draft.model] ?? draft.modelLabel ?? draft.model,
        },
        controller.signal
      )
      if (!controller.signal.aborted) setResult(result)
    } catch (error) {
      if (!controller.signal.aborted)
        setResult(error instanceof Error ? error.message : String(error))
    } finally {
      if (submitRequest.current === controller) setSubmitting(false)
    }
  }

  return (
    <section className="home-launch" aria-label="新建工作">
      <h1 className="mb-3 text-center text-[26px] leading-8 font-medium">
        开始一项工作
      </h1>
      <WorkspacePicker
        allowCreate={!sessionService}
        workspaces={workspaces}
        onAdd={(item) => {
          if (sessionService) rememberHomeWorkspace(item)
          onWorkspaceAdd?.(item)
          setWorkspaces((current) =>
            current.some((entry) => entry.id === item.id)
              ? current
              : [...current, item]
          )
        }}
        value={draft.workspaceId}
        onChange={(workspaceId) => {
          const workspace = workspaces.find((item) => item.id === workspaceId)
          if (sessionService && workspace) rememberHomeWorkspace(workspace)
          change({ workspaceId })
        }}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <fieldset disabled={submitting} className="min-w-0 border-0 p-0">
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
                      materials: draft.materials.filter(
                        (item) => item.id !== id
                      ),
                    })
                  }
                />
                <ComposerToolbar
                  sessionId={sessionId}
                  anchorRef={anchorRef}
                  data={{
                    materials,
                    models,
                    tools,
                    modelLabels: data.modelLabels,
                    modelThinking: data.modelThinking,
                    modelCatalog: data.modelCatalog,
                  }}
                  workspacePath={
                    workspaces.find((item) => item.id === draft.workspaceId)
                      ?.path
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
                        : {
                            ...current,
                            materials: [...current.materials, item],
                          }
                    )
                    setResult("")
                  }}
                />
              </InputGroup>
            </Field>
          </FieldGroup>
        </fieldset>
      </form>
      {submitting && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          正在保存会话配置…
        </p>
      )}
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
