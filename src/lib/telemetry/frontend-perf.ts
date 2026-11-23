import { rpcCall } from "@/lib/rpc/client"
import type { FrontendPerfEvent } from "@/contracts/rpc.generated"

const LOAF_THRESHOLD_MS = 50
const SLOW_EVENT_THRESHOLD_MS = 100
const FLUSH_INTERVAL_MS = 2000
const MAX_BATCH_SIZE = 50

interface PerformanceScriptTimingLike {
  sourceURL?: string
  sourceFunctionName?: string
  duration?: number
}

interface PerformanceLongAnimationFrameLike extends PerformanceEntry {
  blockingDuration?: number
  scripts?: PerformanceScriptTimingLike[]
}

function currentRouteLabel(): string {
  if (typeof window === "undefined") return ""
  const hash = window.location.hash.replace(/^#/, "")
  const path = window.location.pathname || "/"
  return (hash || path).slice(0, 120)
}

function basename(url: string): string {
  const clean = url.split("?")[0]?.split("#")[0] ?? ""
  const parts = clean.split("/")
  return parts[parts.length - 1] || clean
}

function topLoafDetail(entry: PerformanceLongAnimationFrameLike): string {
  const scripts = entry.scripts
  if (!scripts || scripts.length === 0) return ""
  let top = scripts[0]
  for (const item of scripts) {
    if ((item.duration ?? 0) > (top?.duration ?? 0)) top = item
  }
  const fn = top?.sourceFunctionName?.trim()
  const file = top?.sourceURL ? basename(top.sourceURL) : ""
  if (fn && file) return `${fn}@${file}`.slice(0, 300)
  return (fn || file).slice(0, 300)
}

let started = false

/**
 * 在开发期采集浏览器主线程卡顿（LoAF / LongTask）与单条慢事件，
 * 批量经 telemetryReportPerf 写入 Moon 本机 JSONL 诊断日志。
 */
export function startFrontendPerfTelemetry(): () => void {
  if (
    started ||
    typeof window === "undefined" ||
    typeof PerformanceObserver === "undefined"
  ) {
    return () => {}
  }
  started = true

  const queue: FrontendPerfEvent[] = []
  let timer: number | undefined

  const flush = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
    if (queue.length === 0) return
    const batch = queue.splice(0, MAX_BATCH_SIZE)
    void rpcCall("telemetryReportPerf", { events: batch }).catch(() => {
      // 诊断上报静默失败，绝不干扰前台交互。
    })
  }

  const enqueue = (event: FrontendPerfEvent) => {
    queue.push(event)
    if (queue.length >= 10) {
      flush()
      return
    }
    if (timer === undefined) {
      timer = window.setTimeout(flush, FLUSH_INTERVAL_MS)
    }
  }

  const supported = PerformanceObserver.supportedEntryTypes ?? []
  const observers: PerformanceObserver[] = []

  if (supported.includes("long-animation-frame")) {
    try {
      const loafObserver = new PerformanceObserver((list) => {
        for (const raw of list.getEntries()) {
          const entry = raw as PerformanceLongAnimationFrameLike
          if (entry.duration < LOAF_THRESHOLD_MS) continue
          enqueue({
            kind: "loaf",
            name: "frame",
            durationMs: Math.round(entry.duration),
            blockingMs: Math.round(entry.blockingDuration ?? 0),
            route: currentRouteLabel(),
            detail: topLoafDetail(entry),
          })
        }
      })
      loafObserver.observe({ type: "long-animation-frame", buffered: true })
      observers.push(loafObserver)
    } catch {
      // 忽略不支持的观察器配置。
    }
  } else if (supported.includes("longtask")) {
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LOAF_THRESHOLD_MS) continue
          enqueue({
            kind: "longtask",
            name: entry.name || "self",
            durationMs: Math.round(entry.duration),
            route: currentRouteLabel(),
          })
        }
      })
      longTaskObserver.observe({ type: "longtask", buffered: true })
      observers.push(longTaskObserver)
    } catch {
      // 忽略不支持的观察器配置。
    }
  }

  if (supported.includes("event")) {
    try {
      const eventObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < SLOW_EVENT_THRESHOLD_MS) continue
          enqueue({
            kind: "event-timing",
            name: entry.name || "event",
            durationMs: Math.round(entry.duration),
            route: currentRouteLabel(),
          })
        }
      })
      eventObserver.observe({
        type: "event",
        buffered: true,
        durationThreshold: SLOW_EVENT_THRESHOLD_MS,
      } as PerformanceObserverInit)
      observers.push(eventObserver)
    } catch {
      // 忽略不支持的观察器配置。
    }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)

  return () => {
    started = false
    document.removeEventListener("visibilitychange", onVisibilityChange)
    for (const observer of observers) observer.disconnect()
    flush()
  }
}
