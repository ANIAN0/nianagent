/** OTEL 时间与时长工具（对齐 web-shared trace-time-utils）。 */

import type { OtelTime } from "./types";

export function dateToOtelTime(date: Date | string | unknown): OtelTime {
  let d: Date | null = null;
  if (typeof date === "string" || typeof date === "number") {
    d = new Date(date);
  } else if (date instanceof Date) {
    d = date;
  }
  if (!d || Number.isNaN(d.getTime())) {
    return [0, 0];
  }
  const ms = d.getTime();
  const seconds = Math.floor(ms / 1000);
  const nanoseconds = (ms % 1000) * 1_000_000;
  return [seconds, nanoseconds];
}

export function otelTimeToMs(time: OtelTime): number {
  return time[0] * 1_000 + time[1] / 1_000_000;
}

export function calculateDuration(
  start: Date | string | unknown,
  end: Date | string | unknown,
): OtelTime {
  const startDate =
    start instanceof Date
      ? start
      : typeof start === "string" || typeof start === "number"
        ? new Date(start)
        : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return [0, 0];
  }
  const endDate =
    end instanceof Date
      ? end
      : typeof end === "string" || typeof end === "number"
        ? new Date(end)
        : new Date();
  const durationMs =
    (Number.isNaN(endDate.getTime()) ? Date.now() : endDate.getTime()) -
    startDate.getTime();
  const seconds = Math.floor(durationMs / 1000);
  const nanoseconds = (durationMs % 1000) * 1_000_000;
  return [seconds, nanoseconds];
}

/** 高精度可读时长（中文单位）。 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec < 10 ? sec.toFixed(2) : sec.toFixed(1)}s`;
  const minutes = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  if (minutes < 60) {
    return remSec > 0 ? `${minutes}m ${remSec}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

export function formatDurationFromOtel(duration: OtelTime): string {
  return formatDurationMs(otelTimeToMs(duration));
}
