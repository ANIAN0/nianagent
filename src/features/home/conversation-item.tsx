import { memo, useEffect, useRef } from "react"
import { MoreHorizontal, Pin } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextRowMenuItems,
  DropdownRowMenuItems,
  type ConversationRowActions,
} from "./conversation-row-menu"
import { MarqueeTitle } from "./marquee-title"
import type { Conversation } from "@/lib/composer/types"
import { cn } from "@/lib/utils"
import { ConversationStatusMark } from "./conversation-status-mark"

function ConversationItemBase({
  conversation,
  active = false,
  onSelect,
  actions,
}: {
  active?: boolean
  conversation: Conversation
  onSelect: (conversation: Conversation) => void
  actions?: ConversationRowActions
}) {
  // 经 ref 取最新回调，memo 比较器才能安全忽略回调身份。
  const select = useRef(onSelect)
  useEffect(() => {
    select.current = onSelect
  })
  const approvals = conversation.pending?.approvals ?? 0
  const answers = conversation.pending?.answers ?? 0
  const pendingLabel =
    approvals && answers
      ? "待处理"
      : approvals
        ? "待审批"
        : answers
          ? "待回答"
          : conversation.status === "waiting"
            ? "待回答"
            : ""
  return (
    <div className="group/item relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              "relative h-8 w-full justify-start rounded-lg pr-2 pl-8 text-sm font-normal data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
              actions &&
                "group-focus-within/item:pr-8 group-hover/item:pr-8 [@media(pointer:coarse)]:pr-8",
              conversation.archived && "opacity-60"
            )}
            aria-current={active ? "page" : undefined}
            aria-disabled={conversation.archived || undefined}
            data-active={active}
            data-conversation-id={conversation.id}
            onClick={() => {
              if (!conversation.archived) select.current(conversation)
            }}
          >
            <span className="absolute left-2.5 flex size-3 items-center justify-center">
              <ConversationStatusMark
                status={conversation.status ?? "idle"}
                unread={conversation.unread}
              />
            </span>
            <MarqueeTitle
              text={conversation.title}
              className="flex-1 text-left text-sm"
            />
            {conversation.pinned && !conversation.archived && (
              <Pin
                aria-hidden
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
            {pendingLabel ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {pendingLabel}
              </span>
            ) : (
              conversation.updatedLabel && (
                <time
                  dateTime={conversation.updatedAt}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {conversation.updatedLabel}
                </time>
              )
            )}
          </Button>
        </ContextMenuTrigger>
        {actions && (
          <ContextMenuContent>
            <ContextRowMenuItems
              conversation={conversation}
              actions={actions}
            />
          </ContextMenuContent>
        )}
      </ContextMenu>
      {actions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
              aria-label={`会话「${conversation.title}」操作`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-36">
            <DropdownRowMenuItems
              conversation={conversation}
              actions={actions}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// 持久化版本或待处理数量变化时，只重绘对应条目。
export const ConversationItem = memo(
  ConversationItemBase,
  (previous, next) =>
    previous.conversation === next.conversation &&
    previous.active === next.active &&
    previous.actions === next.actions
)
