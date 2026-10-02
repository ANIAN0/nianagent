import "./composer.css"
import { useId, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import type { HomeDraft } from "@/features/home/home-types"

export type QueueDockProps = {
  items: { id: string; draft: HomeDraft }[]
  running: boolean
  busy?: boolean
  deliveryMode?: "single" | "all"
  onDeliveryModeChange?: (mode: "single" | "all") => void
  onEdit: (id: string, text: string) => void
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
  const [modeChanged, setModeChanged] = useState(false)
  const id = useId()
  if (!items.length) return null
  const activeEditing =
    editing && items.some((item) => item.id === editing.id) ? editing : null
  const expanded = !collapsed || !!activeEditing
  function save() {
    if (activeEditing && activeEditing.text.trim() && !busy) {
      onEdit(activeEditing.id, activeEditing.text.trim())
      setEditing(null)
    }
  }
  return (
    <section className="conversation-queue" aria-label="排队消息">
      {onDeliveryModeChange && (
        <div className="conversation-queue-mode">
          <span>
            {running ? "当前工作结束后继续" : "已暂停，发送后继续处理"}
          </span>
          {modeChanged && <span role="status">下次交付生效</span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="xs" disabled={busy}>
                <ClipboardList data-icon="inline-start" />
                {deliveryMode === "single" ? "逐条交付" : "全部交付"}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>交付模式（排队消息）</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={deliveryMode}
                onValueChange={(value) => {
                  onDeliveryModeChange(value as "single" | "all")
                  setModeChanged(true)
                }}
              >
                <DropdownMenuRadioItem value="single">
                  逐条交付
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all">
                  全部交付
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
                    disabled={busy}
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
                      disabled={busy || !editing.text.trim()}
                      onClick={save}
                    >
                      <Check data-icon="inline-start" />
                      保存
                    </Button>
                  </div>
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
                    disabled={busy}
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
                    disabled={busy}
                    onClick={() => onSendNow(item.id)}
                  >
                    <Send />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除排队消息"
                    title="删除"
                    disabled={busy}
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
