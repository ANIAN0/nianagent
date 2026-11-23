"use client"

import { useEffect, useSyncExternalStore } from "react"
import { V2Workspace } from "./v2-workspace"

const subscribeLocation = (notify: () => void) => {
  window.addEventListener("hashchange", notify)
  return () => window.removeEventListener("hashchange", notify)
}
const getHash = () => window.location.hash

export function NotesWorkbench() {
  const location = useSyncExternalStore(subscribeLocation, getHash, () => "")

  useEffect(() => {
    try {
      const theme =
        localStorage.getItem("moon-notes-theme") === "dark" ? "dark" : "light"
      document.documentElement.classList.remove("light", "dark")
      document.documentElement.classList.add(theme)
    } catch {
      // The default theme still works when storage is unavailable.
    }
  }, [])

  return <V2Workspace key={location} />
}
