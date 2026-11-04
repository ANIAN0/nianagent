import "@tailwindcss/browser"
import { createRoot } from "react-dom/client"
import { App } from "./app"

// 票据一次性：成功打开后立即从地址剥离，刷新不再命中已用票据。
if (new URLSearchParams(window.location.search).has("ticket")) {
  window.history.replaceState(null, "", window.location.pathname)
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<App />)
