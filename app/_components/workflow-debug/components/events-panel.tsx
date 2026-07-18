"use client";

/**
 * Run 详情 Events tab（P3）：排序、搜索、展开详情、复制、load more。
 * 对齐上游 EventListView：行内 CopyableCell + 展开 Payload 带 Copy。
 *
 * 注意：行容器不得使用 <button> 包住复制按钮（嵌套 button 会导致无法展开）。
 */

import {
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
  SearchIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkflowDebugAgent } from "../agent-context";
import {
  CopyableJsonBlock,
  CopyableText,
} from "../display-utils/copyable-text";
import { RelativeTime } from "../display-utils/relative-time";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import type { WorkflowEvent } from "../trace/types";
import { statusDotClass } from "./status-badge";
import { cn } from "@/lib/utils";

function eventTime(ev: WorkflowEvent): number {
  const v = ev.occurredAt ?? ev.createdAt;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function eventRowKey(ev: WorkflowEvent, index: number): string {
  if (ev.eventId) return String(ev.eventId);
  return `ev-${index}-${ev.eventType}-${eventTime(ev)}`;
}

export function EventsPanel({
  events,
  runId,
  hasMore,
  isLoadingMore,
  onLoadMore,
  loading,
}: {
  readonly events: readonly WorkflowEvent[];
  readonly runId?: string;
  readonly hasMore?: boolean;
  readonly isLoadingMore?: boolean;
  readonly onLoadMore?: () => void | Promise<void>;
  readonly loading?: boolean;
}) {
  const { agentId } = useWorkflowDebugAgent();
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  /** 展开后按需拉取的完整事件（含 eventData） */
  const [fullById, setFullById] = useState<Record<string, WorkflowEvent>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = events as WorkflowEvent[];
    if (q) {
      list = list.filter((ev) => {
        const id = String(ev.eventId ?? "").toLowerCase();
        const type = String(ev.eventType ?? "").toLowerCase();
        const corr = String(ev.correlationId ?? "").toLowerCase();
        if (id === q || id.includes(q)) return true;
        if (type.includes(q) || corr.includes(q)) return true;
        return false;
      });
    }
    const copy = [...list];
    copy.sort((a, b) => {
      const d = eventTime(a) - eventTime(b);
      return sortOrder === "asc" ? d : -d;
    });
    return copy;
  }, [events, query, sortOrder]);

  const toggleExpand = useCallback(
    async (key: string, ev: WorkflowEvent) => {
      if (expanded === key) {
        setExpanded(null);
        return;
      }
      setExpanded(key);

      const eventId = ev.eventId ? String(ev.eventId) : "";
      // 列表项通常无 eventData；展开时按需 fetchEvent
      const needsFetch =
        Boolean(runId && eventId) &&
        !fullById[eventId] &&
        !("eventData" in ev && ev.eventData !== undefined);

      if (!needsFetch || !runId || !eventId) return;

      setLoadingId(eventId);
      try {
        const res = await workflowDebugRpc<WorkflowEvent>(
          agentId,
          "fetchEvent",
          {
            runId,
            eventId,
            resolveData: "all",
          },
        );
        if (res.success && res.data) {
          setFullById((prev) => ({ ...prev, [eventId]: res.data }));
        }
      } finally {
        setLoadingId(null);
      }
    },
    [agentId, expanded, fullById, runId],
  );

  if (loading && events.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("loading")}</p>;
  }

  return (
    <div className="flex h-full min-h-[24rem] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("eventsSearch")}
            className="h-8 pl-8 text-xs"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("eventsSearchPlaceholder")}
            value={query}
          />
        </div>
        <Select
          onValueChange={(v) => setSortOrder(v as "asc" | "desc")}
          value={sortOrder}
        >
          <SelectTrigger className="h-8 w-[8.5rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">{t("sortOldest")}</SelectItem>
            <SelectItem value="desc">{t("sortNewest")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-[11px]">
          {t("eventsShowing")
            .replace("{n}", String(sorted.length))
            .replace("{total}", String(events.length))}
        </span>
        {hasMore ? (
          <Button
            className="h-8 text-xs"
            disabled={isLoadingMore}
            onClick={() => void onLoadMore?.()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoadingMore ? t("loading") : t("traceLoadMore")}
          </Button>
        ) : (
          <span className="text-muted-foreground text-[11px]">{t("noMore")}</span>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("emptyEvents")}</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-auto rounded-lg border">
          {sorted.map((ev, i) => {
            const key = eventRowKey(ev, i);
            const eventId = ev.eventId ? String(ev.eventId) : "";
            const open = expanded === key;
            const ts = eventTime(ev);
            const detail =
              (eventId && fullById[eventId]) ||
              ev;
            const isLoadingDetail =
              Boolean(eventId) && loadingId === eventId;

            return (
              <li className="bg-background" key={key}>
                {/* 行主体：div + 独立按钮，禁止嵌套 button */}
                <div
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-sm",
                    open && "bg-muted/30",
                  )}
                >
                  <button
                    aria-expanded={open}
                    aria-label={open ? "收起事件" : "展开事件"}
                    className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => void toggleExpand(key, ev)}
                    type="button"
                  >
                    {open ? (
                      <ChevronDownIcon className="size-3.5" />
                    ) : (
                      <ChevronRightIcon className="size-3.5" />
                    )}
                  </button>
                  <button
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => void toggleExpand(key, ev)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        statusDotClass(String(ev.eventType ?? "")),
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-mono text-xs">
                          {String(ev.eventType ?? "—")}
                        </span>
                        {ev.correlationId ? (
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            corr={String(ev.correlationId)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {ts ? <RelativeTime date={ts} /> : null}
                      </div>
                    </div>
                  </button>
                  {/* 复制在行外独立区域，不嵌套在展开按钮内 */}
                  <div
                    className="flex shrink-0 flex-col items-end gap-1 pt-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {eventId ? (
                      <CopyableText alwaysShowCopy text={eventId}>
                        <span className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">
                          {eventId}
                        </span>
                      </CopyableText>
                    ) : null}
                    {ev.correlationId ? (
                      <CopyableText
                        alwaysShowCopy
                        text={String(ev.correlationId)}
                      >
                        <span className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">
                          {String(ev.correlationId)}
                        </span>
                      </CopyableText>
                    ) : null}
                  </div>
                </div>

                {open ? (
                  <div className="space-y-2 border-t bg-muted/20 px-3 py-2">
                    {isLoadingDetail ? (
                      <p className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Loader2Icon className="size-3 animate-spin" />
                        {t("loading")}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3 text-[11px]">
                      {eventId ? (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">
                            eventId
                          </span>
                          <CopyableText alwaysShowCopy text={eventId} />
                        </div>
                      ) : null}
                      {detail.correlationId ? (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground">
                            correlationId
                          </span>
                          <CopyableText
                            alwaysShowCopy
                            text={String(detail.correlationId)}
                          />
                        </div>
                      ) : null}
                    </div>
                    {"eventData" in detail && detail.eventData !== undefined ? (
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">
                          eventData
                        </p>
                        <CopyableJsonBlock value={detail.eventData} />
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">
                        {t("rawJson")}
                      </p>
                      <CopyableJsonBlock
                        maxHeightClass="max-h-80"
                        value={detail}
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
