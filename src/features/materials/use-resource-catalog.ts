import { useContext, useEffect, useState } from "react"
import type { Material } from "@/features/home/home-types"
import { MaterialServiceContext } from "./material-service"

export function useResourceCatalog({ sessionId = "", cwd = "", query, enabled, fallback }: { sessionId?: string; cwd?: string; query: string; enabled: boolean; fallback: Material[] }) {
  const service = useContext(MaterialServiceContext)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; files: Material[]; skills: Material[]; diagnostics: string[]; error?: string }>()
  const key = `${sessionId}:${cwd}:${query}:${revision}`
  useEffect(() => {
    if (!enabled || !service || !sessionId || !cwd) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void service.catalog(sessionId, cwd, query, controller.signal).then((data) => {
        if (!controller.signal.aborted) setResult({ key, ...data })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, files: [], skills: [], diagnostics: [], error: error instanceof Error ? error.message : String(error) })
      })
    }, 160)
    return () => { clearTimeout(timer); controller.abort() }
  }, [enabled, service, sessionId, cwd, query, key])
  if (!service) return { files: fallback.filter((item) => item.kind !== "Skill"), skills: fallback.filter((item) => item.kind === "Skill"), diagnostics: [], loading: false, retry: () => {} }
  const current = result?.key === key ? result : undefined
  return { files: current?.files ?? [], skills: current?.skills ?? [], diagnostics: current?.diagnostics ?? [], error: current?.error, loading: enabled && !current, retry: () => setRevision((value) => value + 1) }
}
