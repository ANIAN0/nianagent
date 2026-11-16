import { Archive, ArchiveRestore, Pencil, Pin, PinOff } from "lucide-react"
import { Fragment } from "react"
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import type { Conversation } from "@/lib/composer/types"

/** 行操作回调；由应用层提供实现，行内只负责呈现与转发。 */
export type ConversationRowActions = {
  onTogglePin: (conversation: Conversation) => void
  onRename: (conversation: Conversation) => void
  onArchive: (conversation: Conversation) => void
  onUnarchive: (conversation: Conversation) => void
}

type RowMenuSpec = {
  key: string
  label: string
  Icon: typeof Pin
  select: () => void
}

// 已归档行只提供恢复；活跃行按 置顶/重命名/归档 组织，与运行状态联动措辞。
function rowMenuSpecs(
  conversation: Conversation,
  actions: ConversationRowActions
): RowMenuSpec[] {
  if (conversation.archived)
    return [
      {
        key: "unarchive",
        label: "恢复会话",
        Icon: ArchiveRestore,
        select: () => actions.onUnarchive(conversation),
      },
    ]
  return [
    {
      key: "pin",
      label: conversation.pinned ? "取消置顶" : "置顶",
      Icon: conversation.pinned ? PinOff : Pin,
      select: () => actions.onTogglePin(conversation),
    },
    {
      key: "rename",
      label: "重命名",
      Icon: Pencil,
      select: () => actions.onRename(conversation),
    },
    {
      key: "archive",
      label: conversation.status === "running" ? "停止并归档" : "归档",
      Icon: Archive,
      select: () => actions.onArchive(conversation),
    },
  ]
}

export function ContextRowMenuItems({
  conversation,
  actions,
}: {
  conversation: Conversation
  actions: ConversationRowActions
}) {
  return rowMenuSpecs(conversation, actions).map((spec, index) => (
    <Fragment key={spec.key}>
      {index === 2 && <ContextMenuSeparator />}
      <ContextMenuItem onSelect={spec.select}>
        <spec.Icon />
        {spec.label}
      </ContextMenuItem>
    </Fragment>
  ))
}

export function DropdownRowMenuItems({
  conversation,
  actions,
}: {
  conversation: Conversation
  actions: ConversationRowActions
}) {
  return rowMenuSpecs(conversation, actions).map((spec, index) => (
    <Fragment key={spec.key}>
      {index === 2 && <DropdownMenuSeparator />}
      <DropdownMenuItem onSelect={spec.select}>
        <spec.Icon />
        {spec.label}
      </DropdownMenuItem>
    </Fragment>
  ))
}
