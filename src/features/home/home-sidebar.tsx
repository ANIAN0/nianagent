import { useMemo, useRef } from "react"
import { HoverHint } from "@/components/feedback/hover-hint"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { PanelLeft, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ariaKeyShortcuts, shortcutLabel } from "@/lib/platform-shortcut"
import {
  PrimaryNavigation,
  type PrimaryNavigationActive,
} from "./primary-navigation"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"
import {
  ConversationHistory,
  type ConversationHistoryPosition,
} from "./conversation-history"
import { UserMenu, type SidebarUpdateIndicator } from "./user-menu"
import type { ConversationRowActions } from "./conversation-row-menu"
import type {
  ComposerData,
  Conversation,
  Workspace,
} from "@/lib/composer/types"
import type { HistoryState } from "@/lib/submission/conversation-handoff"

export type HomeSidebarProps = {
  data: Pick<ComposerData, "conversations" | "workspaces">
  activeConversationId?: string
  onSelectConversation?: (conversation: Conversation) => void
  collapsed?: boolean
  onClose: () => void
  onNew: (workspaceId?: string) => void
  onSearch: () => void
  onSearchWorkspace?: (workspace: Workspace) => void
  onSettings?: () => void
  updateIndicator?: SidebarUpdateIndicator
  onPlugins?: () => void
  onNotice: (message: string) => void
  /** 当前主导航视图；导航行据此高亮。 */
  activeNav?: PrimaryNavigationActive
  /** 是否在提示文案中展示快捷键；移动抽屉不展示。 */
  shortcuts?: boolean
  actions?: ConversationRowActions
  historyState?: HistoryState
  historyError?: string
  historyIssue?: FeedbackDescription
  onHistoryRetry?: () => void
}
export function HomeSidebar({
  data,
  collapsed = false,
  activeConversationId,
  onSelectConversation,
  onClose,
  onNew,
  onSearch,
  onSearchWorkspace,
  onNotice,
  onSettings,
  updateIndicator,
  onPlugins,
  activeNav,
  shortcuts = true,
  actions,
  historyState,
  historyError,
  historyIssue,
  onHistoryRetry,
}: HomeSidebarProps) {
  const historyPosition = useRef<ConversationHistoryPosition>({ scrollTop: 0 })
  const historyPositionAccess = useMemo(
    () => ({
      read: () => historyPosition.current,
      update: (patch: Partial<ConversationHistoryPosition>) => {
        historyPosition.current = { ...historyPosition.current, ...patch }
      },
    }),
    []
  )

  const searchHint = shortcuts ? `搜索会话 (${shortcutLabel("K")})` : "搜索会话"
  const toggleLabel = collapsed ? "展开侧栏" : "收起侧栏"
  const searchButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-9 rounded-xl"
      aria-label="搜索会话"
      aria-keyshortcuts={shortcuts ? ariaKeyShortcuts("K") : undefined}
      onClick={onSearch}
    >
      <Search className="size-4" />
    </Button>
  )
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        collapsed ? "items-center px-2 py-1.5" : "px-3 py-1.5"
      )}
    >
      <div className="mb-1 flex w-full shrink-0 flex-col">
        <div
          className={cn(
            "flex h-[52px] items-center gap-2",
            !collapsed && "-ml-1"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl"
            aria-label={toggleLabel}
            aria-keyshortcuts={shortcuts ? ariaKeyShortcuts("B") : undefined}
            onClick={onClose}
          >
            <PanelLeft className="size-4" />
          </Button>
          {!collapsed && (
            <>
              <span className="flex-1 -translate-y-px text-lg leading-none font-semibold">
                moon
              </span>
              {searchButton}
            </>
          )}
        </div>
        {collapsed && (
          <HoverHint content={searchHint} label="搜索会话">
            {searchButton}
          </HoverHint>
        )}
      </div>
      <PrimaryNavigation
        management={!isRemoteWeb()}
        collapsed={collapsed}
        active={activeNav}
        onNew={() => onNew()}
        onPlugins={onPlugins ?? (() => onSettings?.())}
      />
      {collapsed ? null : (
        <>
          <ConversationHistory
            data={data}
            position={historyPositionAccess}
            historyState={historyState}
            historyError={historyError}
            historyIssue={historyIssue}
            onHistoryRetry={onHistoryRetry}
            activeConversationId={activeConversationId}
            onNew={onNew}
            actions={actions}
            onSearchWorkspace={onSearchWorkspace}
            onSelect={(item) =>
              onSelectConversation
                ? onSelectConversation(item)
                : onNotice(`选择会话：${item.title}`)
            }
          />
          {!isRemoteWeb() && (
            <div className="mt-2 shrink-0 border-t pt-2">
              <UserMenu
                onSettings={
                  onSettings ??
                  (() => onNotice("当前为独立组件预览，请从正式页面打开设置。"))
                }
                updateIndicator={updateIndicator}
              />
            </div>
          )}
        </>
      )}
      {collapsed && !isRemoteWeb() && (
        <div className="mt-auto pb-2">
          <UserMenu
            compact
            onSettings={
              onSettings ??
              (() => onNotice("当前为独立组件预览，请从正式页面打开设置。"))
            }
            updateIndicator={updateIndicator}
          />
        </div>
      )}
    </div>
  )
}
