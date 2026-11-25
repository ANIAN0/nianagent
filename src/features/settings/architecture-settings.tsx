import { Card, CardContent } from "@/components/ui/card"

const groups = [
  {
    title: "核心文件",
    root: "backend/",
    files: [
      ["rpc.mjs", "Moon 本机服务入口"],
      ["pi-sdk.mjs", "加载 Pi SDK"],
      ["pi-session-adapter.mjs", "创建 Agent 会话"],
      ["plugin-host.mjs", "装载插件、管理生命周期"],
    ],
  },
  {
    title: "内置插件",
    root: "backend/plugins/",
    files: [
      ["file-workbench/", "会话内的文件工作栏"],
      ["mcp-service/", "对外共享工具"],
      ["notes-workbench/", "笔记工具契约与转发插件"],
      ["skill-workbench/", "Skill 工具契约与转发插件"],
    ],
  },
  {
    title: "外置插件",
    root: "apps/workbench/",
    files: [
      ["src/app/notes/", "Next.js 笔记入口"],
      ["src/app/skills/", "Next.js Skill 入口"],
      ["src/app/api/", "工作台 HTTP 接口"],
      ["src/server/", "笔记与 Skill 业务及存储"],
      ["node_modules/", "项目依赖"],
    ],
  },
] as const

export function ArchitectureSettings() {
  return (
    <div className="settings-page">
      <div className="settings-page-inner">
        <header>
          <h2>应用解耦设计</h2>
          <p>Pi 提供会话与工具执行能力，Next.js 承载可单独启动的工作台。</p>
        </header>
        <Card>
          <CardContent>
            <figure aria-label="按职责分组的项目文件树">
              <figcaption className="mb-3 font-mono text-sm font-semibold">
                Moon /
              </figcaption>
              {groups.map(({ title, root, files }) => (
                <div
                  key={root}
                  className="grid grid-cols-[4em_12px_minmax(0,1fr)] items-center gap-x-2 border-t py-4 text-sm last:pb-0"
                >
                  <h3>{title}</h3>
                  <svg
                    aria-hidden="true"
                    className="h-full min-h-0 w-3 text-muted-foreground"
                    viewBox="0 0 12 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M11 1 Q7 1 7 6 V44 Q7 50 1 50 Q7 50 7 56 V94 Q7 99 11 99"
                      fill="none"
                      stroke="currentColor"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <div className="min-w-0">
                    <code className="font-semibold [overflow-wrap:anywhere]">
                      {root}
                    </code>
                    <ul>
                      {files.map(([file, purpose], index) => (
                        <li key={file} className="flex gap-1 py-0.5">
                          <span
                            aria-hidden="true"
                            className="font-mono text-muted-foreground"
                          >
                            {index === files.length - 1 ? "└─" : "├─"}
                          </span>
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                            <code className="[overflow-wrap:anywhere]">
                              {file}
                            </code>
                            <span className="text-xs text-muted-foreground">
                              {purpose}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </figure>
          </CardContent>
        </Card>
        <section className="settings-panel">
          <h3>哪些部分可以单独运行？</h3>
          <dl className="settings-facts">
            <dt>只运行核心</dt>
            <dd>
              停用两个工作台后，Moon 的 Node 服务仍可加载 Pi
              SDK、创建会话。桌面界面在 src/，由 src-tauri/ 启动本机服务。
            </dd>
            <dt>同时运行</dt>
            <dd>
              启用工作台时，内置插件负责启停和健康检查。笔记与 Skill 共用
              Next.js 源码，可分别运行服务进程。桌面开发模式下，笔记也支持由
              Moon 宿主直接托管。
            </dd>
            <dt>单独运行工作台</dt>
            <dd>
              在仓库内可用 <code>pnpm --filter @moon/workbench dev</code>{" "}
              单独启动默认笔记服务。工作台仍从 backend/plugins/
              加载业务实现，单独分发时也需要这些文件。
            </dd>
          </dl>
        </section>
      </div>
    </div>
  )
}
