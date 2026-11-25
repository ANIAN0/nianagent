import type { ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Conversation } from "@/lib/composer/types"
import "./settings.css"

export type SettingsSection =
  | "general"
  | "archived"
  | "models"
  | "mcp"
  | "storage"
  | "guidelines"
  | "architecture"
  | "updates"
const groups = [
  {
    title: "偏好",
    sections: [{ id: "general", label: "通用与外观" }],
  },
  {
    title: "模型与执行",
    sections: [
      { id: "models", label: "模型连接" },
      { id: "mcp", label: "入站 MCP 服务" },
    ],
  },
  {
    title: "应用",
    sections: [
      { id: "archived", label: "已归档会话" },
      { id: "storage", label: "数据与存储" },
      { id: "guidelines", label: "应用开发规范" },
      { id: "architecture", label: "应用解耦设计" },
      { id: "updates", label: "关于与更新" },
    ],
  },
] as const
/** 设置壳只负责导航与布局；编辑状态和离开守卫仍由原业务所有者持有。 */
export function SettingsShell({
  section,
  onSelect,
  onReturn,
  pendingConversations,
  onOpenConversation,
  children,
}: {
  section: SettingsSection
  onSelect: (section: SettingsSection) => void
  onReturn: () => void
  pendingConversations: Conversation[]
  onOpenConversation: (id: string) => void
  children: ReactNode
}) {
  return (
    <section className="settings-workspace" aria-label="应用设置">
      <header className="settings-topbar">
        <h1>设置</h1>
        <div className="flex min-w-0 flex-wrap justify-end gap-1">
          {pendingConversations.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  待处理会话（{pendingConversations.length}）
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-72 w-64 overflow-y-auto"
              >
                {pendingConversations.map(({ id, title, pending }) => (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() => onOpenConversation(id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {(pending?.approvals ?? 0) + (pending?.answers ?? 0)} 项
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="sm" onClick={onReturn}>
            <ArrowLeft data-icon="inline-start" />
            返回工作台
          </Button>
        </div>
      </header>
      <nav className="settings-nav" aria-label="设置分区">
        {groups.map((group) => (
          <div className="settings-nav-group" key={group.title}>
            <h2>{group.title}</h2>
            {group.sections.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                aria-current={section === item.id ? "page" : undefined}
                className="w-full justify-start"
                onClick={() => onSelect(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-content">{children}</div>
    </section>
  )
}
