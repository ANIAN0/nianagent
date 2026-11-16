import "./theme.css"
import { createRoot } from "react-dom/client"
import { useSyncExternalStore } from "react"
import { V2Workspace } from "./v2-workspace"

document.documentElement.dataset.theme = "light"

// 唯一产品入口：工作台 v2 协作视图（Q01）。
// 深链（openUrl：#v2?draft=&version=&compare=）由视图自身解析。
const root = document.getElementById("root")
const subscribeLocation = (notify: () => void) => {
  window.addEventListener("hashchange", notify)
  return () => window.removeEventListener("hashchange", notify)
}
function WorkbenchRoute() {
  const location = useSyncExternalStore(
    subscribeLocation,
    () => window.location.hash
  )
  return <V2Workspace key={location} />
}
if (root) createRoot(root).render(<WorkbenchRoute />)
