import type { ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import "./settings.css"

export type SettingsSection = "models" | "mcp" | "storage" | "updates"
const groups = [
  {
    title: "模型与执行",
    sections: [
      { id: "models", label: "模型连接" },
      { id: "mcp", label: "MCP 服务" },
    ],
  },
  {
    title: "应用",
    sections: [
      { id: "storage", label: "数据与存储" },
      { id: "updates", label: "关于与更新" },
    ],
  },
] as const
/** 设置壳只负责导航与布局；编辑状态和离开守卫仍由原业务所有者持有。 */
export function SettingsShell({
  section,
  onSelect,
  onReturn,
  children,
}: {
  section: SettingsSection
  onSelect: (section: SettingsSection) => void
  onReturn: () => void
  children: ReactNode
}) {
  return (
    <section className="settings-workspace" aria-label="应用设置">
      <header className="settings-topbar">
        <h1>设置</h1>
        <Button variant="ghost" onClick={onReturn}>
          <ArrowLeft data-icon="inline-start" />
          返回工作台
        </Button>
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
