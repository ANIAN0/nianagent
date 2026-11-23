import { HoverHint } from "@/components/feedback/hover-hint"
import { ConversationItem } from "./conversation-item"
import { ChevronDown, ChevronUp, FolderOpen, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  HISTORY_BASE_ROWS,
  HISTORY_MAX_ROWS,
  HISTORY_STEP_ROWS,
  attentionRowCount,
  conversationHasPending,
  conversationIsRunning,
} from "./conversation-history-layout"
import type { ConversationRowActions } from "./conversation-row-menu"
import type { Workspace, Conversation } from "@/lib/composer/types"
export type ConversationGroupProps = {
  workspace: Workspace
  conversations: Conversation[]
  expanded: boolean
  /** 用户经"显示更多"为本组抬升的水位；0 为默认。 */
  watermark: number
  activeConversationId?: string
  onNew?: (workspaceId: string) => void
  /** collapsing 为 true 表示本次点击要折叠该组。 */
  onToggle: (collapsing: boolean) => void
  /** value 已按上限钳制，父级原样持久化。 */
  onShowMore: (value: number) => void
  onShowLess: () => void
  onBrowse?: () => void
  onSelect: (conversation: Conversation) => void
  actions?: ConversationRowActions
}
export function ConversationGroup({
  workspace,
  conversations,
  expanded,
  watermark,
  onToggle,
  onNew,
  onShowMore,
  onShowLess,
  onBrowse,
  onSelect,
  actions,
  activeConversationId,
}: ConversationGroupProps) {
  const defaultVisible = Math.min(
    HISTORY_MAX_ROWS,
    Math.max(
      HISTORY_BASE_ROWS,
      attentionRowCount(conversations, activeConversationId)
    )
  )
  const visible = Math.max(
    defaultVisible,
    Math.min(HISTORY_MAX_ROWS, watermark)
  )
  const visibleItems = conversations.slice(0, visible)
  const hidden = conversations.length - visibleItems.length
  const groupStatus = expanded
    ? ""
    : conversations.some(conversationHasPending)
      ? "有待处理会话"
      : conversations.some(conversationIsRunning)
        ? "有运行中会话"
        : ""
  return (
    <section className="mb-2">
      <div className="group/directory flex items-center">
        <Button
          variant="section"
          className="h-8 min-w-0 flex-1 justify-start text-sm font-normal"
          aria-expanded={expanded}
          onClick={() => onToggle(expanded)}
        >
          <span className="relative size-4">
            <FolderOpen className="size-4 group-hover/directory:opacity-0" />
            <ChevronDown
              className={cn(
                "absolute inset-0 size-4 opacity-0 group-hover/directory:opacity-100",
                !expanded && "-rotate-90"
              )}
            />
          </span>
          <HoverHint
            content={workspace.path}
            onlyWhenTruncated="[data-group-name]"
          >
            <span data-group-name className="min-w-0 flex-1 truncate text-left">
              {workspace.name}
            </span>
          </HoverHint>
          {groupStatus && (
            <span
              role="img"
              aria-label={groupStatus}
              className={cn(
                "size-2 shrink-0 rounded-full",
                groupStatus === "有待处理会话"
                  ? "bg-status-warning"
                  : "bg-primary"
              )}
            />
          )}
        </Button>
        {onNew && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover/directory:opacity-100 focus-visible:opacity-100"
            aria-label={`在 ${workspace.name} 中新建会话`}
            onClick={() => onNew(workspace.id)}
          >
            <Plus />
          </Button>
        )}
      </div>
      {expanded && (
        <>
          <ul className="mt-1 flex flex-col">
            {visibleItems.map((item) => (
              <li key={item.id}>
                <ConversationItem
                  conversation={item}
                  active={item.id === activeConversationId}
                  onSelect={onSelect}
                  actions={actions}
                />
              </li>
            ))}
          </ul>
          {!visibleItems.length && (
            <p className="px-8 py-1 text-xs text-muted-foreground">暂无会话</p>
          )}
          {(() => {
            const hasMore = hidden > 0 && visible < HISTORY_MAX_ROWS
            const hasBrowse =
              hidden > 0 && visible === HISTORY_MAX_ROWS && !!onBrowse
            const canCollapse = visibleItems.length > defaultVisible
            if (!hasMore && !hasBrowse && !canCollapse) return null
            if (!hasMore && !hasBrowse) {
              return (
                <Button
                  variant="ghost"
                  className="relative h-7 w-full justify-start rounded-lg pr-2 pl-8 text-xs font-normal text-muted-foreground"
                  onClick={onShowLess}
                >
                  <ChevronUp className="absolute left-2.5 size-3.5" />
                  收起
                </Button>
              )
            }
            return (
              <div className="flex items-center gap-1">
                {hasMore ? (
                  <Button
                    variant="ghost"
                    className="relative h-7 min-w-0 flex-1 justify-start rounded-lg pr-2 pl-8 text-xs font-normal text-muted-foreground"
                    onClick={() =>
                      onShowMore(
                        Math.min(HISTORY_MAX_ROWS, visible + HISTORY_STEP_ROWS)
                      )
                    }
                  >
                    <ChevronDown className="absolute left-2.5 size-3.5" />
                    <span className="truncate">
                      显示更多（还有 {hidden} 个）
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    className="h-7 min-w-0 flex-1 justify-start rounded-lg pr-2 pl-8 text-xs font-normal text-muted-foreground"
                    onClick={onBrowse}
                  >
                    <span className="truncate">查看全部会话</span>
                  </Button>
                )}
                {canCollapse && (
                  <Button
                    variant="ghost"
                    className="h-7 shrink-0 rounded-lg px-2 text-xs font-normal text-muted-foreground"
                    onClick={onShowLess}
                  >
                    收起
                  </Button>
                )}
              </div>
            )
          })()}
        </>
      )}
    </section>
  )
}
