import type { RefObject } from "react"
import { InputGroupAddon } from "@/components/ui/input-group"
import { MaterialPicker } from "./material-picker"
import { ModelPicker } from "./model-picker"
import { SessionConfig } from "./session-config"
import { SendControl } from "./send-control"
import type { HomeData, HomeDraft, Material } from "./home-types"

export type ComposerToolbarProps = {
  sessionId?: string
  data: Pick<
    HomeData,
    | "materials"
    | "materialsEnabled"
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelCatalog"
    | "tools"
  >
  anchorRef?: RefObject<HTMLDivElement | null>
  workspacePath?: string
  draft: HomeDraft
  canSubmit: boolean
  onChange: (patch: Partial<HomeDraft>) => void
  onAddMaterial: (material: Material) => void
  onChooseAttachments?: () => Promise<void>
  choosingMaterials?: boolean
}
export function ComposerToolbar({
  sessionId,
  data,
  anchorRef,
  workspacePath = "",
  draft,
  canSubmit,
  onChange,
  onAddMaterial,
  onChooseAttachments,
  choosingMaterials,
}: ComposerToolbarProps) {
  return (
    <InputGroupAddon
      align="block-end"
      className="@container gap-1.5 px-3 pt-2 pb-3"
    >
      <MaterialPicker
        key={`${sessionId}:${workspacePath}`}
        disabled={data.materialsEnabled === false}
        anchorRef={anchorRef}
        onInsert={(text) =>
          onChange({ text: draft.text ? `${draft.text}\n${text}` : text })
        }
        materials={data.materials}
        selected={draft.materials}
        onAdd={onAddMaterial}
        sessionId={sessionId}
        workspacePath={workspacePath}
        onTextChange={(text) => onChange({ text })}
        onChooseAttachments={onChooseAttachments}
        choosing={choosingMaterials}
      />
      <div className="flex-1" />
      <ModelPicker
        models={data.models}
        labels={data.modelLabels}
        thinkingByModel={data.modelThinking}
        catalog={data.modelCatalog}
        value={draft.model}
        thinking={draft.thinking}
        onChange={(model) => onChange({ model })}
        onThinkingChange={(thinking) => onChange({ thinking })}
      />
      <SessionConfig
        key={`${sessionId}:${workspacePath}`}
        sessionId={sessionId}
        tools={data.tools}
        value={draft.session}
        workspacePath={workspacePath}
        onChange={(session) => onChange({ session })}
      />
      <SendControl disabled={!canSubmit} />
    </InputGroupAddon>
  )
}
