import { Plus, Puzzle, Clock3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
export type PrimaryNavigationProps = {
  collapsed?: boolean
  onNew: () => void
  onPlugins: () => void
  onScheduled: () => void
}
export function PrimaryNavigation({
  collapsed = false,
  onNew,
  onPlugins,
  onScheduled,
}: PrimaryNavigationProps) {
  return (
    <nav
      aria-label="主导航"
      className={cn("flex shrink-0 flex-col gap-1", !collapsed && "px-0.5")}
    >
      <Button
        variant="outline"
        className={cn(
          "mb-2 h-[38px] rounded-xl",
          collapsed ? "size-9 p-0" : "w-full"
        )}
        aria-label="新建会话"
        title="新建会话"
        onClick={onNew}
      >
        <Plus className={collapsed ? "size-[18px]" : "size-3.5"} />
        {!collapsed && "新建会话"}
      </Button>
      <Button
        variant="ghost"
        className={cn(
          "h-9 rounded-xl font-normal",
          collapsed ? "size-9 p-0" : "justify-start px-2"
        )}
        aria-label="插件"
        title="插件"
        onClick={onPlugins}
      >
        <Puzzle className={collapsed ? "size-[18px]" : "size-4"} />
        {!collapsed && "插件"}
      </Button>
      <Button
        variant="ghost"
        className={cn(
          "h-9 rounded-xl font-normal",
          collapsed ? "size-9 p-0" : "justify-start px-2"
        )}
        aria-label="定时任务"
        title="定时任务"
        onClick={onScheduled}
      >
        <Clock3 className={collapsed ? "size-[18px]" : "size-4"} />
        {!collapsed && "定时任务"}
      </Button>
    </nav>
  )
}
