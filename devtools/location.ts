import { useSyncExternalStore } from "react"

export const locationEvent = "moon-devtools-location"
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback)
  window.addEventListener(locationEvent, callback)
  return () => {
    window.removeEventListener("popstate", callback)
    window.removeEventListener(locationEvent, callback)
  }
}
export function useToolSearch() {
  return useSyncExternalStore(subscribe, () => location.search)
}
export function navigateTool(url: string, replace = false) {
  if (url === location.pathname + location.search) return
  history[replace ? "replaceState" : "pushState"](null, "", url)
  window.dispatchEvent(new Event(locationEvent))
}
export function toolUrl(tool: string, fields: Record<string, string> = {}) {
  const paths: Record<string, string> = {
    project: "/project/",
    components: "/ui-catalog/",
    api: "/api-catalog/",
  }
  const params = new URLSearchParams(fields)
  const theme = new URLSearchParams(location.search).get("theme")
  if (theme) params.set("theme", theme)
  return `${paths[tool] ?? paths.project}${params.size ? `?${params}` : ""}`
}
