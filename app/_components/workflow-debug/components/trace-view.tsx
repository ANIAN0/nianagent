"use client";

/**
 * NewTraceViewer 适配实现：
 * 左：span 列表 · 中：Gantt 时间轴 + 标记 · 右：由父组件挂载 SpanDetailPanel
 * 算法：buildTrace（上游 web-shared）；布局适配 nianagent token。
 */

import {
  Loader2Icon,
  SearchIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "../i18n/zh-CN";
import { buildTrace } from "../trace/trace-builder";
import {
  formatDurationFromOtel,
  formatDurationMs,
  otelTimeToMs,
} from "../trace/time-utils";
import type { Span, WorkflowEvent, WorkflowRunLike } from "../trace/types";
import { cn } from "@/lib/utils";

const RESOURCE_BAR: Record<string, string> = {
  run: "bg-blue-500/70",
  step: "bg-emerald-500/70",
  hook: "bg-violet-500/70",
  sleep: "bg-amber-500/60",
};

const RESOURCE_LABEL: Record<string, string> = {
  run: "run",
  step: "step",
  hook: "hook",
  sleep: "sleep",
};

export function TraceView({
  run,
  events,
  loading,
  selectedSpanId,
  onSelectSpan,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: {
  readonly run: WorkflowRunLike;
  readonly events: readonly WorkflowEvent[];
  readonly loading?: boolean;
  readonly selectedSpanId?: string | null;
  readonly onSelectSpan: (span: Span | null) => void;
  readonly onLoadMore?: () => void | Promise<void>;
  readonly hasMore?: boolean;
  readonly isLoadingMore?: boolean;
}) {
  const [query, setQuery] = useState("");
  /** 时间轴缩放：1 = 适配容器宽度的基准 */
  const [zoom, setZoom] = useState(1);

  const trace = useMemo(() => {
    if (!run?.runId) return null;
    return buildTrace(run, events as WorkflowEvent[], new Date());
  }, [run, events]);

  const rootStart = trace
    ? otelTimeToMs(trace.spans[0]?.startTime ?? [0, 0])
    : 0;
  const rootEnd = useMemo(() => {
    if (!trace || trace.spans.length === 0) return rootStart + 1;
    let max = rootStart + 1;
    for (const s of trace.spans) {
      max = Math.max(max, otelTimeToMs(s.endTime));
    }
    // 略加边距
    return max + Math.max(1, (max - rootStart) * 0.02);
  }, [trace, rootStart]);

  const totalMs = Math.max(1, rootEnd - rootStart);

  const filtered = useMemo(() => {
    if (!trace) return [];
    const q = query.trim().toLowerCase();
    if (!q) return trace.spans;
    return trace.spans.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.spanId.toLowerCase().includes(q) ||
        s.resource.toLowerCase().includes(q) ||
        s.events.some((e) => e.name.toLowerCase().includes(q)),
    );
  }, [trace, query]);

  if (loading && events.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (!trace || trace.spans.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t("emptyEvents")}</p>
    );
  }

  const markers = buildTimeMarkers(rootStart, rootEnd, zoom);

  return (
    <div className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-lg border bg-background">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("traceSearch")}
            className="h-8 pl-8 text-xs"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("traceSearchPlaceholder")}
            value={query}
          />
        </div>
        <span className="text-muted-foreground text-[11px]">
          {t("traceSpanCount").replace("{n}", String(filtered.length))}
          {" · "}
          {formatDurationMs(trace.knownDurationMs)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            aria-label={t("traceZoomOut")}
            className="h-8 w-8"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((z) => Math.max(0.5, z / 1.5))}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ZoomOutIcon className="size-3.5" />
          </Button>
          <Button
            aria-label={t("traceZoomIn")}
            className="h-8 w-8"
            disabled={zoom >= 8}
            onClick={() => setZoom((z) => Math.min(8, z * 1.5))}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ZoomInIcon className="size-3.5" />
          </Button>
          <Button
            className="h-8 px-2 text-xs"
            onClick={() => setZoom(1)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("traceZoomFit")}
          </Button>
        </div>
        {hasMore ? (
          <Button
            className="h-8 gap-1.5 text-xs"
            disabled={isLoadingMore}
            onClick={() => void onLoadMore?.()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoadingMore ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : null}
            {t("traceLoadMore")}
          </Button>
        ) : null}
      </div>

      {/* 主体：名称列 + 时间轴 */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="min-w-full"
          style={{ width: `${Math.max(100, zoom * 100)}%` }}
        >
          {/* 时间刻度 */}
          <div className="sticky top-0 z-10 flex border-b bg-background/95 backdrop-blur">
            <div className="w-52 shrink-0 border-r px-2 py-1.5 font-medium text-[11px] text-muted-foreground sm:w-64">
              {t("traceSpanColumn")}
            </div>
            <div className="relative h-7 min-w-0 flex-1">
              {markers.map((m) => (
                <span
                  className="absolute top-1.5 -translate-x-1/2 font-mono text-[10px] text-muted-foreground"
                  key={m.ms}
                  style={{ left: `${((m.ms - rootStart) / totalMs) * 100}%` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>

          {filtered.map((span) => {
            const start = otelTimeToMs(span.startTime);
            const end = otelTimeToMs(span.endTime);
            const left = ((start - rootStart) / totalMs) * 100;
            const width = Math.max(0.15, ((end - start) / totalMs) * 100);
            const resource =
              (span.attributes.resource as string | undefined) ?? span.resource;
            const selected = selectedSpanId === span.spanId;
            const activeStart = span.activeStartTime
              ? otelTimeToMs(span.activeStartTime)
              : null;
            const queueWidth =
              activeStart && activeStart > start
                ? ((activeStart - start) / Math.max(1, end - start)) * 100
                : 0;

            return (
              <button
                className={cn(
                  "flex w-full border-b text-left transition-colors hover:bg-muted/40",
                  selected && "bg-muted/60",
                )}
                key={span.spanId}
                onClick={() => onSelectSpan(selected ? null : span)}
                type="button"
              >
                <div className="flex w-52 shrink-0 items-center gap-1.5 border-r px-2 py-1.5 sm:w-64">
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 font-mono text-[9px] uppercase",
                      resource === "run" && "bg-blue-500/15 text-blue-700 dark:text-blue-300",
                      resource === "step" &&
                        "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
                      resource === "hook" &&
                        "bg-violet-500/15 text-violet-800 dark:text-violet-300",
                      resource === "sleep" &&
                        "bg-amber-500/15 text-amber-900 dark:text-amber-200",
                    )}
                  >
                    {RESOURCE_LABEL[resource] ?? resource}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {span.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDurationFromOtel(span.duration)}
                  </span>
                </div>
                <div className="relative min-h-[2rem] min-w-0 flex-1 py-1.5">
                  {/* 背景网格线 */}
                  {markers.map((m) => (
                    <span
                      aria-hidden
                      className="absolute top-0 bottom-0 w-px bg-border/60"
                      key={`g-${m.ms}`}
                      style={{
                        left: `${((m.ms - rootStart) / totalMs) * 100}%`,
                      }}
                    />
                  ))}
                  <span
                    className={cn(
                      "absolute top-1.5 h-5 overflow-hidden rounded-sm",
                      RESOURCE_BAR[resource] ?? "bg-foreground/20",
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      minWidth: 4,
                    }}
                    title={`${span.name} · ${formatDurationFromOtel(span.duration)}`}
                  >
                    {queueWidth > 0 ? (
                      <span
                        className="absolute inset-y-0 left-0 bg-black/25"
                        style={{ width: `${queueWidth}%` }}
                      />
                    ) : null}
                  </span>
                  {/* 事件菱形标记 */}
                  {span.events.map((ev, i) => {
                    const tMs = otelTimeToMs(ev.timestamp);
                    if (tMs < rootStart || tMs > rootEnd) return null;
                    const x = ((tMs - rootStart) / totalMs) * 100;
                    return (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-2.5 size-1.5 rotate-45 border border-background",
                          ev.name.includes("failed")
                            ? "bg-red-500"
                            : ev.name.includes("retry")
                              ? "bg-amber-500"
                              : "bg-sky-500",
                        )}
                        key={`${ev.name}-${i}`}
                        style={{ left: `calc(${x}% - 3px)` }}
                        title={ev.name}
                      />
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function buildTimeMarkers(
  start: number,
  end: number,
  zoom: number,
): { ms: number; label: string }[] {
  const span = Math.max(1, end - start);
  // 约 6~10 个刻度，随 zoom 变密
  const target = Math.round(6 * Math.sqrt(zoom));
  let step = span / target;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
  step = nice.find((n) => n >= step) ?? step;

  const out: { ms: number; label: string }[] = [];
  const first = Math.ceil(start / step) * step;
  for (let ms = first; ms <= end; ms += step) {
    out.push({ ms, label: formatOffset(ms - start) });
    if (out.length > 40) break;
  }
  if (out.length === 0) {
    out.push({ ms: start, label: "0" });
  }
  return out;
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return rs ? `${m}m${rs}s` : `${m}m`;
}
