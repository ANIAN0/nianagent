import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useTheme } from "@/components/theme-provider"
import { readSelection, type CatalogMetadata } from "./catalog"
import { buildCatalogHref, readViewportDimension } from "./catalog-controls"

const locationEvent = "moon-catalog-location"
const narrowMedia = window.matchMedia("(max-width: 959px)")
const subscribeLocation = (callback: () => void) => {
  window.addEventListener("popstate", callback)
  window.addEventListener(locationEvent, callback)
  return () => {
    window.removeEventListener("popstate", callback)
    window.removeEventListener(locationEvent, callback)
  }
}
const subscribeNarrow = (callback: () => void) => {
  narrowMedia.addEventListener("change", callback)
  return () => narrowMedia.removeEventListener("change", callback)
}
function updateLocation(params: URLSearchParams, replace: boolean) {
  const next = `${location.pathname}?${params}`
  if (`${location.pathname}${location.search}` === next) return
  history[replace ? "replaceState" : "pushState"](null, "", next)
  window.dispatchEvent(new Event(locationEvent))
}

/** The URL owns selection and viewport; presentation state never modifies demos. */
export function useCatalogController() {
  const search = useSyncExternalStore(subscribeLocation, () => location.search)
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => narrowMedia.matches
  )
  const selection = readSelection(search)
  const params = new URLSearchParams(search)
  const { theme, setTheme } = useTheme()
  const urlTheme = params.get("theme")
  const observedUrlTheme = useRef(urlTheme)
  const resolvedTheme = theme === "dark" ? "dark" : "light"
  const width = readViewportDimension(
    params.get("width"),
    "width",
    selection.entry?.viewport.width ?? 800
  )
  const height = readViewportDimension(
    params.get("height"),
    "height",
    selection.entry?.viewport.height ?? 600
  )
  const [panel, setPanel] = useState("preview")
  const [query, setQuery] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (urlTheme !== observedUrlTheme.current) {
      // Navigation wins over the previous rendered theme, including browser Back.
      observedUrlTheme.current = urlTheme
      setTheme(urlTheme === "dark" ? "dark" : "light")
    } else if (urlTheme !== resolvedTheme) {
      // Provider shortcuts are theme events too; preserve selection and viewport.
      const next = new URLSearchParams(location.search)
      next.set("theme", resolvedTheme)
      observedUrlTheme.current = resolvedTheme
      updateLocation(next, true)
    }
  }, [urlTheme, resolvedTheme, setTheme])
  const previewParams = new URLSearchParams({
    component: selection.component,
    state: selection.stateId,
    theme: resolvedTheme,
  })
  const previewUrl = `./preview.html?${previewParams}`

  function hrefFor(entry: CatalogMetadata, state?: string) {
    return buildCatalogHref(
      entry,
      {
        component: selection.component,
        stateId: selection.stateId,
        width,
        height,
        theme: resolvedTheme,
      },
      state
    )
  }
  function navigate(entry: CatalogMetadata, state?: string) {
    updateLocation(new URLSearchParams(hrefFor(entry, state).slice(1)), false)
    setPanel("preview")
  }
  function setViewport(nextWidth: number, nextHeight: number) {
    const next = new URLSearchParams(search)
    next.set("width", String(nextWidth))
    next.set("height", String(nextHeight))
    next.set("theme", resolvedTheme)
    updateLocation(next, true)
  }
  function inspectState(stateId: string) {
    const next = new URLSearchParams(search)
    next.set("component", selection.component)
    next.set("view", "docs")
    next.set("state", stateId)
    next.set("theme", resolvedTheme)
    updateLocation(next, true)
  }
  function toggleTheme() {
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark"
    const next = new URLSearchParams(search)
    next.set("theme", nextTheme)
    updateLocation(next, true)
  }
  function shareUrl() {
    const next = new URL(location.href)
    next.searchParams.set("component", selection.component)
    next.searchParams.set("state", selection.stateId)
    next.searchParams.set("view", selection.view)
    next.searchParams.set("theme", resolvedTheme)
    next.searchParams.set("width", String(width))
    next.searchParams.set("height", String(height))
    return next.href
  }
  return {
    selection,
    narrow,
    panel,
    setPanel,
    query,
    setQuery,
    width,
    height,
    theme: resolvedTheme,
    previewUrl,
    revision,
    navigate,
    setViewport,
    toggleTheme,
    shareUrl,
    hrefFor,
    inspectState,
    reset: () => setRevision((value) => value + 1),
  }
}
