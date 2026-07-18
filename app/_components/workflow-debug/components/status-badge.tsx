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
  const dot =
    s === "running"
      ? "bg-blue-500"
      : s === "completed"
        ? "bg-emerald-500"
        : s === "failed"
          ? "bg-red-500"
          : s === "cancelled"
            ? "bg-yellow-500"
            : s === "pending"
              ? "bg-gray-400"
              : "bg-gray-400";

  const label = STATUS_LABEL[s] ?? (status || "—");

  return (
    <span className={cn("inline-flex flex-row items-center gap-2", className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", dot)} />
        <span className="font-medium text-muted-foreground text-xs">{label}</span>
      </span>
      {durationMs !== undefined ? (
        <span className="text-muted-foreground/70 text-xs">
          ({formatDuration(durationMs)})
        </span>
      ) : null}
    </span>
  );
}
