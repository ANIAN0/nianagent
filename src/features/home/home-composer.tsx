import {
  homeSessionId,
  SessionServiceContext,
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
import type { HomeDraftStore } from "@/features/conversation/conversation-draft-store"
import { Button } from "@/components/ui/button"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import { materialsReady } from "@/features/materials/material-service"

export type HomeComposerProps = {
  draftStore?: HomeDraftStore
  data: Pick<
    HomeData,
    | "workspaces"
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelInputs"
    | "modelCatalog"
    | "materials"
    | "materialsEnabled"
    | "tools"
  >
  initialDraft?: Partial<HomeDraft>
  onDraftChange?: (draft: HomeDraft) => void
  onSubmit: SubmitWork
  onWorkspaceAdd?: (workspace: Workspace) => void
  onChooseWorkspace?: (signal: AbortSignal) => Promise<Workspace | null>
  onWorkspaceSelect?: (id: string, signal?: AbortSignal) => Promise<void>
  workspaceLoading?: boolean
  workspaceError?: string
  onWorkspaceRetry?: () => void
}
export function HomeComposer({
  draftStore,
  data,
  initialDraft = {},
  onSubmit,
  onDraftChange,
  onWorkspaceAdd,
  onChooseWorkspace,
  onWorkspaceSelect,
  workspaceLoading,
  workspaceError,
  onWorkspaceRetry,
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
      workspaces.find((item) => item.id === initialDraft.workspaceId)?.id ??
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
    ...draftStore?.read(initialDraft.workspaceId ?? workspaces[0]?.id ?? ""),
    ...initialDraft,
  }))
  const [saveError, setSaveError] = useState("")
  useEffect(() => {
    onDraftChange?.(rawDraft)
    try { draftStore?.write(rawDraft); setSaveError("") }
    catch { setSaveError("草稿未保存，请释放本地存储空间后重试。") }
  }, [rawDraft, onDraftChange, draftStore])
  const draft = {
    ...rawDraft,
    workspaceId:
      rawDraft.workspaceId ||
      data.workspaces.find((item) => item.id === initialDraft.workspaceId)
        ?.id ||
      data.workspaces[0]?.id ||
      "",
    thinking: effectiveThinking(
      rawDraft.thinking,
      data.modelThinking?.[rawDraft.model]
    ),
  }
  const workspacePath =
    workspaces.find((item) => item.id === draft.workspaceId)?.path ?? ""
  const sessionId = useMemo(
    () =>
      sessionService && workspacePath
        ? homeSessionId(workspacePath)
        : crypto.randomUUID(),
    [sessionService, workspacePath]
  )
  const [result, setResult] = useState("")
  const materialController = useComposerMaterials({
    sessionId, cwd: workspacePath, anchorRef, materials: draft.materials,
    update: (apply) => setDraft((current) => ({ ...current, materials: apply(current.materials) })),
  })
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
    (!!draft.text.trim() || draft.materials.length > 0) &&
    materialsReady(draft.materials) &&
    !draft.materials.some((item) => item.type === "image" && data.modelInputs && !data.modelInputs[draft.model]?.includes("image")) &&
    !!workspacePath &&
    workspaces.some(
      (item) => item.id === draft.workspaceId && item.available !== false
    ) &&
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
    setDraft((current) => patch.workspaceId !== undefined && patch.workspaceId !== current.workspaceId
      ? { ...current, text: "", materials: [], ...draftStore?.read(patch.workspaceId), ...patch }
      : { ...current, ...patch })
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
        workspaces={workspaces}
        value={draft.workspaceId}
        loading={workspaceLoading}
        error={workspaceError}
        onRetry={onWorkspaceRetry}
        disabled={submitting}
        onChooseDirectory={
          onChooseWorkspace
            ? async (signal) => {
                const item = await onChooseWorkspace(signal)
                if (!item || signal.aborted) return
                setWorkspaces((items) => [
                  ...items.filter((current) => current.id !== item.id),
                  item,
                ])
                onWorkspaceAdd?.(item)
                change({ workspaceId: item.id })
              }
            : undefined
        }
        onChange={async (workspaceId, signal) => {
          await onWorkspaceSelect?.(workspaceId, signal)
          if (!signal?.aborted) change({ workspaceId })
        }}
      />
      {saveError && <p role="alert" className="text-destructive">{saveError}<Button type="button" variant="link" size="sm" onClick={() => { try { draftStore?.write(rawDraft); setSaveError("") } catch { /* Keep the visible failure. */ } }}>重试保存</Button></p>}
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
                  materials={draft.materials.map((item) => item.type === "image" && data.modelInputs && !data.modelInputs[draft.model]?.includes("image") ? { ...item, status: "failed", error: "当前模型不支持图片，请更换模型或移除。" } : item)}
                  cwd={workspacePath}
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
                    materialsEnabled: data.materialsEnabled,
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
                    void materialController.prepare(item)
                    setResult("")
                  }}
                  onChooseAttachments={materialController.service ? materialController.choose : undefined}
                  choosingMaterials={materialController.choosing}
                />
              </InputGroup>
            </Field>
          </FieldGroup>
        </fieldset>
      </form>
      {materialController.error && <p role="alert" className="mt-2 text-xs text-destructive">{materialController.error}</p>}
      {submitting && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          正在开始会话…
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
