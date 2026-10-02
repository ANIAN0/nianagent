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

export type ConversationComposerProps = {
  data: Pick<
    HomeData,
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelCatalog"
    | "materials"
    | "tools"
  >
  draft: HomeDraft
  workspacePath: string
  running?: boolean
  stopping?: boolean
  blocked?: boolean
  dock?: ReactNode
  context?: ContextUsageProps
  onChange: (draft: HomeDraft) => void
  onSubmit: (draft: HomeDraft) => void
  onStop: () => void
}
export function ConversationComposer({
  data,
  draft: rawDraft,
  workspacePath,
  running = false,
  stopping = false,
  blocked = false,
  dock,
  context,
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
    const next = { ...draft, ...patch }
    latest.current = next
    onChange(next)
  }
  const hasDraft = !!draft.text.trim() || draft.materials.length > 0
  const valid =
    hasDraft && data.models.includes(draft.model) && !stopping && !blocked
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
                    ? "写下一项任务，或补充当前工作的要求"
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
                materials={draft.materials}
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
                  anchorRef={anchorRef}
                  materials={data.materials}
                  selected={draft.materials}
                  onInsert={(text) =>
                    change({
                      text: draft.text ? `${draft.text}\n${text}` : text,
                    })
                  }
                  onAdd={(item) => {
                    // A multi-file selection emits synchronously; accumulate within that event.
                    const current = latest.current
                    if (
                      !current.materials.some(
                        (selected) => selected.id === item.id
                      )
                    ) {
                      latest.current = {
                        ...draft,
                        materials: [...current.materials, item],
                      }
                      onChange(latest.current)
                    }
                  }}
                />
                <div className="flex-1" />
                <ModelPicker
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
                                      tools={data.tools}
                  value={draft.session}
                  workspacePath={workspacePath}
                  onChange={(session) => change({ session })}
                />
                <ConversationSendControl
                  running={running}
                  stopping={stopping}
                  hasDraft={hasDraft}
                  disabled={blocked || !data.models.includes(draft.model)}
                  onStop={onStop}
                />
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldGroup>
      </form>
      {context && (
        <div className="conversation-context-slot">
          <ContextUsage {...context} />
        </div>
      )}
    </div>
  )
}
