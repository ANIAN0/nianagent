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
import { ConversationHistory } from "./conversation-history"
import { UserMenu } from "./user-menu"
import type { ConversationRowActions } from "./conversation-row-menu"
import type { ComposerData, Conversation } from "@/lib/composer/types"
import type { HistoryState } from "@/lib/submission/conversation-handoff"

export type HomeSidebarProps = {
  data: Pick<ComposerData, "conversations" | "workspaces">
  activeConversationId?: string
  onSelectConversation?: (conversation: Conversation) => void
  collapsed?: boolean
  onClose: () => void
  onNew: (workspaceId?: string) => void
  onSearch: () => void
  onSettings?: () => void
  onPlugins?: () => void
  onNotice: (message: string) => void
  /** 当前主导航视图；导航行据此高亮。 */
  activeNav?: PrimaryNavigationActive
  /** 是否在提示文案中展示快捷键；移动抽屉不展示。 */
  shortcuts?: boolean
  actions?: ConversationRowActions
  archivedView?: boolean
  onLeaveArchivedView?: () => void
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
  onNotice,
  onSettings,
  onPlugins,
  activeNav,
  shortcuts = true,
  actions,
  archivedView,
  onLeaveArchivedView,
  historyState,
  historyError,
  historyIssue,
  onHistoryRetry,
}: HomeSidebarProps) {
  const searchHint = shortcuts ? `搜索会话 (${shortcutLabel("K")})` : "搜索会话"
  const toggleHint = shortcuts
    ? `${collapsed ? "展开侧栏" : "收起侧栏"} (${shortcutLabel("B")})`
    : collapsed
      ? "展开侧栏"
      : "收起侧栏"
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        collapsed ? "px-2.5 pt-[18px] pb-1.5" : "px-3 py-1.5"
      )}
    >
      <div
        className={cn(
          "mb-2 flex shrink-0 items-center justify-between",
          collapsed ? "h-auto flex-col gap-1" : "h-[60px]"
        )}
      >
        {collapsed ? (
          <>
            <HoverHint content={toggleHint} label="展开侧栏">
              <Button
                variant="ghost"
                size="icon-lg"
                className="group rounded-xl"
                aria-label="展开侧栏"
                aria-keyshortcuts={ariaKeyShortcuts("B")}
                onClick={onClose}
              >
                <PanelLeft className="size-[18px]" />
              </Button>
            </HoverHint>
            <HoverHint content={searchHint} label="搜索会话">
              <Button
                variant="ghost"
                size="icon-lg"
                className="rounded-xl"
                aria-label="搜索会话"
                aria-keyshortcuts={ariaKeyShortcuts("K")}
                onClick={onSearch}
              >
                <Search className="size-[18px]" />
              </Button>
            </HoverHint>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2">
              <span className="text-lg font-semibold">moon</span>
            </div>
            <div className="flex items-center gap-0.5">
              <HoverHint content={searchHint} label="搜索会话">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="搜索会话"
                  aria-keyshortcuts={ariaKeyShortcuts("K")}
                  onClick={onSearch}
                >
                  <Search className="size-4" />
                </Button>
              </HoverHint>
              <HoverHint content={toggleHint} label="收起侧栏">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="收起侧栏"
                  aria-keyshortcuts={ariaKeyShortcuts("B")}
                  onClick={onClose}
                >
                  <PanelLeft className="size-4" />
                </Button>
              </HoverHint>
            </div>
          </>
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
            historyState={historyState}
            historyError={historyError}
            historyIssue={historyIssue}
            onHistoryRetry={onHistoryRetry}
            activeConversationId={activeConversationId}
            onNew={onNew}
            actions={actions}
            archivedView={archivedView}
            onLeaveArchivedView={onLeaveArchivedView}
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
          />
        </div>
      )}
    </div>
  )
}
