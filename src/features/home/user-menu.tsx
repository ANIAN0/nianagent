import {
  ChevronUp,
  Download,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  Sun,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"

export type SidebarUpdateIndicator = {
  phase: "ready" | "available"
  version: string
  onAction: () => void
}

export function UserMenu({
  onSettings,
  updateIndicator,
  compact = false,
}: {
  onSettings: () => void
  updateIndicator?: SidebarUpdateIndicator
  compact?: boolean
}) {
  const { theme, setTheme } = useTheme()
  const updateReady = updateIndicator?.phase === "ready"
  const updateAvailable = updateIndicator?.phase === "available"
  const hasUpdateDot = Boolean(updateIndicator)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={
            compact
              ? "relative size-9 rounded-xl p-0"
              : "h-10 w-full justify-start gap-2.5 rounded-xl px-2.5"
          }
          aria-label="设置与外观"
        >
          <Settings className="size-4 shrink-0 text-muted-foreground" />
          {compact && hasUpdateDot && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
            />
          )}
          {!compact && (
            <>
              <span className="flex-1 text-left text-[13px] font-medium">
                设置与外观
              </span>
              {hasUpdateDot && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                />
              )}
              <ChevronUp className="size-3.5 text-muted-foreground" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56 rounded-xl p-1.5"
      >
        <DropdownMenuGroup>
          {updateReady && updateIndicator && (
            <DropdownMenuItem
              className="h-9 gap-2 px-2 text-primary focus:text-primary"
              onSelect={updateIndicator.onAction}
            >
              <RefreshCw className="size-4" />
              <span className="truncate">
                重启以更新 ({updateIndicator.version})
              </span>
            </DropdownMenuItem>
          )}
          {updateAvailable && updateIndicator && (
            <DropdownMenuItem
              className="h-9 gap-2 px-2"
              onSelect={updateIndicator.onAction}
            >
              <Download className="size-4 text-primary" />
              <span className="truncate">
                发现新版本 ({updateIndicator.version})
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="h-9 gap-2 px-2" onSelect={onSettings}>
            <Settings className="size-4" />
            设置
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>主题</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) =>
            setTheme(value as "light" | "dark" | "system")
          }
        >
          {(
            [
              ["light", "浅色", Sun],
              ["dark", "深色", Moon],
              ["system", "跟随系统", Monitor],
            ] as const
          ).map(([value, label, Icon]) => (
            <DropdownMenuRadioItem
              className="h-9 gap-2 px-2"
              key={value}
              value={value}
            >
              <Icon className="size-4" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
