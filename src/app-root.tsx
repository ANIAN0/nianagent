import { Component, lazy, StrictMode, Suspense, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/theme-provider"
import { BreathingStartupSurface as StartupSurface } from "@/features/startup/breathing/startup-breathing"
import {
  loadStartupModule,
  startupExitAction,
} from "@/features/startup/startup-bootstrap"
import { isRemoteWeb } from "@/lib/rpc/remote-transport"

const startup =
  new URLSearchParams(window.location.search).get("moon-startup") === "1"
const loadWorkbench = () => import("./app-entry")
const remotePortModules = import.meta.glob<{
  registerRemoteAccessPorts: () => void
}>("../backend/plugins/remote-access/register-ports.ts")

async function loadRemoteEntry() {
  const bootstrap =
    remotePortModules["../backend/plugins/remote-access/register-ports.ts"]
  if (bootstrap) {
    const { registerRemoteAccessPorts } = await loadStartupModule(bootstrap())
    registerRemoteAccessPorts()
  }
  return loadStartupModule(import("@/features/startup/remote-entry"))
}

const Entry = lazy(() =>
  isRemoteWeb()
    ? loadRemoteEntry()
    : loadStartupModule(
        startup
          ? import("@/features/startup/startup-migration-app")
          : import("@/features/startup/boot-app")
      )
)
const loadingSteps = [
  { id: "interface", label: "加载启动界面", status: "active" as const },
]

/** 覆盖动态入口/Provider的真实渲染失败；原始异常仅属于宿主日志，不进入诊断。 */
class StartupEntryBoundary extends Component<
  { children: ReactNode },
  {
    failed: boolean
    exit: (() => Promise<void>) | null
    pending: boolean
    exitMessage: string | null
  }
> {
  state: {
    failed: boolean
    exit: (() => Promise<void>) | null
    pending: boolean
    exitMessage: string | null
  } = { failed: false, exit: null, pending: false, exitMessage: null }
  disposed = false
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    void startupExitAction()
      .then((exit) => {
        if (!this.disposed) this.setState({ exit })
      })
      .catch(() => {})
  }
  componentDidMount() {
    this.disposed = false
  }
  componentWillUnmount() {
    this.disposed = true
  }
  render() {
    if (this.state.failed)
      return (
        <StartupSurface
          status="failed"
          steps={[
            {
              id: "interface",
              label: "加载启动界面",
              status: "failed",
              detail: "工作台暂时无法显示，请重新加载。已保存的数据保留。",
            },
          ]}
          diagnostics={
            "Moon 启动诊断\n阶段：加载启动界面\n原因：界面资源未能加载或显示。"
          }
          retryLabel="重新加载"
          onRetry={() => window.location.reload()}
          pending={this.state.pending ? "exit" : null}
          onExit={
            this.state.exit
              ? () => {
                  if (this.state.pending || !this.state.exit) return
                  this.setState({ pending: true })
                  void this.state
                    .exit()
                    .catch(() => {
                      if (!this.disposed)
                        this.setState({
                          exitMessage:
                            "未能确认退出，请关闭此窗口后重新打开 Moon。",
                        })
                    })
                    .finally(() => {
                      if (!this.disposed) this.setState({ pending: false })
                    })
                }
              : undefined
          }
          exitInstruction={
            this.state.exitMessage ??
            (!this.state.exit
              ? "若仍无法加载，请关闭此窗口后重新打开 Moon。"
              : null)
          }
        />
      )
    return this.props.children
  }
}

export function mountApplication() {
  const entry = (
    <TooltipProvider>
      <Suspense
        fallback={<StartupSurface status="starting" steps={loadingSteps} />}
      >
        <Entry loadWorkbench={loadWorkbench} />
      </Suspense>
    </TooltipProvider>
  )
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <StartupEntryBoundary>
        {startup ? (
          <ThemeProvider storageKey={null}>{entry}</ThemeProvider>
        ) : (
          entry
        )}
      </StartupEntryBoundary>
    </StrictMode>
  )
}
