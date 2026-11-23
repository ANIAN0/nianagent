import { HoverHint } from "@/components/feedback/hover-hint"
import { Plus, Puzzle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ariaKeyShortcuts } from "@/lib/platform-shortcut"
export type PrimaryNavigationActive = "plugins"
export type PrimaryNavigationProps = {
  collapsed?: boolean
  active?: PrimaryNavigationActive
  onNew: () => void
  onPlugins: () => void
  management?: boolean
}
export function PrimaryNavigation({
  collapsed = false,
  active,
  onNew,
  onPlugins,
  management = true,
}: PrimaryNavigationProps) {
  return (
    <nav
      aria-label="主导航"
      className={cn("flex shrink-0 flex-col gap-1", !collapsed && "px-0.5")}
    >
      <HoverHint content={collapsed ? "新建会话" : undefined} label="新建会话">
        <Button
          variant="outline"
          className={cn(
            "mb-2 h-9 rounded-xl",
            collapsed ? "size-9 p-0" : "w-full justify-start px-2"
          )}
          aria-label="新建会话"
          aria-keyshortcuts={ariaKeyShortcuts("N")}
          onClick={onNew}
        >
          <Plus className="size-4" />
          {!collapsed && "新建会话"}
        </Button>
      </HoverHint>
      {management && (
        <HoverHint content={collapsed ? "插件" : undefined} label="插件">
          <Button
            variant="ghost"
            className={cn(
              "h-9 rounded-xl font-normal",
              collapsed ? "size-9 p-0" : "justify-start px-2",
              "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
            )}
            aria-label="插件"
            aria-current={active === "plugins" ? "page" : undefined}
            data-active={active === "plugins"}
            onClick={onPlugins}
          >
            <Puzzle className="size-4" />
            {!collapsed && "插件"}
          </Button>
        </HoverHint>
      )}
    </nav>
  )
}
