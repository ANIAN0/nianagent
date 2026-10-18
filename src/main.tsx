import "./index.css"
import {
  createStartupBootstrap,
  loadStartupModule,
} from "./features/startup/startup-bootstrap"

// 入口不静态加载React；渲染器或其模块失败时，原生/浏览器仍有可见恢复页面。
const bootstrap = createStartupBootstrap()
const initial = (
  window as Window & {
    moonInitialBootState?: { deadline: number; failed: boolean }
  }
).moonInitialBootState
if (!initial?.failed) {
  void loadStartupModule(import("./app-root"), initial?.deadline)
    .then(({ mountApplication }) => {
      if (!initial?.failed && (!initial || Date.now() < initial.deadline)) {
        // 入口加载成功，清除静默重载标记，恢复下次失败的一次自动重载额度。
        try {
          window.sessionStorage.removeItem("moon-boot-reload")
        } catch {
          /* 存储不可用时无需处理。 */
        }
        mountApplication()
      } else bootstrap.fail()
    })
    .catch(() => bootstrap.fail())
} else bootstrap.fail()
