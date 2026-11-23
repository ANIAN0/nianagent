// @ts-check
import { redactSensitive } from "./redact.mjs"

export class TelemetryService {
  /** @param {{ diagnostics?: { append: (record: any) => any } }} [options] */
  constructor(options = {}) {
    this.diagnostics = options.diagnostics
  }

  /** @param {Array<{ kind: string, name: string, durationMs: number, blockingMs?: number, route?: string, detail?: string }>} events */
  reportPerf(events) {
    if (!this.diagnostics?.append) return { accepted: 0 }
    let accepted = 0
    for (const item of events) {
      const kind = item.kind === "inp" ? "event-timing" : item.kind
      const route = String(item.route ?? "").slice(0, 120)
      const detail = item.detail
        ? redactSensitive(String(item.detail)).slice(0, 64)
        : ""
      const blockingNote =
        typeof item.blockingMs === "number" ? `block=${item.blockingMs}ms` : ""
      const operationId = [detail, blockingNote]
        .filter(Boolean)
        .join(" ")
        .slice(0, 64)
      this.diagnostics.append({
        module: "frontend-perf",
        event: `perf.${kind}.${item.name}`,
        level: item.durationMs >= 100 ? "warn" : "info",
        durationMs: item.durationMs,
        outcome: "committed",
        traceId: route,
        operationId,
        repeatKey: `${kind}:${item.name}:${route}`,
      })
      accepted += 1
    }
    return { accepted }
  }
}
