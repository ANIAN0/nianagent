import "./composer.css"
import { useId, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  ListOrdered,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import type { HomeDraft, Material } from "@/features/home/home-types"
import { MaterialPreviewDialog } from "@/features/materials/material-preview"
import { QueueDeliveryControl } from "./queue-delivery-control"

export type QueueDockProps = {
  items: {
    id: string
    draft: HomeDraft
    status?: "pending" | "dispatching" | "failed"
    error?: string
    delivery?: "followUp" | "steer"
  }[]
  running: boolean
  paused?: boolean
  cwd?: string
  busy?: boolean
  deliveryMode?: "single" | "all"
  onDeliveryModeChange?: (mode: "single" | "all") => void | Promise<unknown>
  onEdit: (id: string, text: string) => void | Promise<unknown>
  onRemove: (id: string) => void
  onSendNow: (id: string) => void
  onRecoverEdit?: (text: string) => void
}
export function QueueDock({
  items,
  running,
  paused = false,
  cwd = "",
  busy = false,
  deliveryMode = "single",
  onDeliveryModeChange,
  onEdit,
  onRemove,
  onSendNow,
  onRecoverEdit,
}: QueueDockProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )
  const [editError, setEditError] = useState("")
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<Material | null>(null)
  const id = useId()
  if (!items.length && !editing && !preview) return null
  const activeEditing =
    editing && items.some((item) => item.id === editing.id) ? editing : null
  const expanded = !collapsed || !!activeEditing
  const editingItem = items.find((item) => item.id === editing?.id)
  const editBlocked = busy || saving || editingItem?.status === "dispatching"
  async function save() {
    if (!activeEditing || editBlocked) return
    const submitted = activeEditing
    const item = items.find((value) => value.id === activeEditing.id)
    if (!activeEditing.text.trim() && !item?.draft.materials.length) return
    setSaving(true)
    setEditError("")
    try {
      await onEdit(activeEditing.id, activeEditing.text.trim())
      setEditing((current) =>
        current?.id === submitted.id && current.text === submitted.text
          ? null
          : current
      )
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "消息未保存，请重试。"
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="conversation-queue" aria-label="排队消息">
      {editing && !activeEditing && (
        <FieldGroup className="conversation-queue-edit">
          <Field>
            <p role="status" className="text-xs text-muted-foreground">
              原消息已离开待处理列表，未保存的修改保留在这里。
            </p>
            <Textarea
              autoFocus
              aria-label="未保存的排队修改"
              value={editing.text}
              disabled={saving}
              onChange={(event) =>
                setEditing({ id: editing.id, text: event.target.value })
              }
            />
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                放弃修改
              </Button>
              {onRecoverEdit && (
                <Button
                  size="sm"
                  disabled={busy || saving || !editing.text.trim()}
                  onClick={() => {
                    onRecoverEdit(editing.text)
                    setEditing(null)
                  }}
                >
                  放到输入框
                </Button>
              )}
            </div>
          </Field>
        </FieldGroup>
      )}
      {onDeliveryModeChange && (
        <div className="conversation-queue-mode">
          <span>
            {paused || !running
              ? "已暂停，发送后继续处理"
              : "当前工作结束后继续"}
          </span>
          <QueueDeliveryControl
            mode={deliveryMode}
            disabled={busy}
            onChange={onDeliveryModeChange}
          />
        </div>
      )}
      {items.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          className="conversation-queue-heading"
          disabled={!!activeEditing || busy}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ListOrdered data-icon="inline-start" />
          <span>{items.length} 条排队消息</span>
          {expanded ? (
            <ChevronDown data-icon="inline-end" />
          ) : (
            <ChevronUp data-icon="inline-end" />
          )}
        </Button>
      )}
      <ul
        id={id}
        className="conversation-queue-list"
        hidden={items.length > 1 && !expanded}
      >
        {items.map((item) => (
          <li key={item.id}>
            {editing?.id === item.id ? (
              <FieldGroup className="conversation-queue-edit">
                <Field>
                  <Textarea
                    autoFocus
                    aria-label="编辑排队消息"
                    value={editing.text}
                    disabled={editBlocked}
                    onChange={(event) =>
                      setEditing({ id: item.id, text: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      )
                        return
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setEditing(null)
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        save()
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || saving}
                      onClick={() => setEditing(null)}
                    >
                      <X data-icon="inline-start" />
                      取消
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        editBlocked ||
                        (!editing.text.trim() && !item.draft.materials.length)
                      }
                      onClick={save}
                    >
                      <Check data-icon="inline-start" />
                      {saving ? "保存中" : "保存"}
                    </Button>
                  </div>
                  {editError && (
                    <p role="alert" className="text-destructive">
                      {editError}
                    </p>
                  )}
                  {item.status === "dispatching" && (
                    <p role="status" className="text-xs text-muted-foreground">
                      原消息正在交付，不能再修改；未保存的文字会保留。
                    </p>
                  )}
                </Field>
              </FieldGroup>
            ) : (
              <>
                {items.length === 1 && (
                  <ListOrdered
                    className="conversation-queue-icon"
                    aria-hidden="true"
                  />
                )}
                <div className="conversation-queue-text">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-auto w-full min-w-0 justify-start p-0 text-left font-normal"
                        aria-label="查看排队消息全文"
                      >
                        <span className="truncate">
                          {item.draft.text || "附件消息"}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      className="w-96 max-w-[calc(100vw-32px)]"
                      aria-label="排队消息全文"
                    >
                      <p className="moon-scrollbar max-h-52 overflow-auto text-sm leading-6 break-words whitespace-pre-wrap">
                        {item.draft.text || "此消息只有附件。"}
                      </p>
                    </PopoverContent>
                  </Popover>
                  {(item.status === "dispatching" ||
                    item.delivery === "steer") && (
                    <small role="status">
                      {item.status === "dispatching"
                        ? "正在交付"
                        : "等待补充边界"}
                    </small>
                  )}
                  {item.error && (
                    <small role="alert" className="text-destructive">
                      {item.error}
                    </small>
                  )}
                  {item.draft.materials.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.draft.materials.map((material) => (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 max-w-full text-xs"
                          key={material.id}
                          onClick={() => setPreview(material)}
                        >
                          {material.name}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="编辑排队消息"
                    title="编辑"
                    disabled={
                      busy || !!editing || item.status === "dispatching"
                    }
                    onClick={() =>
                      setEditing({ id: item.id, text: item.draft.text })
                    }
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={running ? "立即发送" : "发送此消息"}
                    title={
                      running
                        ? "立即发送，补充当前工作"
                        : "发送此消息，继续处理"
                    }
                    disabled={busy || item.status === "dispatching"}
                    onClick={() => onSendNow(item.id)}
                  >
                    <Send />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除排队消息"
                    title="删除"
                    disabled={busy || item.status === "dispatching"}
                    onClick={() => onRemove(item.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <MaterialPreviewDialog
        material={preview}
        cwd={cwd}
        onClose={() => setPreview(null)}
      />
    </section>
  )
}
