import * as React from "react"
import { useEffect, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { rpcCall } from "@/lib/rpc/client"
import { feedbackFromError } from "@/lib/operation-issue"
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
let registryError = ""
let revision = 0
let refreshing: Promise<void> | undefined
let again = false
const notify = () => {
  revision++
  listeners.forEach((listener) => listener())
}
export function reportPluginLifecycleFailure(
  pluginId: string,
  phase: "连接" | "释放"
) {
  registryError = `插件 ${pluginId} 的会话${phase}失败，请重新加载插件；其他插件保持各自状态。`
  notify()
}
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
    let cleanupFailed = false
    try {
      module?.dispose?.()
    } catch {
      cleanupFailed = true
    }
    urls.forEach(URL.revokeObjectURL)
    return {
      descriptor,
      error:
        feedbackFromError(error, "插件前端未能加载。").message +
        (cleanupFailed ? " 插件资源释放也未完成，请重新启动 Moon。" : ""),
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
      const cleanupFailures: string[] = []
      previous.forEach((e) => {
        try {
          e.dispose?.()
        } catch {
          cleanupFailures.push(e.descriptor.id)
        }
      })
      entries = next
      registryError = cleanupFailures.length
        ? `插件卸载未完成：${cleanupFailures.join("、")}。请重新启动 Moon。`
        : ""
      notify()
    } catch (error) {
      registryError = feedbackFromError(
        error,
        "插件目录未能更新，请重新读取。"
      ).message
      notify()
      throw error
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
        console.error("Moon 开发页面热重载：插件资源释放失败，请刷新页面。")
      }
    })
    listeners.clear()
  })
export function usePluginRegistry(enabled = true) {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => revision
  )
  useEffect(() => {
    // The registry records errors for every refresh owner, including background events.
    if (enabled) void refreshPluginRegistry().catch(() => {})
  }, [enabled])
  return {
    entries,
    error: registryError,
  }
}
export function getPluginModule(id: string) {
  return entries.find((e) => e.descriptor.id === id)?.module
}
