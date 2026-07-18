"use client";

/**
 * Trace 数据钩子：Run + Events 分页/自动续载/运行中轮询
 * （对齐 packages/web use-trace-viewer.ts 语义）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { workflowDebugRpc } from "../rpc-client";
import type { WorkflowEvent, WorkflowRunLike } from "./types";

const INITIAL_PAGE_SIZE = 500;
const LOAD_MORE_PAGE_SIZE = 100;
const LIVE_UPDATE_INTERVAL_MS = 5000;
const AUTO_LOAD_MAX_EVENTS = 500;

type EventsPage = {
  data?: WorkflowEvent[];
  cursor?: string;
  hasMore?: boolean;
};

function asEventList(data: unknown): WorkflowEvent[] {
  if (Array.isArray(data)) return data as WorkflowEvent[];
  if (data && typeof data === "object" && "data" in data) {
    const inner = (data as EventsPage).data;
    return Array.isArray(inner) ? inner : [];
  }
  return [];
}

function mergeByEventId(
  prev: WorkflowEvent[],
  next: WorkflowEvent[],
): WorkflowEvent[] {
  const map = new Map<string, WorkflowEvent>();
  for (const e of prev) {
    const id = String(e.eventId ?? "");
    if (id) map.set(id, e);
  }
  for (const e of next) {
    const id = String(e.eventId ?? "");
    if (id) map.set(id, e);
    else map.set(`anon-${map.size}`, e);
  }
  return Array.from(map.values()).sort((a, b) => {
    const ta = toMs(a.occurredAt ?? a.createdAt);
    const tb = toMs(b.occurredAt ?? b.createdAt);
    return ta - tb;
  });
}

function toMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function useWorkflowTraceViewerData(
  agentId: AgentId,
  runId: string,
  options: { live?: boolean } = {},
) {
  const { live = true } = options;
  const [run, setRun] = useState<WorkflowRunLike | null>(null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsCursor, setEventsCursor] = useState<string | undefined>();
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [initialDone, setInitialDone] = useState(false);

  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchAll = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [runRes, eventsRes] = await Promise.all([
        workflowDebugRpc<WorkflowRunLike>(agentId, "fetchRun", {
          runId,
          resolveData: "none",
        }),
        workflowDebugRpc<EventsPage>(agentId, "fetchEvents", {
          runId,
          sortOrder: "asc",
          limit: INITIAL_PAGE_SIZE,
        }),
      ]);

      if (!mountedRef.current) return;

      if (!runRes.success) {
        setError(runRes.error.message);
        setRun(null);
        setEvents([]);
        setLoading(false);
        setInitialDone(true);
        fetchingRef.current = false;
        return;
      }

      setRun(runRes.data);

      if (eventsRes.success) {
        const page = eventsRes.data;
        const list = asEventList(page);
        setEvents(mergeByEventId([], list));
        setEventsHasMore(Boolean(page?.hasMore));
        setEventsCursor(page?.hasMore ? page?.cursor : undefined);
      } else {
        setEvents([]);
        setEventsHasMore(false);
        setEventsCursor(undefined);
        setError(eventsRes.error.message);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setInitialDone(true);
      }
      fetchingRef.current = false;
    }
  }, [agentId, runId]);

  const loadMoreTraceData = useCallback(async () => {
    if (
      fetchingRef.current ||
      !initialDone ||
      isLoadingMore ||
      !eventsHasMore
    ) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const res = await workflowDebugRpc<EventsPage>(agentId, "fetchEvents", {
        runId,
        cursor: eventsCursor,
        sortOrder: "asc",
        limit: LOAD_MORE_PAGE_SIZE,
      });
      if (!mountedRef.current) return;
      if (!res.success) {
        setError(res.error.message);
        return;
      }
      const list = asEventList(res.data);
      if (list.length > 0) {
        setEvents((prev) => mergeByEventId(prev, list));
      }
      setEventsHasMore(Boolean(res.data?.hasMore));
      setEventsCursor(res.data?.hasMore ? res.data?.cursor : undefined);
    } finally {
      if (mountedRef.current) setIsLoadingMore(false);
    }
  }, [
    agentId,
    runId,
    initialDone,
    isLoadingMore,
    eventsHasMore,
    eventsCursor,
  ]);

  // 初始自动续载（上限 AUTO_LOAD_MAX_EVENTS）
  useEffect(() => {
    if (events.length >= AUTO_LOAD_MAX_EVENTS) return;
    if (!eventsHasMore || isLoadingMore || loading) return;
    void loadMoreTraceData();
  }, [
    events.length,
    eventsHasMore,
    isLoadingMore,
    loading,
    loadMoreTraceData,
  ]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // 运行中轮询 run + 尾部新事件
  useEffect(() => {
    if (!live || !run || run.completedAt) return;
    const id = window.setInterval(async () => {
      if (fetchingRef.current) return;
      try {
        const runRes = await workflowDebugRpc<WorkflowRunLike>(
          agentId,
          "fetchRun",
          { runId, resolveData: "none" },
        );
        if (!mountedRef.current || !runRes.success) return;
        setRun(runRes.data);

        const eventsRes = await workflowDebugRpc<EventsPage>(
          agentId,
          "fetchEvents",
          {
            runId,
            sortOrder: "desc",
            limit: 50,
          },
        );
        if (!mountedRef.current || !eventsRes.success) return;
        const latest = asEventList(eventsRes.data);
        if (latest.length > 0) {
          setEvents((prev) => mergeByEventId(prev, latest));
        }
      } catch {
        // 轮询失败静默；用户可手动刷新
      }
    }, LIVE_UPDATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [live, run, agentId, runId]);

  return {
    run,
    events,
    loading,
    error,
    update: fetchAll,
    loadMoreTraceData,
    hasMoreTraceData: eventsHasMore,
    isLoadingMoreTraceData: isLoadingMore,
  };
}
