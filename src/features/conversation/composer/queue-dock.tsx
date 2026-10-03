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
import { Badge } from "@/components/ui/badge"
import type { HomeDraft } from "@/features/home/home-types"
import { QueueDeliveryControl } from "./queue-delivery-control"

export type QueueDockProps = {
  items: { id: string; draft: HomeDraft; status?: "pending" | "dispatching" | "failed"; error?: string; delivery?: "followUp" | "steer" }[]
  running: boolean
  busy?: boolean
  deliveryMode?: "single" | "all"
  onDeliveryModeChange?: (mode: "single" | "all") => void | Promise<unknown>
  onEdit: (id: string, text: string) => void | Promise<unknown>
  onRemove: (id: string) => void
  onSendNow: (id: string) => void
}
export function QueueDock({
  items,
  running,
  busy = false,
  deliveryMode = "single",
  onDeliveryModeChange,
  onEdit,
  onRemove,
  onSendNow,
}: QueueDockProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )
  const [editError, setEditError] = useState("")
  const [saving, setSaving] = useState(false)
  const id = useId()
  if (!items.length) return null
  const activeEditing =
    editing && items.some((item) => item.id === editing.id) ? editing : null
  const expanded = !collapsed || !!activeEditing
  async function save() {
    if (!activeEditing || busy || saving) return
    const item = items.find((value) => value.id === activeEditing.id)
    if (!activeEditing.text.trim() && !item?.draft.materials.length) return
    setSaving(true); setEditError("")
    try { await onEdit(activeEditing.id, activeEditing.text.trim()); setEditing(null) }
    catch (error) { setEditError(error instanceof Error ? error.message : "消息未保存，请重试。") }
    finally { setSaving(false) }
  }
  return (
    <section className="conversation-queue" aria-label="排队消息">
      {onDeliveryModeChange && (
        <div className="conversation-queue-mode">
          <span>
            {running ? "当前工作结束后继续" : "已暂停，发送后继续处理"}
          </span>
          <QueueDeliveryControl mode={deliveryMode} disabled={busy} onChange={onDeliveryModeChange} />
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
                    disabled={busy || saving}
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
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      <X data-icon="inline-start" />
                      取消
                    </Button>
                    <Button
                      size="sm"
                    disabled={busy || saving || (!editing.text.trim() && !item.draft.materials.length)}
                      onClick={save}
                    >
                      <Check data-icon="inline-start" />
                      {saving ? "保存中" : "保存"}
                    </Button>
                  </div>
                  {editError && <p role="alert" className="text-destructive">{editError}</p>}
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
                  <span>{item.draft.text || "附件消息"}</span>
                  {(item.status === "dispatching" || item.delivery === "steer") && <small role="status">{item.status === "dispatching" ? "正在交付" : "等待补充边界"}</small>}
                  {item.error && <small role="alert" className="text-destructive">{item.error}</small>}
                  {item.draft.materials.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.draft.materials.map((material) => (
                        <Badge variant="outline" key={material.id}>
                          {material.name}
                        </Badge>
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
                    disabled={busy || item.status === "dispatching"}
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
    </section>
  )
}
