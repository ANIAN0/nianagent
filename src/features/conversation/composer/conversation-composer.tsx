import { effectiveThinking } from "@/features/home/model-thinking"
import "./composer.css"
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react"
import { Field, FieldGroup } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { MaterialPicker } from "@/features/home/material-picker"
import { ModelPicker } from "@/features/home/model-picker"
import { SessionConfig } from "@/features/home/session-config"
import { SelectedMaterials } from "@/features/home/selected-materials"
import type { HomeData, HomeDraft } from "@/features/home/home-types"
import { ConversationSendControl } from "./conversation-send-control"
import { ContextUsage, type ContextUsageProps } from "./context-usage"
import { QueueDeliveryControl } from "./queue-delivery-control"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import { materialsReady } from "@/features/materials/material-service"

export type ConversationComposerProps = {
  allowQueue?: boolean
  sessionId?: string
  data: Pick<
    HomeData,
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelInputs"
    | "modelCatalog"
    | "materials"
    | "materialsEnabled"
    | "tools"
  >
  draft: HomeDraft
  workspacePath: string
  running?: boolean
  stopping?: boolean
  blocked?: boolean
  dock?: ReactNode
  context?: ContextUsageProps
  deliveryMode?: "single" | "all"
  onDeliveryModeChange?: (mode: "single" | "all") => void | Promise<unknown>
  onChange: (draft: HomeDraft) => void
  onSubmit: (draft: HomeDraft) => void
  onStop: () => void
}
export function ConversationComposer({
  allowQueue = true,
  sessionId,
  data,
  draft: rawDraft,
  workspacePath,
  running = false,
  stopping = false,
  blocked = false,
  dock,
  context,
  deliveryMode = "single",
  onDeliveryModeChange,
  onChange,
  onSubmit,
  onStop,
}: ConversationComposerProps) {
  const draft = useMemo(
    () => ({
      ...rawDraft,
      thinking: effectiveThinking(
        rawDraft.thinking,
        data.modelThinking?.[rawDraft.model]
      ),
    }),
    [rawDraft, data.modelThinking]
  )
  const anchorRef = useRef<HTMLDivElement>(null)
  const latest = useRef(draft)
  useLayoutEffect(() => {
    latest.current = draft
  }, [draft])
  function change(patch: Partial<HomeDraft>) {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onChange(next)
  }
  const hasDraft = !!draft.text.trim() || draft.materials.length > 0
  const materialController = useComposerMaterials({
    sessionId, cwd: workspacePath, anchorRef, materials: draft.materials,
    update: (apply) => {
      const next = { ...latest.current, materials: apply(latest.current.materials) }
      latest.current = next
      onChange(next)
    },
  })
  const valid =
    hasDraft &&
    materialsReady(draft.materials) &&
    !draft.materials.some((item) => item.type === "image" && data.modelInputs && !data.modelInputs[draft.model]?.includes("image")) &&
    data.models.includes(draft.model) &&
    !stopping &&
    !blocked &&
    (!running || allowQueue)
  function submit() {
    if (valid)
      onSubmit({
        ...draft,
        text: draft.text.trim(),
        modelLabel:
          data.modelLabels?.[draft.model] ?? draft.modelLabel ?? draft.model,
      })
  }
  return (
    <div className="conversation-composer">
      {dock && <div className="conversation-composer-dock">{dock}</div>}
      <form
        aria-label="对话输入"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <FieldGroup>
          <Field>
            <InputGroup ref={anchorRef} className="conversation-input-card">
              <InputGroupTextarea
                aria-label="对话消息"
                placeholder={
                  running
                    ? allowQueue
                      ? "写下一项任务，或补充当前工作的要求"
                      : "可以先写下一条消息，回复结束后发送"
                    : "描述你要做的事"
                }
                value={draft.text}
                className="conversation-prompt"
                onChange={(event) => change({ text: event.target.value })}
                onKeyDown={(event) => {
                  if (
                    !event.defaultPrevented &&
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <SelectedMaterials
                materials={draft.materials.map((item) => item.type === "image" && data.modelInputs && !data.modelInputs[draft.model]?.includes("image") ? { ...item, status: "failed", error: "当前模型不支持图片，请更换模型或移除。" } : item)}
                cwd={workspacePath}
                onRemove={(id) =>
                  change({
                    materials: draft.materials.filter((item) => item.id !== id),
                  })
                }
              />
              <InputGroupAddon
                align="block-end"
                className="@container gap-1.5 px-3 pt-2 pb-3"
              >
                <MaterialPicker
                  disabled={data.materialsEnabled === false}
                  anchorRef={anchorRef}
                  materials={data.materials}
                  selected={draft.materials}
                  onInsert={(text) =>
                    change({
                      text: draft.text ? `${draft.text}\n${text}` : text,
                    })
                  }
                  onAdd={(item) => {
                    void materialController.prepare(item)
                  }}
                  sessionId={sessionId}
                  workspacePath={workspacePath}
                  onTextChange={(text) => change({ text })}
                  onChooseAttachments={materialController.service ? materialController.choose : undefined}
                  choosing={materialController.choosing}
                />
                <div className="flex-1" />
                <ModelPicker
                  disabled={running || stopping || blocked}
                  models={data.models}
                  labels={data.modelLabels}
                  thinkingByModel={data.modelThinking}
                  catalog={data.modelCatalog}
                  value={draft.model}
                  thinking={draft.thinking}
                  onChange={(model) => change({ model })}
                  onThinkingChange={(thinking) => change({ thinking })}
                />
                <SessionConfig
                  disabled={running || stopping || blocked}
                  key={`${sessionId}:${workspacePath}`}
                  sessionId={sessionId}
                  tools={data.tools}
                  value={draft.session}
                  workspacePath={workspacePath}
                  onChange={(session) => change({ session })}
                />
                <ConversationSendControl
                  allowQueue={allowQueue}
                  running={running}
                  stopping={stopping}
                  hasDraft={hasDraft}
                  disabled={blocked || !data.models.includes(draft.model) || !valid && hasDraft}
                  onStop={onStop}
                />
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldGroup>
      </form>
      {materialController.error && <p role="alert" className="mt-2 text-xs text-destructive">{materialController.error}</p>}
      {context && (
        <div className="conversation-context-slot">
          {onDeliveryModeChange && <QueueDeliveryControl mode={deliveryMode} disabled={blocked || stopping} onChange={onDeliveryModeChange} />}
          <ContextUsage {...context} />
        </div>
      )}
    </div>
  )
}
