import "@tailwindcss/browser"
import "./tokens.css"
import { createRoot } from "react-dom/client"
import { AppRoot } from "./app"

// 票据一次性：成功打开后立即剥离票据；其余查询参数（如深链 page）转入 hash 保留。
const params = new URLSearchParams(window.location.search)
if (params.has("ticket")) {
  params.delete("ticket")
  const rest = params.toString()
  const merged = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  for (const [key, value] of new URLSearchParams(rest))
    if (!merged.has(key)) merged.set(key, value)
  const hash = merged.toString()
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${hash ? `#${hash}` : ""}`
  )
}

const root = document.getElementById("root")
if (root) createRoot(root).render(<AppRoot />)
