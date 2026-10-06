import { HoverHint } from "@/components/feedback/hover-hint"
import type { FeedbackDescription } from "@/lib/operation-issue"
import { PanelLeft, Search, FolderOpen, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PrimaryNavigation } from "./primary-navigation"
import { ConversationHistory } from "./conversation-history"
import { UserMenu } from "./user-menu"
import type { HomeData, Conversation } from "./home-types"
import type { HistoryState } from "@/features/conversation/conversation-catalog-service"

export type HomeSidebarProps = {
  data: Pick<HomeData, "conversations" | "workspaces">
  activeConversationId?: string
  onSelectConversation?: (conversation: Conversation) => void
  collapsed?: boolean
  onClose: () => void
  onNew: (workspaceId?: string) => void
  onSearch: () => void
  onSettings?: () => void
  onNotice: (message: string) => void
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
  historyState,
  historyError,
  historyIssue,
  onHistoryRetry,
}: HomeSidebarProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col bg-sidebar text-sidebar-foreground",
        collapsed ? "px-2.5 pt-[18px] pb-1.5" : "px-3 py-1.5"
      )}
    >
      <div
        className={cn(
          "mb-2 flex shrink-0 items-center justify-between",
          collapsed ? "h-9" : "h-[60px]"
        )}
      >
        {collapsed ? (
          <HoverHint content="展开侧栏 (Ctrl+B)" label="展开侧栏">
            <Button
              variant="ghost"
              size="icon-lg"
              className="group rounded-xl"
              aria-label="展开侧栏"

              onClick={onClose}
            >
              <PanelLeft className="size-[18px]" />
            </Button>
          </HoverHint>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2">
              <span className="text-lg font-semibold">moon</span>
            </div>
            <HoverHint content="收起侧栏 (Ctrl+B)" label="收起侧栏">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-full"
                aria-label="收起侧栏"

                onClick={onClose}
              >
                <PanelLeft className="size-4" />
              </Button>
            </HoverHint>
          </>
        )}
      </div>
      <PrimaryNavigation
        collapsed={collapsed}
        onNew={() => onNew()}
        onPlugins={() => onNotice("插件页面尚未实现，本次实现首页与对话。")}
        onScheduled={() =>
          onNotice("定时任务页面尚未实现，本次实现首页与对话。")
        }
      />
      {collapsed ? (
        <div className="mt-3 flex flex-col gap-1">
          <HoverHint content="工作区" label="展开工作区">
            <Button
              variant="ghost"
              size="icon-lg"
              className="rounded-xl"
              aria-label="展开工作区"

              onClick={onClose}
            >
              <FolderOpen />
            </Button>
          </HoverHint>
          <HoverHint content="搜索会话 (Ctrl+K)" label="搜索会话">
            <Button
              variant="ghost"
              size="icon-lg"
              className="rounded-xl"
              aria-label="搜索会话"

              onClick={onSearch}
            >
              <Search className={collapsed ? "size-[18px]" : "size-3.5"} />
            </Button>
          </HoverHint>
        </div>
      ) : (
        <>
          <div className="mt-3 flex h-8 shrink-0 items-center justify-between px-2">
            <h2 className="text-xs text-muted-foreground">工作区</h2>
            <HoverHint content="搜索会话 (Ctrl+K)" label="搜索会话">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="搜索会话"

                onClick={onSearch}
              >
                <Search className={collapsed ? "size-[18px]" : "size-3.5"} />
              </Button>
            </HoverHint>
          </div>
          <ConversationHistory
            data={data}
            historyState={historyState}
            historyError={historyError}
            historyIssue={historyIssue}
            onHistoryRetry={onHistoryRetry}
            activeConversationId={activeConversationId}
            onNew={onNew}
            onSelect={(item) =>
              onSelectConversation
                ? onSelectConversation(item)
                : onNotice(`选择会话：${item.title}`)
            }
          />
          <div className="mt-2 shrink-0 border-t pt-2">
            <UserMenu
              onSettings={
                onSettings ??
                (() => onNotice("当前为独立组件预览，请从正式页面打开设置。"))
              }
            />
          </div>
        </>
      )}
      {collapsed && onSettings && (
        <div className="mt-auto pb-2">
          <HoverHint content="设置" label="设置">
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="设置"

              onClick={onSettings}
            >
              <Settings />
            </Button>
          </HoverHint>
        </div>
      )}
    </div>
  )
}
