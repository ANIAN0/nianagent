import { lazy, Suspense, useState, type ReactNode } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
  FolderTree,
  PanelsTopLeft,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { OperationFeedback } from "@/components/feedback/operation-feedback"
import "./developer-tools-settings.css"

const PluginDevelopmentPage = lazy(() =>
  import("@/features/plugin-development/plugin-development-page").then(
    (module) => ({ default: module.PluginDevelopmentPage })
  )
)

const tools = [
  {
    id: "project",
    path: "/project/",
    title: "项目结构",
    icon: FolderTree,
    description: "按职责模块和目录理解项目，定位逐文件用途与关联实现。",
  },
  {
    id: "components",
    path: "/ui-catalog/",
    title: "页面与组件",
    icon: PanelsTopLeft,
    description: "查看完整页面、业务模块、交互场景和共享组件规则。",
  },
  {
    id: "api",
    path: "/api-catalog/",
    title: "接口查询",
    icon: Braces,
    description: "按功能模块查阅真实接口、输入、输出与使用依据。",
  },
] as const

function DeveloperToolEntry({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <li className="developer-tool-entry">
      <span className="developer-tool-icon" aria-hidden="true">
        <Icon />
      </span>
      <div className="developer-tool-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </li>
  )
}

export function DeveloperToolsSettings() {
  const [error, setError] = useState("")
  const [reading, setReading] = useState(false)
  async function open(tool: string) {
    setError("")
    try {
      await invoke("open_developer_tools", { tool })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (reading)
    return (
      <Suspense
        fallback={
          <div className="settings-page" role="status">
            正在加载插件规范…
          </div>
        }
      >
        <PluginDevelopmentPage onReturn={() => setReading(false)} />
      </Suspense>
    )
  return (
    <div className="settings-page developer-tools-settings">
      <section className="settings-page-inner">
        <header>
          <h2>开发工具</h2>
          <p className="mt-1">
            {import.meta.env.DEV
              ? "查阅插件开发规范，以及项目结构、页面组件和接口资料。"
              : "查阅插件开发规范与接入边界。"}
          </p>
        </header>
        <ul className="developer-tool-list" aria-label="插件开发规范">
          <DeveloperToolEntry
            icon={BookOpen}
            title="插件开发"
            description="了解核心边界、允许的入口、结果展示和文件归属。正式版也可离线阅读。"
          >
            <Button
              variant="outline"
              className="developer-tool-action"
              aria-label="查看插件开发规范"
              onClick={() => setReading(true)}
            >
              查看规范
              <ArrowRight data-icon="inline-end" />
            </Button>
          </DeveloperToolEntry>
        </ul>
        {import.meta.env.DEV && (
          <section className="developer-tool-group" aria-label="开发参考">
            <div className="developer-tool-group-label">
              <span>开发参考</span>
              <Badge variant="outline">仅开发模式</Badge>
            </div>
            <ul className="developer-tool-list">
              {tools.map((tool) => (
                <DeveloperToolEntry
                  key={tool.id}
                  icon={tool.icon}
                  title={tool.title}
                  description={tool.description}
                >
                  {isTauri() ? (
                    <Button
                      variant="outline"
                      className="developer-tool-action"
                      aria-label={`打开${tool.title}网页`}
                      onClick={() => void open(tool.id)}
                    >
                      打开网页
                      <ArrowUpRight data-icon="inline-end" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="developer-tool-action"
                      asChild
                    >
                      <a
                        href={tool.path}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`打开${tool.title}网页`}
                      >
                        打开网页
                        <ArrowUpRight data-icon="inline-end" />
                      </a>
                    </Button>
                  )}
                </DeveloperToolEntry>
              ))}
            </ul>
          </section>
        )}
        {error && (
          <OperationFeedback
            title="无法打开开发工具"
            message={error}
            notify={false}
          />
        )}
      </section>
    </div>
  )
}
