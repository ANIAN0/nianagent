"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { withWorkflowDebugAgent } from "../agent-href";
import { useWorkflowDebugAgent } from "../agent-context";
import { CopyableText } from "../display-utils/copyable-text";
import { RelativeTime } from "../display-utils/relative-time";
import { RunRowActions } from "../display-utils/run-row-actions";
import { SelectionBar } from "../display-utils/selection-bar";
import { shortWorkflowName } from "../display-utils/workflow-name";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import { StatusBadge } from "./status-badge";
import { cn } from "@/lib/utils";

type RunRow = {
  runId?: string;
  id?: string;
  status?: string;
  workflowName?: string;
  workflowPath?: string;
  startedAt?: string | number;
  createdAt?: string | number;
  completedAt?: string | number;
  updatedAt?: string | number;
  [key: string]: unknown;
};

const VALID_STATUS = new Set([
  "all",
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Runs 列表（P1）：对齐上游 runs-table 能力。
 * - URL：status / workflow / sort
 * - 筛选、排序、刷新、相对时间、复制、行内菜单、多选批量、无限滚动
 * - 数据经 T-004 RPC；local 后端不展示 Vercel period 选择器
 */
export function RunsPanel() {
  const { agentId } = useWorkflowDebugAgent();
  const router = useRouter();
  const searchParams = useSearchParams();

  const statusRaw = searchParams.get("status") ?? "all";
  const status = VALID_STATUS.has(statusRaw) ? statusRaw : "all";
  const workflowFilter = searchParams.get("workflow") ?? "all";
  const sortOrder =
    searchParams.get("sort") === "asc" ? ("asc" as const) : ("desc" as const);

  const [rows, setRows] = useState<RunRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(
    () => new Date(),
  );
  const [seenWorkflowNames, setSeenWorkflowNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const patchQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("agent", agentId);
      next.set("tab", "runs");
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "" || v === "all") next.delete(k);
        else next.set(k, v);
      }
      // 默认 sort=desc 不写进 URL，保持干净
      if (next.get("sort") === "desc") next.delete("sort");
      router.replace(`/workflow-debug?${next.toString()}`);
    },
    [agentId, router, searchParams],
  );

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (mode === "reset") {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const params: Record<string, unknown> = {
          limit: 20,
          sortOrder,
        };
        if (status !== "all") params.status = status;
        if (workflowFilter !== "all") params.workflowName = workflowFilter;
        if (mode === "more" && cursor) params.cursor = cursor;

        const result = await workflowDebugRpc<{
          data: RunRow[];
          cursor?: string;
          hasMore?: boolean;
        }>(agentId, "fetchRuns", params);

        if (!result.success) {
          setError(result.error.message);
          return;
        }
        const data = result.data?.data ?? [];
        setRows((prev) => (mode === "more" ? [...prev, ...data] : data));
        setCursor(result.data?.cursor);
        setHasMore(Boolean(result.data?.hasMore));
        setLastRefreshTime(new Date());
        if (mode === "reset") setHasLoadedOnce(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [agentId, cursor, sortOrder, status, workflowFilter],
  );

  // 筛选变化：重置列表
  useEffect(() => {
    setRows([]);
    setCursor(undefined);
    setHasMore(false);
    setHasLoadedOnce(false);
    setSelectedIds(new Set());
    void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅筛选/agent 变化时重置
  }, [agentId, status, workflowFilter, sortOrder]);

  // 聚合已见 workflow 名
  useEffect(() => {
    if (rows.length === 0) return;
    setSeenWorkflowNames((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        const name = r.workflowName ?? r.workflowPath;
        if (name) next.add(String(name));
      }
      return next;
    });
  }, [rows]);

  // 无限滚动
  useEffect(() => {
    const root = scrollRootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          hasMore &&
          !loading &&
          !loadingMore
        ) {
          void load("more");
        }
      },
      { root, rootMargin: "120px" },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, load, loading, loadingMore, rows.length]);

  // 标签页重新可见且超过 10s：整表重载
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible" || !lastRefreshTime) return;
      if (Date.now() - lastRefreshTime.getTime() >= 10_000) {
        setCursor(undefined);
        void load("reset");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [lastRefreshTime, load]);

  const runIdOf = (row: RunRow) => String(row.runId ?? row.id ?? "");

  const allSelected =
    rows.length > 0 && rows.every((r) => selectedIds.has(runIdOf(r)));
  const someSelected =
    rows.some((r) => selectedIds.has(runIdOf(r))) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(rows.map(runIdOf).filter(Boolean)));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRuns = useMemo(
    () => rows.filter((r) => selectedIds.has(runIdOf(r))),
    [rows, selectedIds],
  );
  const cancellable = selectedRuns.filter(
    (r) => r.status === "pending" || r.status === "running",
  );

  const bulkCancel = async () => {
    if (bulkBusy || cancellable.length === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);
    try {
      const results = await Promise.allSettled(
        cancellable.map((r) =>
          workflowDebugRpc(agentId, "cancelRun", { runId: runIdOf(r) }),
        ),
      );
      const ok = results.filter(
        (r) => r.status === "fulfilled" && r.value.success,
      ).length;
      const fail = results.length - ok;
      setBulkMessage(
        fail === 0
          ? t("bulkCancelOk").replace("{n}", String(ok))
          : t("bulkPartial")
              .replace("{ok}", String(ok))
              .replace("{fail}", String(fail)),
      );
      setSelectedIds(new Set());
      setCursor(undefined);
      await load("reset");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkReenqueue = async () => {
    if (bulkBusy || selectedRuns.length === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);
    try {
      const results = await Promise.allSettled(
        selectedRuns.map((r) =>
          workflowDebugRpc(agentId, "reenqueueRun", { runId: runIdOf(r) }),
        ),
      );
      const ok = results.filter(
        (r) => r.status === "fulfilled" && r.value.success,
      ).length;
      const fail = results.length - ok;
      setBulkMessage(
        fail === 0
          ? t("bulkReenqueueOk").replace("{n}", String(ok))
          : t("bulkPartial")
              .replace("{ok}", String(ok))
              .replace("{fail}", String(fail)),
      );
      setSelectedIds(new Set());
      setCursor(undefined);
      await load("reset");
    } finally {
      setBulkBusy(false);
    }
  };

  const workflowOptions = useMemo(
    () => Array.from(seenWorkflowNames).sort(),
    [seenWorkflowNames],
  );

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2 text-muted-foreground text-sm">
          <span>{t("lastRefreshed")}</span>
          {lastRefreshTime ? (
            <RelativeTime date={lastRefreshTime} type="distance" />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={loading}
            onValueChange={(v) =>
              patchQuery({ workflow: v === "all" ? null : v })
            }
            value={workflowFilter}
          >
            <SelectTrigger
              aria-label={t("filterWorkflow")}
              className="h-9 w-[11rem] text-xs"
            >
              <SelectValue placeholder={t("filterWorkflow")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllWorkflows")}</SelectItem>
              {workflowOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {shortWorkflowName(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            disabled={loading}
            onValueChange={(v) =>
              patchQuery({ status: v === "all" ? null : v })
            }
            value={status}
          >
            <SelectTrigger
              aria-label={t("filterStatus")}
              className="h-9 w-[9rem] text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAnyStatus")}</SelectItem>
              <SelectItem value="pending">{t("statusPending")}</SelectItem>
              <SelectItem value="running">{t("statusRunning")}</SelectItem>
              <SelectItem value="completed">{t("statusCompleted")}</SelectItem>
              <SelectItem value="failed">{t("statusFailed")}</SelectItem>
              <SelectItem value="cancelled">{t("statusCancelled")}</SelectItem>
            </SelectContent>
          </Select>

          <Button
            className="h-9 gap-1.5 text-xs"
            disabled={loading}
            onClick={() =>
              patchQuery({ sort: sortOrder === "desc" ? "asc" : "desc" })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {sortOrder === "desc" ? (
              <ArrowDownAZIcon className="size-3.5" />
            ) : (
              <ArrowUpAZIcon className="size-3.5" />
            )}
            {sortOrder === "desc" ? t("sortNewest") : t("sortOldest")}
          </Button>

          <Button
            className="h-9 gap-1.5 text-xs"
            disabled={loading}
            onClick={() => {
              setCursor(undefined);
              void load("reset");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon
              className={cn("size-3.5", loading && "animate-spin")}
            />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {bulkMessage ? (
        <p className="text-muted-foreground text-xs" role="status">
          {bulkMessage}
        </p>
      ) : null}

      {/* 表格 */}
      <div
        className="max-h-[calc(100vh-280px)] overflow-auto rounded-lg border bg-background"
        ref={scrollRootRef}
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="sticky top-0 z-10 h-10 w-10 bg-background px-3 shadow-sm">
                <input
                  aria-label={t("selectAllRuns")}
                  checked={allSelected}
                  className="size-3.5 accent-foreground"
                  disabled={rows.length === 0}
                  onChange={toggleAll}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  type="checkbox"
                />
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-3 font-medium shadow-sm">
                {t("colWorkflow")}
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-3 font-medium shadow-sm">
                {t("colRunId")}
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-3 font-medium shadow-sm">
                {t("colStatus")}
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-3 font-medium shadow-sm">
                {t("colStarted")}
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-3 font-medium shadow-sm">
                {t("colCompleted")}
              </th>
              <th className="sticky top-0 z-10 h-10 w-10 bg-background px-3 shadow-sm" />
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td className="h-[320px] px-3" colSpan={7}>
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <p className="font-medium text-destructive text-sm">
                      {t("errorTitle")}
                    </p>
                    <p className="max-w-md text-muted-foreground text-xs">
                      {error}
                    </p>
                    <Button
                      className="mt-2 h-8"
                      onClick={() => void load("reset")}
                      size="sm"
                      type="button"
                    >
                      {t("retry")}
                    </Button>
                  </div>
                </td>
              </tr>
            ) : loading && !hasLoadedOnce ? (
              <tr>
                <td className="h-[320px]" colSpan={7}>
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Loader2Icon className="size-8 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="h-[320px] px-3" colSpan={7}>
                  <p className="flex h-full items-center justify-center text-center text-muted-foreground text-sm">
                    {t("emptyRuns")}
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = runIdOf(row);
                const href = withWorkflowDebugAgent(
                  `/workflow-debug/${encodeURIComponent(id)}`,
                  agentId,
                );
                const started = row.startedAt ?? row.createdAt;
                const completed = row.completedAt;
                const durationMs =
                  started != null
                    ? (completed
                        ? new Date(completed).getTime()
                        : Date.now()) - new Date(started).getTime()
                    : undefined;
                const wf = String(row.workflowName ?? row.workflowPath ?? "");

                return (
                  <tr
                    className="group cursor-pointer border-b last:border-0 hover:bg-muted/30 data-[selected=true]:bg-muted/40"
                    data-selected={selectedIds.has(id)}
                    key={id}
                    onClick={() => {
                      router.push(href);
                    }}
                  >
                    <td className="px-3 py-2">
                      <input
                        aria-label={t("selectRun").replace("{id}", id)}
                        checked={selectedIds.has(id)}
                        className="size-3.5 accent-foreground"
                        onChange={() => toggleOne(id)}
                        onClick={(e) => e.stopPropagation()}
                        type="checkbox"
                      />
                    </td>
                    <td className="max-w-[12rem] px-3 py-2">
                      <CopyableText overlay text={wf}>
                        <span className="truncate text-xs">
                          {shortWorkflowName(wf)}
                        </span>
                      </CopyableText>
                    </td>
                    <td className="max-w-[14rem] px-3 py-2 font-mono text-xs">
                      <CopyableText overlay text={id}>
                        <Link
                          className="truncate underline-offset-2 hover:underline"
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {id}
                        </Link>
                      </CopyableText>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        durationMs={
                          durationMs !== undefined && durationMs >= 0
                            ? durationMs
                            : undefined
                        }
                        status={String(row.status ?? "")}
                      />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {started != null ? (
                        <RelativeTime date={started} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {completed != null ? (
                        <RelativeTime date={completed} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <RunRowActions
                        agentId={agentId}
                        onSuccess={() => {
                          setCursor(undefined);
                          void load("reset");
                        }}
                        runId={id}
                        runStatus={String(row.status ?? "")}
                      />
                    </td>
                  </tr>
                );
              })
            )}
            {loadingMore ? (
              <tr>
                <td className="py-3" colSpan={7}>
                  <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                    <Loader2Icon className="size-4 animate-spin" />
                    {t("loadingMoreRuns")}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div aria-hidden className="h-px" ref={sentinelRef} />
      </div>

      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>
          {rows.length > 0
            ? t("showingRuns")
                .replace("{n}", String(rows.length))
                .concat(!hasMore && !loading ? ` · ${t("noMore")}` : "")
            : null}
        </span>
        {hasMore ? (
          <Button
            className="h-8"
            disabled={loading || loadingMore}
            onClick={() => void load("more")}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("pageNext")}
          </Button>
        ) : null}
      </div>

      <SelectionBar
        actions={
          <>
            <Button
              className="h-7 text-xs"
              disabled={bulkBusy || cancellable.length === 0}
              onClick={() => void bulkCancel()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {t("bulkCancel")}
            </Button>
            <Button
              className="h-7 text-xs"
              disabled={bulkBusy || selectedRuns.length === 0}
              onClick={() => void bulkReenqueue()}
              size="sm"
              type="button"
              variant="secondary"
            >
              {t("bulkReenqueue")}
            </Button>
          </>
        }
        onClearSelection={() => setSelectedIds(new Set())}
        selectionCount={selectedIds.size}
      />
    </div>
  );
}
