import { useContext, useEffect, useRef, useState } from "react"
import { MaterialServiceContext } from "./material-service"
import { readMaterialThumbnail } from "./material-thumbnail-reader"

export type MaterialThumbnailStatus = "idle" | "loading" | "ready" | "failed"

/** Full image bytes are fetched once when this owned thumbnail becomes visible. */
export function useMaterialThumbnail(
  id: string,
  cwd: string,
  enabled: boolean
) {
  const service = useContext(MaterialServiceContext)
  const target = useRef<HTMLDivElement>(null)
  const key = JSON.stringify([cwd, id])
  const [state, setState] = useState<{
    key: string
    service: typeof service
    enabled: boolean
    status: MaterialThumbnailStatus
    url?: string
  }>({ key, service, enabled, status: "idle" })
  if (
    state.key !== key ||
    state.service !== service ||
    state.enabled !== enabled
  )
    setState({ key, service, enabled, status: "idle" })
  useEffect(() => {
    if (!service || !enabled || !cwd || !target.current) return
    const controller = new AbortController()
    let started = false
    const observer = new IntersectionObserver((entries) => {
      if (
        controller.signal.aborted ||
        started ||
        !entries.some((entry) => entry.isIntersecting)
      )
        return
      started = true
      observer.disconnect()
      setState({ key, service, enabled, status: "loading" })
      void service
        .preview(cwd, id, controller.signal)
        .then((preview) => readMaterialThumbnail(preview, controller.signal))
        .then((url) => {
          if (!controller.signal.aborted)
            setState({ key, service, enabled, status: "ready", url })
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({ key, service, enabled, status: "failed" })
        })
    })
    observer.observe(target.current)
    return () => {
      controller.abort()
      observer.disconnect()
    }
  }, [service, key, id, cwd, enabled])
  const current =
    state.key === key && state.service === service && state.enabled === enabled
      ? state
      : undefined
  return {
    target,
    thumbnail: current?.url ?? "",
    status: current?.status ?? "idle",
    fail: () =>
      setState((previous) =>
        previous.key === key &&
        previous.service === service &&
        previous.enabled === enabled
          ? { key, service, enabled, status: "failed" }
          : previous
      ),
  }
}
