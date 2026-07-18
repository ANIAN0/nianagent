"use client";

/**
 * Run 详情页：P2 Trace · P3 Events/Streams · P4 Graph · Hooks/Actions。
 * 布局对齐上游 run-detail-view。
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  otherWorkflowDebugAgent,
  withWorkflowDebugAgent,
} from "../agent-href";
import { useWorkflowDebugAgent } from "../agent-context";
import { CopyableText } from "../display-utils/copyable-text";
import { RelativeTime } from "../display-utils/relative-time";
import { shortWorkflowName } from "../display-utils/workflow-name";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import { useWorkflowTraceViewerData } from "../trace/use-trace-viewer-data";
import { formatDurationMs } from "../trace/time-utils";
import type { Span } from "../trace/types";
import { EventsPanel } from "./events-panel";
import { GraphPanel } from "./graph-panel";
import { RunActions } from "./run-actions";
import { SectionTabs } from "./section-tabs";
import { SpanDetailPanel } from "./span-detail-panel";
import { StatusBadge } from "./status-badge";
import { StreamViewer } from "./stream-viewer";
import { TraceView } from "./trace-view";
import { cn } from "@/lib/utils";
import type { AgentId } from "@nianagent/agent-core/model-catalog";

type DetailTab =
  | "trace"
  | "events"
  | "graph"
  | "hooks"
  | "streams"
  | "actions";

const VALID_TABS = new Set<DetailTab>([
  "trace",
  "events",
  "graph",
  "hooks",
  "streams",
  "actions",
]);

export function RunDetail({ runId }: { readonly runId: string }) {
  const { agentId } = useWorkflowDebugAgent();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabRaw = searchParams.get("tab") ?? "trace";
  const activeTab: DetailTab = VALID_TABS.has(tabRaw as DetailTab)
    ? (tabRaw as DetailTab)
    : "trace";

  const {
    run,
    events,
    loading,
    error,
    update,
    loadMoreTraceData,
    hasMoreTraceData,
    isLoadingMoreTraceData,
  } = useWorkflowTraceViewerData(agentId, runId, { live: true });

  const [altAgent, setAltAgent] = useState<AgentId | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [hooks, setHooks] = useState<unknown[]>([]);
  const [streams, setStreams] = useState<string[]>([]);
  const [activeStream, setActiveStream] = useState<string | null>(
    () => searchParams.get("streamId"),
  );
  const [sideLoading, setSideLoading] = useState(false);

  const runsListHref = withWorkflowDebugAgent("/workflow-debug", agentId);

  const setTab = useCallback(
    (tab: DetailTab) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("tab", tab);
      next.set("agent", agentId);
      if (tab !== "streams") next.delete("streamId");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [agentId, pathname, router, searchParams],
  );

  useEffect(() => {
    if (!error || run) {
      setAltAgent(null);
      return;
    }
    if (!/not found/i.test(error)) return;
    let cancelled = false;
    void (async () => {
      const other = otherWorkflowDebugAgent(agentId);
      const probe = await workflowDebugRpc(other, "fetchRun", {
        runId,
        resolveData: "none",
      });
      if (!cancelled && probe.success && probe.data) {
        setAltAgent(other);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [error, run, agentId, runId]);

  useEffect(() => {
    if (
      activeTab !== "hooks" &&
      activeTab !== "streams" &&
      activeTab !== "actions"
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setSideLoading(true);
      try {
        if (activeTab === "hooks" || activeTab === "actions") {
          const hooksRes = await workflowDebugRpc<{ data: unknown[] }>(
            agentId,
            "fetchHooks",
            { runId, limit: 100 },
          );
          if (!cancelled && hooksRes.success) {
            const data = Array.isArray(hooksRes.data)
              ? hooksRes.data
              : (hooksRes.data?.data ?? []);
            setHooks(data);
          }
        }
        if (activeTab === "streams") {
          const streamsRes = await workflowDebugRpc<string[]>(
            agentId,
            "fetchStreams",
            { runId },
          );
          if (
            !cancelled &&
            streamsRes.success &&
            Array.isArray(streamsRes.data)
          ) {
            setStreams(streamsRes.data);
          }
        }
      } finally {
        if (!cancelled) setSideLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, agentId, runId]);

  useEffect(() => {
    const sid = searchParams.get("streamId");
    if (sid) setActiveStream(sid);
  }, [searchParams]);

  const selectStream = (streamId: string | null) => {
    setActiveStream(streamId);
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "streams");
    next.set("agent", agentId);
    if (streamId) next.set("streamId", streamId);
    else next.delete("streamId");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const durationLabel = useMemo(() => {
    if (!run?.startedAt && !run?.createdAt) return "—";
    const start = new Date(
      (run.startedAt ?? run.createdAt) as string | number | Date,
    ).getTime();
    if (Number.isNaN(start)) return "—";
    const end = run.completedAt
      ? new Date(run.completedAt as string | number | Date).getTime()
      : Date.now();
    return formatDurationMs(Math.max(0, end - start));
  }, [run]);

  if (loading && !run) {
    return <p className="text-muted-foreground text-sm">{t("loading")}</p>;
  }

  if (error && !run) {
    return (
      <div className="space-y-3">
        <p className="text-destructive text-sm" role="alert">
          {/not found/i.test(error) ? t("runNotFoundOnAgent") : error}
        </p>
        <p className="font-mono text-muted-foreground text-xs">
          agent={agentId} · runId={runId}
        </p>
        <div className="flex flex-wrap gap-2">
          {altAgent ? (
            <Button asChild size="sm">
              <Link
                href={withWorkflowDebugAgent(
                  `/workflow-debug/${encodeURIComponent(runId)}`,
                  altAgent,
                )}
              >
                {t("openOnOtherAgent")}（{altAgent}）
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={runsListHref}>{t("backToRuns")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!run) {
    return <p className="text-muted-foreground text-sm">{t("runNotFound")}</p>;
  }

  const workflowName = shortWorkflowName(
    typeof run.workflowName === "string" ? run.workflowName : undefined,
  );
  const status = String(run.status ?? "");

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-4">
      <nav aria-label="breadcrumb" className="text-muted-foreground text-xs">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link
              className="hover:text-foreground underline-offset-2 hover:underline"
              href={runsListHref}
            >
              {t("tabRuns")}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="font-mono text-foreground text-[11px]">{runId}</li>
        </ol>
      </nav>

      <div className="space-y-4 rounded-lg border p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-xl tracking-tight">
              {workflowName}
            </h2>
            <p className="mt-0.5 text-muted-foreground text-xs">
              {t("runDetail")}
            </p>
          </div>
          <RunActions onDone={() => void update()} runId={runId} />
        </div>

        <div className="flex flex-wrap items-start gap-6 sm:gap-8">
          <MetaCell label={t("colStatus")}>
            <StatusBadge status={status} />
          </MetaCell>
          <MetaCell label={t("traceDuration")}>
            <span className="text-xs">{durationLabel}</span>
          </MetaCell>
          <MetaCell label={t("colRunId")}>
            <CopyableText text={runId}>
              <span className="font-mono text-xs">{runId}</span>
            </CopyableText>
          </MetaCell>
          <MetaCell label={t("traceQueued")}>
            {run.createdAt ? (
              <RelativeTime className="text-xs" date={run.createdAt as string} />
            ) : (
              <span className="text-xs">—</span>
            )}
          </MetaCell>
          <MetaCell label={t("colStarted")}>
            {run.startedAt ? (
              <RelativeTime className="text-xs" date={run.startedAt as string} />
            ) : (
              <span className="text-xs">—</span>
            )}
          </MetaCell>
          <MetaCell label={t("colCompleted")}>
            {run.completedAt ? (
              <RelativeTime
                className="text-xs"
                date={run.completedAt as string}
              />
            ) : (
              <span className="text-xs">—</span>
            )}
          </MetaCell>
        </div>
      </div>

      <SectionTabs
        ariaLabel={t("sectionNav")}
        items={[
          { id: "trace", label: t("sectionTrace") },
          { id: "events", label: t("sectionEvents") },
          { id: "graph", label: t("sectionGraph") },
          { id: "hooks", label: t("sectionHooks") },
          { id: "streams", label: t("sectionStreams") },
          { id: "actions", label: t("sectionActions") },
        ]}
        onChange={(id) => setTab(id as DetailTab)}
        value={activeTab}
      />

      {activeTab === "trace" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="min-h-[28rem] min-w-0 flex-1">
            <TraceView
              events={events}
              hasMore={hasMoreTraceData}
              isLoadingMore={isLoadingMoreTraceData}
              loading={loading}
              onLoadMore={loadMoreTraceData}
              onSelectSpan={setSelectedSpan}
              run={run}
              selectedSpanId={selectedSpan?.spanId ?? null}
            />
          </div>
          <SpanDetailPanel
            allEvents={events}
            onClose={() => setSelectedSpan(null)}
            span={selectedSpan}
          />
        </div>
      ) : null}

      {activeTab === "events" ? (
        <EventsPanel
          events={events}
          hasMore={hasMoreTraceData}
          isLoadingMore={isLoadingMoreTraceData}
          loading={loading}
          onLoadMore={loadMoreTraceData}
          runId={runId}
        />
      ) : null}

      {activeTab === "graph" ? (
        <GraphPanel events={events} run={run} />
      ) : null}

      {activeTab === "hooks" ? (
        <section className="space-y-2">
          <h3 className="font-medium text-sm">{t("sectionHooks")}</h3>
          {sideLoading ? (
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          ) : hooks.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("emptyHooks")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {hooks.map((hook, i) => {
                const o = (hook ?? {}) as Record<string, unknown>;
                const id = String(o.hookId ?? o.id ?? i);
                return (
                  <li
                    className="flex items-center justify-between px-3 py-2 text-sm"
                    key={id}
                  >
                    <CopyableText text={id}>
                      <span className="font-mono text-xs">{id}</span>
                    </CopyableText>
                    <StatusBadge status={String(o.status ?? "")} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {activeTab === "streams" ? (
        <section className="flex min-h-[24rem] flex-col gap-3 lg:flex-row">
          <div className="w-full shrink-0 space-y-2 lg:w-64">
            <h3 className="font-medium text-sm">
              {t("sectionStreams")}
              {streams.length > 0 ? `（${streams.length}）` : ""}
            </h3>
            {sideLoading ? (
              <p className="text-muted-foreground text-sm">{t("loading")}</p>
            ) : streams.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("emptyStreams")}</p>
            ) : (
              <ul className="max-h-[28rem] overflow-auto rounded-lg border">
                {streams.map((id) => (
                  <li key={id}>
                    <button
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono text-xs hover:bg-muted/40",
                        activeStream === id && "bg-muted",
                      )}
                      onClick={() => selectStream(id)}
                      type="button"
                    >
                      <span className="truncate">{id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {activeStream ? (
              <Link
                className="text-muted-foreground text-xs underline-offset-2 hover:underline"
                href={withWorkflowDebugAgent(
                  `/workflow-debug/${encodeURIComponent(runId)}/streams/${encodeURIComponent(activeStream)}`,
                  agentId,
                )}
              >
                {t("openStream")}
              </Link>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            {activeStream ? (
              <StreamViewer
                className="h-[min(32rem,60vh)]"
                live
                runId={runId}
                runStatus={status}
                streamId={activeStream}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("streamSelectHint")}
              </p>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "actions" ? (
        <section className="space-y-2">
          <h3 className="font-medium text-sm">{t("sectionActions")}</h3>
          <RunActions onDone={() => void update()} runId={runId} />
        </section>
      ) : null}

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm">{t("rawJson")}</summary>
        <pre className="mt-2 max-h-96 overflow-auto font-mono text-xs">
          {JSON.stringify(run, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function MetaCell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      {children}
    </div>
  );
}
