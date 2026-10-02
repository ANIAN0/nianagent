import { PanelLeft, Search, FolderOpen, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PrimaryNavigation } from "./primary-navigation"
import { ConversationHistory } from "./conversation-history"
import { UserMenu } from "./user-menu"
import type { HomeData, Conversation } from "./home-types"

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
          <Button
            variant="ghost"
            size="icon-lg"
            className="group rounded-xl"
            aria-label="展开侧栏"
            title="展开侧栏 (Ctrl+B)"
            onClick={onClose}
          >
            <PanelLeft className="size-[18px]" />
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2 px-2">
              <span className="text-lg font-semibold">moon</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="收起侧栏"
              title="收起侧栏 (Ctrl+B)"
              onClick={onClose}
            >
              <PanelLeft className="size-4" />
            </Button>
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
          <Button
            variant="ghost"
            size="icon-lg"
            className="rounded-xl"
            aria-label="展开工作区"
            title="工作区"
            onClick={onClose}
          >
            <FolderOpen />
          </Button>
          <Button
            variant="ghost"
            size="icon-lg"
            className="rounded-xl"
            aria-label="搜索会话"
            title="搜索会话 (Ctrl+K)"
            onClick={onSearch}
          >
            <Search className={collapsed ? "size-[18px]" : "size-3.5"} />
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex h-8 shrink-0 items-center justify-between px-2">
            <h2 className="text-xs text-muted-foreground">工作区</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="搜索会话"
              title="搜索会话 (Ctrl+K)"
              onClick={onSearch}
            >
              <Search className={collapsed ? "size-[18px]" : "size-3.5"} />
            </Button>
          </div>
          <ConversationHistory
            data={data}
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
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="设置"
            title="设置"
            onClick={onSettings}
          >
            <Settings />
          </Button>
        </div>
      )}
    </div>
  )
}
