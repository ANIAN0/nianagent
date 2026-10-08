import { useComposerAnchor } from "@/lib/composer/use-composer-anchor"
import { type ComposerEditorElement } from "@/components/composer/composer-editor-contract"
import { effectiveThinking } from "@/lib/composer/model-thinking"
import "./composer.css"
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react"
import { Field, FieldGroup } from "@/components/ui/field"
import { ComposerInputCard } from "@/components/composer/composer-input-card"
import {
  insertComposerText,
  removeComposerMaterial,
} from "@/features/materials/composer-material-edit"
import { Button } from "@/components/ui/button"
import { ComposerToolbar } from "@/components/composer/composer-toolbar"
import { PromptInput } from "@/components/composer/prompt-input"
import {
  composerDraftEligibility,
  composerDisplayMaterials,
  editableComposerDraft,
} from "@/components/composer/composer-policy"
import { SelectedMaterials } from "@/components/composer/selected-materials"
import { ComposerPanelProvider } from "@/components/composer/composer-panel-context"
import type { ComposerData, ComposerDraft } from "@/lib/composer/types"
import { ConversationSendControl } from "./conversation-send-control"
import type { ContextUsageProps } from "./context-usage"
import { ComposerAuxiliaryBar } from "./composer-auxiliary-bar"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import { NotificationToast } from "@/components/ui/notification-toast"
import type { FeedbackDescription } from "@/lib/operation-issue"
import type { ConversationStatistics } from "@/contracts/rpc.generated"
import type { BusyInputMode } from "./run-input-control"

export type ConversationComposerProps = {
  inputRef?: Ref<ComposerEditorElement>
  allowQueue?: boolean
  sessionId?: string
  data: Pick<
    ComposerData,
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelInputs"
    | "modelCatalog"
    | "materials"
    | "materialsEnabled"
    | "tools"
  >
  draft: ComposerDraft
  workspacePath: string
  running?: boolean
  stopping?: boolean
  stopUnconfirmed?: boolean
  blocked?: boolean
  blockedReason?: string
  compactDisabledReason?: string
  dock?: ReactNode
  interaction?: ReactNode
  feedback?: ReactNode
  queueRecovery?: ReactNode
  context?: ContextUsageProps
  statistics?: ConversationStatistics
  modeIssue?: FeedbackDescription
  modeChecking?: boolean
  onCheckMode?: () => void
  onChange: (draft: ComposerDraft) => void
  onSubmit: (draft: ComposerDraft, delivery?: BusyInputMode) => void
  onStop: () => void
}
export function ConversationComposer({
  inputRef,
  allowQueue = true,
  sessionId,
  data,
  draft: rawDraft,
  workspacePath,
  running = false,
  stopping = false,
  stopUnconfirmed = false,
  blocked = false,
  blockedReason,
  compactDisabledReason,
  dock,
  interaction,
  feedback,
  queueRecovery,
  context,
  statistics,
  modeIssue,
  modeChecking,
  onCheckMode,
  onChange,
  onSubmit,
  onStop,
}: ConversationComposerProps) {
  const draft = useMemo(
    () =>
      editableComposerDraft({
        ...rawDraft,
        thinking: effectiveThinking(
          rawDraft.thinking,
          data.modelThinking?.[rawDraft.model]
        ),
      }),
    [rawDraft, data.modelThinking]
  )
  const { anchorRef, anchorNode, bindAnchor } = useComposerAnchor()
  const [formMinimum, setFormMinimum] = useState(80)
  useLayoutEffect(() => {
    const card = anchorNode
    if (!card) return
    const addons = Array.from(
      card.querySelectorAll<HTMLElement>(
        ":scope > [data-slot=input-group-addon]"
      )
    )
    const measureMinimum = () => {
      const style = getComputedStyle(card)
      const editor = card.querySelector<HTMLElement>(
        ".moon-composer-editor-body"
      )
      const editorMinimum = editor
        ? parseFloat(getComputedStyle(editor).minHeight)
        : 36
      const minimum =
        editorMinimum +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth) +
        (parseFloat(style.rowGap) || 0) * addons.length +
        addons.reduce(
          (sum, addon) => sum + addon.getBoundingClientRect().height,
          0
        )
      setFormMinimum((current) => (current === minimum ? current : minimum))
    }
    const observer = new ResizeObserver(measureMinimum)
    addons.forEach((addon) => observer.observe(addon))
    measureMinimum()
    return () => observer.disconnect()
  }, [draft.materials.length, anchorNode])
  const latest = useRef(draft)
  useLayoutEffect(() => {
    latest.current = draft
  }, [draft])
  function change(patch: Partial<ComposerDraft>) {
    const next = editableComposerDraft({ ...latest.current, ...patch })
    latest.current = next
    onChange(next)
  }
  const compactCommand = /^\/compact(?:\s|$)/.test(draft.text.trim())
  const extensionCommand =
    draft.command?.kind === "extension" &&
    draft.text.trim().match(/^\/([^\s]+)/)?.[1] === draft.command.name
  const compactBlockedReason = !compactCommand
    ? ""
    : draft.materials.length > 0
      ? "压缩命令不能携带材料，请先移除材料。文字与材料会继续保留。"
      : running || stopping
        ? "当前工作结束后才能执行压缩命令；这条命令不会进入排队消息。"
        : blocked
          ? blockedReason || "当前操作尚未完成。"
          : compactDisabledReason || ""
  const materialsDisabled =
    !!interaction ||
    data.materialsEnabled === false ||
    stopping ||
    blocked ||
    (running && !allowQueue)
  const materialController = useComposerMaterials({
    sessionId,
    cwd: workspacePath,
    anchorNode,
    materials: draft.materials,
    disabled: materialsDisabled,
    onPasteText: (text, start, end) =>
      change({
        text: insertComposerText(latest.current.text, text, start, end),
      }),
    update: (apply) => {
      const next = editableComposerDraft({
        ...latest.current,
        materials: apply(latest.current.materials),
      })
      latest.current = next
      onChange(next)
    },
  })
  const eligibility = composerDraftEligibility(
    draft,
    data,
    materialController.ready,
    materialController.choosing
  )
  const messageValid =
    eligibility.canSend && !stopping && !blocked && (!running || allowQueue)
  const valid =
    !interaction &&
    !materialController.choosing &&
    (compactCommand
      ? !compactBlockedReason
      : extensionCommand
        ? messageValid && !running && draft.materials.length === 0
        : messageValid)
  const materialFailure = materialController.feedback
  const sendDisabledReason =
    eligibility.hasDraft && !valid && !running && !stopping
      ? blocked
        ? blockedReason || "当前操作尚未完成，请完成或核对后发送。"
        : compactBlockedReason ||
          eligibility.reason ||
          (extensionCommand && draft.materials.length > 0
            ? "扩展命令不能同时附带材料，请移除材料后执行。"
            : undefined)
      : undefined
  function submit(alternate = false) {
    if (valid)
      onSubmit(
        {
          ...draft,
          text: draft.text.trim(),
          modelLabel:
            data.modelLabels?.[draft.model] ?? draft.modelLabel ?? draft.model,
        },
        running && alternate ? "steer" : "followUp"
      )
  }
  const configurationDisabledReason = stopping
    ? "正在停止当前工作，停止完成后可修改会话配置。"
    : blocked
      ? blockedReason || "当前操作尚未完成，完成或核对后可修改会话配置。"
      : running
        ? "当前工作运行中，工作结束后可修改会话配置。"
        : undefined
  const materialsDisabledReason = stopping
    ? "正在停止当前工作，停止完成后可添加材料。"
    : blocked
      ? blockedReason || "当前操作尚未完成，完成或核对后可添加材料。"
      : running && !allowQueue
        ? "当前运行不支持排队，工作结束后可添加下一条消息的材料。"
        : undefined
  return (
    <ComposerPanelProvider inactive={!!interaction}>
      <div
        className="conversation-composer"
        data-approval-active={!!interaction || undefined}
      >
        {interaction && (
          <div className="conversation-composer-interaction">{interaction}</div>
        )}
        {feedback && (
          <div className="conversation-composer-feedback">{feedback}</div>
        )}
        {dock && <div className="conversation-composer-dock">{dock}</div>}
        <form
          style={{ minHeight: formMinimum }}
          aria-label="对话输入"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <FieldGroup>
            <Field>
              <ComposerInputCard
                ref={bindAnchor}
                className="conversation-input-card"
                dropActive={materialController.dropActive}
                dropDisabledReason={
                  materialsDisabled
                    ? (materialsDisabledReason ?? "当前服务尚未提供材料能力")
                    : undefined
                }
              >
                <PromptInput
                  key={`${sessionId}:${workspacePath}`}
                  inputRef={inputRef}
                  variant="hero"
                  ariaLabel="对话消息"
                  value={draft.text}
                  materials={draft.materials}
                  referenceIdentities={materialController.referenceIdentities}
                  onRetryReference={(id) => void materialController.retry(id)}
                  canRetryReference={(material) =>
                    materialController.canRetry(material.id)
                  }
                  retryLabelReference={(material) =>
                    materialController.retryLabel(material.id)
                  }
                  onRemoveReference={(id) =>
                    change(removeComposerMaterial(draft, id, workspacePath))
                  }
                  cwd={workspacePath}
                  onReferencesChanged={(text, ids, restored) =>
                    change({
                      text,
                      materials: [
                        ...draft.materials.filter(
                          (item) => !ids.includes(item.id)
                        ),
                        ...restored,
                      ],
                    })
                  }
                  onChange={(text) => change({ text })}
                  onSubmit={submit}
                />
                <SelectedMaterials
                  inlineReferences
                  materials={composerDisplayMaterials(
                    draft.materials,
                    draft.model,
                    data.modelInputs
                  )}
                  cwd={workspacePath}
                  onRetry={(id) => void materialController.retry(id)}
                  canRetry={(material) =>
                    !(
                      material.type === "image" &&
                      data.modelInputs &&
                      !data.modelInputs[draft.model]?.includes("image")
                    ) && materialController.canRetry(material.id)
                  }
                  retryLabel={(material) =>
                    materialController.retryLabel(material.id)
                  }
                  onRemove={(id) =>
                    change(removeComposerMaterial(draft, id, workspacePath))
                  }
                />
                <ComposerToolbar
                  sessionId={sessionId}
                  anchorRef={anchorRef}
                  data={data}
                  draft={draft}
                  workspacePath={workspacePath}
                  canSubmit={valid}
                  configurationDisabled={running || stopping || blocked}
                  configurationDisabledReason={configurationDisabledReason}
                  modelDisabled={running || stopping || blocked}
                  modelDisabledReason={configurationDisabledReason}
                  materialsDisabled={materialsDisabled}
                  materialsDisabledReason={materialsDisabledReason}
                  allowCompact
                  onChange={change}
                  onAddMaterial={(item) => {
                    void materialController.prepare(item)
                  }}
                  onChooseAttachments={
                    materialController.service
                      ? materialController.choose
                      : undefined
                  }
                  choosingMaterials={materialController.choosing}
                  sendControl={
                    <ConversationSendControl
                      allowQueue={allowQueue}
                      running={running}
                      stopping={stopping}
                      stopUnconfirmed={stopUnconfirmed}
                      hasDraft={eligibility.hasDraft}
                      command={
                        compactCommand
                          ? "compact"
                          : extensionCommand
                            ? "extension"
                            : undefined
                      }
                      delivery="followUp"
                      disabled={blocked || !valid}
                      disabledReason={sendDisabledReason}
                      onStop={onStop}
                    />
                  }
                />
              </ComposerInputCard>
            </Field>
          </FieldGroup>
        </form>
        {eligibility.hasDraft &&
          eligibility.reasonKind === "model" &&
          !running &&
          !stopping &&
          !blocked &&
          !compactCommand &&
          !["loading", "error"].includes(
            data.modelCatalog?.status ?? "ready"
          ) && (
            <NotificationToast
              tone="warning"
              trigger={draft.model}
              message={
                draft.model
                  ? "当前所选模型不可用，请在模型菜单中重新选择。"
                  : "尚未选择模型，请先在模型菜单中选择可用模型。"
              }
            />
          )}
        {materialFailure && (
          <OperationFeedback
            title={
              materialFailure.code === "cancelled"
                ? "材料核对已取消"
                : "材料未能添加"
            }
            message={materialFailure.message}
            details={materialFailure.details}
            severity={materialFailure.code === "cancelled" ? "info" : "error"}
            actions={
              materialFailure.code === "cancelled" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={materialController.recheck}
                >
                  重新检查材料
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={materialController.clearError}
                >
                  知道了
                </Button>
              )
            }
          />
        )}
        <ComposerAuxiliaryBar
          statistics={statistics}
          recovery={queueRecovery}
          context={context}
          modeIssue={modeIssue}
          onCheckMode={onCheckMode}
          modeChecking={modeChecking}
        />
      </div>
    </ComposerPanelProvider>
  )
}
