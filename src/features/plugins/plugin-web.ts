import * as React from "react"
import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { rpcCall } from "@/lib/rpc/client"
import type { PluginDescriptor } from "@/contracts/rpc.generated"
import { callPlugin } from "./plugin-service"
import type { PluginWebModule, PluginWebFactory } from "./plugin-api"
export type { PluginWebModule } from "./plugin-api"

const bundled = import.meta.glob<{ default: PluginWebModule }>(
  "../../../backend/plugins/*/web.tsx"
)
const listeners = new Set<() => void>()
type Entry = {
  descriptor: PluginDescriptor
  module?: PluginWebModule
  error?: string
  dispose?: () => void
}
let entries: Entry[] = []
let refreshing: Promise<void> | undefined
let again = false
const notify = () => listeners.forEach((listener) => listener())
const key = (p: PluginDescriptor) =>
  `${p.id}:${p.generation}:${p.version}:${p.state}`
async function load(descriptor: PluginDescriptor): Promise<Entry> {
  const urls: string[] = []
  const lifetime = new AbortController()
  let module: PluginWebModule | undefined
  try {
    if (descriptor.sourceKind === "bundled") {
      const loader =
        bundled[`../../../backend/plugins/${descriptor.id}/web.tsx`]
      if (loader) module = (await loader()).default
    } else if (descriptor.webEntry) {
      const resource = async (path: string, signal?: AbortSignal) => {
        const result = await rpcCall(
          "pluginResource",
          { id: descriptor.id, path, generation: descriptor.generation },
          AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
        )
        const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))
        const url = URL.createObjectURL(
          new Blob([bytes], { type: result.mime })
        )
        urls.push(url)
        return url
      }
      const url = await resource(descriptor.webEntry)
      const imported = (await import(/* @vite-ignore */ url)) as {
        default: PluginWebFactory
      }
      module = await imported.default({
        apiVersion: 1,
        pluginId: descriptor.id,
        React,
        ui: { Button, Input, Field, FieldLabel, FieldDescription, Badge },
        call: <T>(
          operation: string,
          input: object,
          sessionId?: string,
          signal?: AbortSignal
        ) =>
          callPlugin<T>(
            descriptor.id,
            operation,
            input,
            sessionId,
            AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]),
            descriptor.generation
          ),
        resource,
      })
    }
    if (module) {
      if (module.apiVersion !== 1 || module.id !== descriptor.id)
        throw new Error("插件前端身份或接口版本不匹配。")
      const registered = [
        ...(module.pages || []).map((p) => ({
          ...p,
          kind: "page",
          version: 1,
        })),
        ...(module.tabs || []).map((p) => ({
          ...p,
          kind: "session-tab",
          version: 1,
        })),
        ...(module.deliveries || []).map((p) => ({ ...p, kind: "delivery" })),
      ]
      const seen = new Set<string>()
      for (const item of registered) {
        const identity = `${item.kind}:${item.id}:${item.version}`
        if (
          seen.has(identity) ||
          (item.kind === "session-tab" && item.id === "pi-interaction") ||
          !descriptor.contributions.some(
            (c) =>
              c.id === item.id &&
              c.kind === item.kind &&
              c.version === item.version
          )
        )
          throw new Error("插件注册了重复或未声明的界面贡献。")
        seen.add(identity)
      }
    }
    return {
      descriptor,
      module,
      dispose: () => {
        lifetime.abort()
        try {
          module?.dispose?.()
        } finally {
          urls.forEach(URL.revokeObjectURL)
        }
      },
    }
  } catch (error) {
    lifetime.abort()
    try {
      module?.dispose?.()
    } catch {
      /* Preserve the original loading error. */
    }
    urls.forEach(URL.revokeObjectURL)
    return {
      descriptor,
      error: error instanceof Error ? error.message : "插件前端未能加载。",
    }
  }
}
export function refreshPluginRegistry() {
  if (refreshing) {
    again = true
    return refreshing
  }
  refreshing = (async () => {
    try {
      const descriptors = await rpcCall("pluginList", {})
      const previous = new Map(entries.map((e) => [key(e.descriptor), e]))
      const next: Entry[] = []
      for (const descriptor of descriptors) {
        const old = previous.get(key(descriptor))
        if (old && !old.error) {
          next.push({ ...old, descriptor })
          previous.delete(key(descriptor))
        } else
          next.push(
            descriptor.state === "active"
              ? await load(descriptor)
              : { descriptor }
          )
      }
      previous.forEach((e) => {
        try {
          e.dispose?.()
        } catch {
          /* Continue disposing other plugins. */
        }
      })
      entries = next
      notify()
    } finally {
      refreshing = undefined
      if (again) {
        again = false
        void refreshPluginRegistry().catch(() => {})
      }
    }
  })()
  return refreshing
}
const changed = () => {
  void refreshPluginRegistry().catch(() => {})
}
if (typeof window !== "undefined")
  window.addEventListener("moon:plugins-changed", changed)
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    window.removeEventListener("moon:plugins-changed", changed)
    entries.forEach((entry) => {
      try {
        entry.dispose?.()
      } catch {
        /* Finish remaining cleanup. */
      }
    })
    listeners.clear()
  })
export function usePluginRegistry(enabled = true) {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => entries
  )
  const [failure, setFailure] = useState<{
    entries: typeof entries
    message: string
  } | null>(null)
  useEffect(() => {
    if (enabled)
      void refreshPluginRegistry().catch((e) =>
        setFailure({
          entries,
          message: e instanceof Error ? e.message : "插件目录未能读取。",
        })
      )
  }, [enabled])
  return {
    entries: value,
    error: failure?.entries === value ? failure.message : "",
  }
}
export function getPluginModule(id: string) {
  return entries.find((e) => e.descriptor.id === id)?.module
}
