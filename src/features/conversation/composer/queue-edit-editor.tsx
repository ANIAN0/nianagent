import { useComposerAnchor } from "@/lib/composer/use-composer-anchor"
import { useLayoutEffect, useRef, type KeyboardEvent } from "react"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { QueueActionHint } from "./queue-action-hint"
import {
  InputGroupAddon,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { ComposerInputCard } from "@/components/composer/composer-input-card"
import { useComposerKeyboard } from "@/components/composer/composer-keymap"
import { MaterialPicker } from "@/components/composer/material-picker"
import { SelectedMaterials } from "@/components/composer/selected-materials"
import type { ComposerDraft, Material } from "@/lib/composer/types"
import { useComposerMaterials } from "@/features/materials/use-composer-materials"
import {
  insertComposerText,
  removeComposerMaterial,
} from "@/features/materials/composer-material-edit"
import { OperationFeedback } from "@/components/feedback/operation-feedback"

export function QueueEditEditor({
  draft,
  sessionId,
  cwd,
  disabled,
  pending,
  canLeavePending = false,
  departed,
  onChange,
  onSave,
  onCancel,
  onRecover,
}: {
  draft: ComposerDraft
  sessionId: string
  cwd: string
  disabled: boolean
  pending: boolean
  canLeavePending?: boolean
  departed?: boolean
  onChange: (draft: ComposerDraft) => void
  onSave: () => void
  onCancel: () => void
  onRecover?: (text: string, materials: Material[]) => void
}) {
  const { anchorRef, anchorNode, bindAnchor } = useComposerAnchor()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const inline = !departed && draft.materials.length === 0
  useLayoutEffect(() => {
    const node = textRef.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`
  }, [draft.text, inline])
  const latest = useRef(draft)
  useLayoutEffect(() => {
    latest.current = draft
  }, [draft])
  const change = (patch: Partial<ComposerDraft>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onChange(next)
  }
  const controller = useComposerMaterials({
    sessionId,
    cwd,
    anchorNode,
    materials: draft.materials,
    disabled,
    update: (apply) => change({ materials: apply(latest.current.materials) }),
    onPasteText: (text, start, end) =>
      change({
        text: insertComposerText(latest.current.text, text, start, end),
      }),
  })
  const canSave =
    !disabled &&
    !pending &&
    controller.ready &&
    (!!draft.text.trim() || !!draft.materials.length)
  const keyboard = useComposerKeyboard(() => {
    if (canSave && !departed) onSave()
  })
  function cancelOnEscape(event: KeyboardEvent<HTMLTextAreaElement>) {
    const intent = keyboard.onKeyDown(event)
    if (intent === "composing") return
    if (
      event.key === "Escape" &&
      !event.nativeEvent.isComposing &&
      !event.defaultPrevented &&
      !disabled &&
      !pending
    ) {
      event.preventDefault()
      onCancel()
    }
  }
  if (inline)
    return (
      <div ref={bindAnchor} className="conversation-queue-inline-editor">
        <Textarea
          ref={textRef}
          autoFocus
          rows={1}
          aria-label="编辑排队消息"
          value={draft.text}
          disabled={disabled}
          onChange={(event) => change({ text: event.target.value })}
          {...keyboard}
          onKeyDown={cancelOnEscape}
        />
        {pending && (
          <span role="status" className="conversation-queue-status">
            正在保存
          </span>
        )}
        <div className="conversation-queue-actions">
          <QueueActionHint content="保存修改" disabled={!canSave}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="conversation-queue-action"
              aria-label="保存排队修改"
              disabled={!canSave}
              onClick={onSave}
            >
              <Check />
            </Button>
          </QueueActionHint>
          <QueueActionHint content="取消修改" disabled={disabled || pending}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="conversation-queue-action"
              aria-label="取消排队修改"
              disabled={disabled || pending}
              onClick={onCancel}
            >
              <X />
            </Button>
          </QueueActionHint>
        </div>
      </div>
    )
  return (
    <div className="conversation-queue-editor flex min-w-0 flex-col gap-2">
      <ComposerInputCard
        ref={bindAnchor}
        dropActive={controller.dropActive}
        dropDisabledReason={disabled ? "当前暂不能修改材料" : undefined}
      >
        <InputGroupTextarea
          autoFocus
          aria-label={departed ? "未保存的排队修改" : "编辑排队消息"}
          value={draft.text}
          disabled={disabled}
          className="min-h-12 px-3 pt-2 pb-0 text-[13px] leading-5 md:text-[13px]"
          onChange={(event) => change({ text: event.target.value })}
          {...keyboard}
          onKeyDown={cancelOnEscape}
        />
        <SelectedMaterials
          materials={draft.materials}
          cwd={cwd}
          onRemove={(id) => {
            if (!disabled) change(removeComposerMaterial(latest.current, id))
          }}
          onRetry={(id) => void controller.retry(id)}
          canRetry={(material) => !disabled && controller.canRetry(material.id)}
          retryLabel={(material) => controller.retryLabel(material.id)}
        />
        <InputGroupAddon align="block-end" className="gap-2 px-2 pt-1 pb-2">
          <MaterialPicker
            disabled={disabled}
            materials={[]}
            selected={draft.materials}
            anchorRef={anchorRef}
            sessionId={sessionId}
            workspacePath={cwd}
            onAdd={(material) => void controller.prepare(material)}
            onTextChange={(text) => change({ text })}
            onChooseAttachments={
              controller.service ? controller.choose : undefined
            }
            choosing={controller.choosing}
          />
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {controller.choosing ? "正在选择材料…" : "文字和材料一并保存"}
          </span>
        </InputGroupAddon>
      </ComposerInputCard>
      {controller.feedback && (
        <OperationFeedback title="材料需要处理" {...controller.feedback} />
      )}
      <div className="sticky bottom-0 flex justify-end gap-1 bg-card py-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={(disabled || pending) && !canLeavePending}
          onClick={onCancel}
        >
          <X data-icon="inline-start" />
          {departed ? "放弃修改" : "取消"}
        </Button>
        {departed ? (
          onRecover && (
            <Button
              size="sm"
              disabled={!canSave && !canLeavePending}
              onClick={() => onRecover(draft.text, draft.materials)}
            >
              保留到输入框
            </Button>
          )
        ) : (
          <Button size="sm" disabled={!canSave} onClick={onSave}>
            <Check data-icon="inline-start" />
            {pending ? "等待确认" : "保存"}
          </Button>
        )}
      </div>
    </div>
  )
}
