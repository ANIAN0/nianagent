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
  onSelect,
  actions,
  activeConversationId,
}: ConversationGroupProps) {
  // 水位 = 默认行数、注意力行覆盖、用户抬升三者取大，上限封顶。
  const visible = Math.min(
    HISTORY_MAX_ROWS,
    Math.max(
      HISTORY_BASE_ROWS,
      attentionRowCount(conversations, activeConversationId),
      watermark
    )
  )
  const visibleItems = conversations.slice(0, visible)
  const hidden = conversations.length - visibleItems.length
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
          {hidden > 0 && (
            <Button
              variant="ghost"
              className="h-7 w-full justify-start rounded-lg pl-8 text-xs font-normal text-muted-foreground"
              onClick={() => onShowMore(visible + HISTORY_STEP_ROWS)}
            >
              <ChevronDown className="size-3.5" />
              显示更多（还有 {hidden} 个）
            </Button>
          )}
          {visible > HISTORY_BASE_ROWS && (
            <Button
              variant="ghost"
              className="h-7 w-full justify-start rounded-lg pl-8 text-xs font-normal text-muted-foreground"
              onClick={onShowLess}
            >
              <ChevronUp className="size-3.5" />
              收起
            </Button>
          )}
        </>
      )}
    </section>
  )
}
