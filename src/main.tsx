import "./index.css"
import {
  createStartupBootstrap,
  loadStartupModule,
} from "./features/startup/startup-bootstrap"

// 入口不静态加载React；渲染器或其模块失败时，原生/浏览器仍有可见恢复页面。
const bootstrap = createStartupBootstrap()
const initial = (window as Window & {
  moonInitialBootState?: { deadline: number; failed: boolean }
}).moonInitialBootState
if (!initial?.failed) {
  void loadStartupModule(import("./app-root"), initial?.deadline)
    .then(({ mountApplication }) => {
      if (!initial?.failed && (!initial || Date.now() < initial.deadline)) mountApplication()
      else bootstrap.fail()
    })
    .catch(() => bootstrap.fail())
} else bootstrap.fail()
