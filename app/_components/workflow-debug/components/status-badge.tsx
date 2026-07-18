"use client";

import { cn } from "@/lib/utils";
import { t } from "../i18n/zh-CN";

const STATUS_LABEL: Record<string, string> = {
  running: t("statusRunning"),
  completed: t("statusCompleted"),
  failed: t("statusFailed"),
  cancelled: t("statusCancelled"),
  pending: t("statusPending"),
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  if (min < 60) return `${min}m ${rem}s`;
  const hour = Math.floor(min / 60);
  return `${hour}h ${min % 60}m`;
}

/** 状态点 + 汉化标签（对齐上游 StatusBadge 信息密度）。 */
export function StatusBadge({
  status,
  durationMs,
  className,
}: {
  readonly status: string;
  readonly durationMs?: number;
  readonly className?: string;
}) {
  const s = status.toLowerCase();
  // 语义色：失败走 destructive；其余用可在 light/dark 下辨认的色点（非装饰性 rainbow）
  const dot = statusDotClass(s);
  const label = STATUS_LABEL[s] ?? (status || "—");

  return (
    <span className={cn("inline-flex flex-row items-center gap-2", className)}>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", dot)}
        />
        <span className="font-medium text-foreground/80 text-xs">{label}</span>
      </span>
      {durationMs !== undefined ? (
        <span className="text-muted-foreground text-xs">
          ({formatDuration(durationMs)})
        </span>
      ) : null}
    </span>
  );
}

/** 状态点色阶：供 Events / Trace 等列表复用，保持语义一致。 */
export function statusDotClass(statusOrEventType: string): string {
  const s = statusOrEventType.toLowerCase();
  if (
    s === "failed" ||
    s === "step_failed" ||
    s === "run_failed" ||
    s === "workflow_failed" ||
    s.includes("fail")
  ) {
    return "bg-destructive";
  }
  if (
    s === "completed" ||
    s === "step_completed" ||
    s === "run_completed" ||
    s === "wait_completed" ||
    s === "hook_disposed"
  ) {
    return "bg-emerald-600 dark:bg-emerald-400";
  }
  if (
    s === "running" ||
    s === "step_started" ||
    s === "run_started" ||
    s === "hook_received"
  ) {
    return "bg-blue-600 dark:bg-blue-400";
  }
  if (s === "cancelled" || s === "run_cancelled" || s === "step_retrying") {
    return "bg-amber-600 dark:bg-amber-400";
  }
  if (s === "attr_set") {
    return "bg-teal-600 dark:bg-teal-400";
  }
  if (s === "pending") {
    return "bg-muted-foreground/70";
  }
  return "bg-muted-foreground/50";
}
