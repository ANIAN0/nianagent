import "./index.css"
import { markStartup } from "./features/startup/boot-epoch"
import {
  createStartupBootstrap,
  loadStartupModule,
} from "./features/startup/startup-bootstrap"

markStartup("main")

if (import.meta.env.DEV) {
  void import("./lib/telemetry/frontend-perf").then(
    ({ startFrontendPerfTelemetry }) => {
      startFrontendPerfTelemetry()
    }
  )
}

// 入口不静态加载React；渲染器或其模块失败时，原生/浏览器仍有可见恢复页面。
const bootstrap = createStartupBootstrap()
const initial = (
  window as Window & {
    moonInitialBootState?: { deadline: number; failed: boolean }
  }
).moonInitialBootState
if (!initial?.failed) {
  markStartup("loadAppRoot")
  void loadStartupModule(import("./app-root"), initial?.deadline)
    .then(({ mountApplication }) => {
      markStartup("appRootLoaded")
      if (!initial?.failed && (!initial || Date.now() < initial.deadline)) {
        mountApplication()
      } else bootstrap.fail()
    })
    .catch(() => bootstrap.fail())
} else bootstrap.fail()
