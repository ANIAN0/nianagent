import type { ReactNode, RefObject } from "react"
import { InputGroupAddon } from "@/components/ui/input-group"
import { DisabledControlReason } from "@/components/composer/disabled-control-reason"
import { MaterialPicker } from "./material-picker"
import { ModelPicker } from "./model-picker"
import { SessionConfig } from "./session-config"
import { SendControl } from "./send-control"
import type { HomeData, HomeDraft, Material } from "./home-types"

export type ComposerToolbarProps = {
  disabled?: boolean
  configurationDisabled?: boolean
  configurationLoading?: boolean
  configurationDisabledReason?: string
  modelDisabled?: boolean
  modelDisabledReason?: string
  materialsDisabled?: boolean
  materialsDisabledReason?: string
  allowCompact?: boolean
  sendControl?: ReactNode
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
  disabled = false,
  configurationDisabled = false,
  configurationLoading = false,
  configurationDisabledReason,
  modelDisabled = false,
  modelDisabledReason,
  materialsDisabled = false,
  materialsDisabledReason,
  allowCompact = false,
  sendControl,
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
  const materialLocked =
    disabled || materialsDisabled || data.materialsEnabled === false
  const materialLockReason =
    materialsDisabledReason ??
    (data.materialsEnabled === false
      ? "当前服务尚未提供附件与引用能力，恢复服务后可添加材料。"
      : (configurationDisabledReason ?? "当前操作完成后可添加材料。"))
  const materialPicker = (
    <MaterialPicker
      key={`materials:${sessionId}:${workspacePath}`}
      disabled={materialLocked}
      allowCompact={allowCompact}
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
  )
  return (
    <InputGroupAddon align="block-end" className="moon-composer-toolbar">
      <div className="moon-composer-toolbar-leading">
        {materialLocked ? (
          <DisabledControlReason
            label="添加材料暂不可用"
            reason={materialLockReason}
          >
            {materialPicker}
          </DisabledControlReason>
        ) : (
          materialPicker
        )}
      </div>
      <div className="moon-composer-toolbar-trailing">
        <ModelPicker
          disabled={disabled || modelDisabled}
          disabledReason={modelDisabledReason ?? configurationDisabledReason}
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
          loading={configurationLoading}
          disabled={disabled || configurationDisabled}
          disabledReason={configurationDisabledReason}
          key={`config:${sessionId}:${workspacePath}`}
          sessionId={sessionId}
          tools={data.tools}
          value={draft.session}
          workspacePath={workspacePath}
          onChange={(session) => onChange({ session })}
        />
        {sendControl ?? <SendControl disabled={!canSubmit} />}
      </div>
    </InputGroupAddon>
  )
}
