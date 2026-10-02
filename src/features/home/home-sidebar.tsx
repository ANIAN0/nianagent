import { useState } from "react"
import {
  ChevronDown,
  Clock3,
  Folder,
  PanelLeftClose,
  Plus,
  Puzzle,
  Search,
  Settings2,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/theme-provider"
import { conversations, workspaces } from "./mock-data"

type Props = {
  onClose: () => void
  onNew: () => void
  onNotice: (message: string) => void
}
export function HomeSidebar({ onClose, onNew, onNotice }: Props) {
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<string[]>([])
  const { setTheme } = useTheme()
  const matches = conversations.filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <img src="/moon.png" alt="" className="size-7 rounded-lg" />
          <span className="text-lg font-semibold tracking-tight">Moon</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="收起侧栏"
          onClick={onClose}
        >
          <PanelLeftClose />
        </Button>
      </div>
      <nav aria-label="主导航" className="flex flex-col gap-1 px-3">
        <Button variant="secondary" className="justify-start" onClick={onNew}>
          <Plus data-icon="inline-start" />
          新建会话
        </Button>
        <Button
          variant="ghost"
          className="justify-start"
          onClick={() => onNotice("插件页面尚未实现，本次仅展示首页。")}
        >
          <Puzzle data-icon="inline-start" />
          插件
        </Button>
        <Button
          variant="ghost"
          className="justify-start"
          onClick={() => onNotice("定时任务页面尚未实现，本次仅展示首页。")}
        >
          <Clock3 data-icon="inline-start" />
          定时任务
        </Button>
      </nav>
      <div className="px-3 pt-6 pb-4">
        <InputGroup className="bg-background/60">
          <InputGroupInput
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      </div>
      <nav
        aria-label="历史会话"
        className="min-h-0 flex-1 overflow-y-auto px-3"
      >
        <p className="mb-3 px-2 text-xs text-muted-foreground">最近会话</p>
        {workspaces.map((workspace) => {
          const items = matches.filter(
            (item) => item.workspaceId === workspace.id
          )
          if (!items.length) return null
          const expanded = !!query.trim() || !collapsed.includes(workspace.id)
          return (
            <section key={workspace.id} className="mb-5">
              <Button
                variant="ghost"
                className="w-full justify-start text-muted-foreground"
                aria-expanded={expanded}
                onClick={() =>
                  setCollapsed((current) =>
                    current.includes(workspace.id)
                      ? current.filter((id) => id !== workspace.id)
                      : [...current, workspace.id]
                  )
                }
              >
                <Folder data-icon="inline-start" />
                <span className="flex-1 text-left">{workspace.name}</span>
                <ChevronDown className={expanded ? "" : "-rotate-90"} />
              </Button>
              {expanded && (
                <ul className="mt-1 flex flex-col gap-1">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Button
                        variant="ghost"
                        className="h-auto w-full justify-start py-2 pl-8 font-normal"
                        title={item.title}
                        onClick={() =>
                          onNotice(
                            `“${item.title}”是模拟历史记录，对话页面尚未实现。`
                          )
                        }
                      >
                        <span className="truncate">{item.title}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        {!matches.length && (
          <p className="px-2 py-6 text-sm text-muted-foreground">
            没有找到匹配的会话
          </p>
        )}
      </nav>
      <div className="border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-12 w-full justify-start">
              <UserRound data-icon="inline-start" />
              <span className="flex-1 text-left">本地用户</span>
              <Settings2 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>本地工作空间</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => onNotice("设置页面尚未实现；可在此切换外观。")}
              >
                设置
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {(
                [
                  ["light", "浅色外观"],
                  ["dark", "深色外观"],
                  ["system", "跟随系统"],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
