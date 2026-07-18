"use client";

/**
 * 全局 Hooks 列表（P5）：刷新、分页、复制、相对时间、侧栏、resume。
 */

import Link from "next/link";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { withWorkflowDebugAgent } from "../agent-href";
import { useWorkflowDebugAgent } from "../agent-context";
import { CopyableText } from "../display-utils/copyable-text";
import { RelativeTime } from "../display-utils/relative-time";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import { SidePanel } from "./side-panel";
import { StatusBadge } from "./status-badge";

type HookRow = {
  hookId?: string;
  id?: string;
  runId?: string;
  status?: string;
  token?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  [key: string]: unknown;
};

export function HooksPanel() {
  const { agentId } = useWorkflowDebugAgent();
  const [rows, setRows] = useState<HookRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<HookRow | null>(null);
  const [filter, setFilter] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(() => new Date());
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeToken, setResumeToken] = useState("");
  const [resumePayload, setResumePayload] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMsg, setResumeMsg] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (mode: "reset" | "more") => {
      if (mode === "more") setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params: Record<string, unknown> = {
          limit: 40,
          sortOrder: "desc",
        };
        if (mode === "more" && cursor) params.cursor = cursor;
        const result = await workflowDebugRpc<{
          data: HookRow[];
          cursor?: string;
          hasMore?: boolean;
        }>(agentId, "fetchHooks", params);
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        const data = Array.isArray(result.data)
          ? result.data
          : (result.data?.data ?? []);
        setRows((prev) => (mode === "more" ? [...prev, ...data] : data));
        setCursor(
          result.data && !Array.isArray(result.data)
            ? result.data.cursor
            : undefined,
        );
        setHasMore(
          Boolean(
            result.data &&
              !Array.isArray(result.data) &&
              result.data.hasMore,
          ),
        );
        if (mode === "reset") setLastRefresh(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [agentId, cursor],
  );

  useEffect(() => {
    void load("reset");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // 无限滚动
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && !loadingMore) {
          void load("more");
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, load, loading, loadingMore]);

  const q = filter.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => {
        const id = String(r.hookId ?? r.id ?? "").toLowerCase();
        const runId = String(r.runId ?? "").toLowerCase();
        const token = String(r.token ?? "").toLowerCase();
        const status = String(r.status ?? "").toLowerCase();
        return (
          id.includes(q) ||
          runId.includes(q) ||
          token.includes(q) ||
          status.includes(q)
        );
      })
    : rows;

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t("filterPlaceholder")}
            className="h-8 max-w-xs text-xs"
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("hooksFilterPlaceholder")}
            value={filter}
          />
          <Button
            className="h-8 gap-1.5"
            disabled={loading}
            onClick={() => void load("reset")}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
            {t("refresh")}
          </Button>
          {lastRefresh ? (
            <span className="text-[11px] text-muted-foreground">
              {t("lastRefreshed")}{" "}
              <RelativeTime date={lastRefresh} type="distance" />
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {loading && rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : null}
        {!loading && visible.length === 0 && !error ? (
          <p className="text-muted-foreground text-sm">{t("emptyHooks")}</p>
        ) : null}

        {visible.length > 0 ? (
          <div className="max-h-[calc(100dvh-14rem)] overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/80 text-muted-foreground text-xs backdrop-blur">
                <tr>
                  <th className="px-3 py-2">{t("colHookId")}</th>
                  <th className="px-3 py-2">{t("colRunId")}</th>
                  <th className="px-3 py-2">{t("colStatus")}</th>
                  <th className="px-3 py-2">{t("colToken")}</th>
                  <th className="px-3 py-2">{t("colStarted")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const id = String(row.hookId ?? row.id ?? "");
                  const runId = String(row.runId ?? "");
                  const selectedRow =
                    selected &&
                    String(selected.hookId ?? selected.id) === id;
                  return (
                    <tr
                      className={
                        selectedRow
                          ? "cursor-pointer border-b bg-muted/50 last:border-0"
                          : "cursor-pointer border-b last:border-0 hover:bg-muted/30"
                      }
                      key={id || JSON.stringify(row)}
                      onClick={() => setSelected(row)}
                    >
                      <td className="px-3 py-2">
                        <CopyableText text={id}>
                          <span className="font-mono text-xs">{id || "—"}</span>
                        </CopyableText>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {runId ? (
                          <Link
                            className="underline-offset-2 hover:underline"
                            href={withWorkflowDebugAgent(
                              `/workflow-debug/${encodeURIComponent(runId)}?tab=hooks`,
                              agentId,
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {runId}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={String(row.status ?? "")} />
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-xs">
                        {row.token ? (
                          <CopyableText text={String(row.token)}>
                            <span title={String(row.token)}>••••••••</span>
                          </CopyableText>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.createdAt ? (
                          <RelativeTime date={row.createdAt} />
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="p-2 text-center text-[11px] text-muted-foreground" ref={sentinelRef}>
              {loadingMore ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2Icon className="size-3 animate-spin" />
                  {t("loading")}
                </span>
              ) : hasMore ? (
                t("hasMore")
              ) : (
                t("noMore")
              )}
            </div>
          </div>
        ) : null}
      </div>

      <SidePanel
        onClose={() => setSelected(null)}
        open={selected !== null}
        title={t("sidePanel")}
      >
        {selected ? (
          <div className="space-y-3">
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">{t("colHookId")}</dt>
                <dd className="font-mono break-all">
                  {String(selected.hookId ?? selected.id ?? "")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("colRunId")}</dt>
                <dd className="font-mono break-all">
                  {String(selected.runId ?? "—")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("colStatus")}</dt>
                <dd>
                  <StatusBadge status={String(selected.status ?? "")} />
                </dd>
              </div>
            </dl>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]">
              {JSON.stringify(selected, null, 2)}
            </pre>
            <Button
              className="h-8 w-full"
              onClick={() => {
                setResumeMsg(null);
                setResumeToken(
                  typeof selected.token === "string" ? selected.token : "",
                );
                setResumePayload("");
                setResumeOpen(true);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("resumeHook")}
            </Button>
            {selected.runId ? (
              <Button asChild className="h-8 w-full" size="sm" variant="ghost">
                <Link
                  href={withWorkflowDebugAgent(
                    `/workflow-debug/${encodeURIComponent(String(selected.runId))}`,
                    agentId,
                  )}
                >
                  {t("openRun")}
                </Link>
              </Button>
            ) : null}
            {resumeMsg ? (
              <p className="text-muted-foreground text-xs" role="status">
                {resumeMsg}
              </p>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <Dialog onOpenChange={setResumeOpen} open={resumeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resumeHook")}</DialogTitle>
            <DialogDescription>{t("resumeHookHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-muted-foreground text-xs" htmlFor="hook-token">
                {t("hookTokenLabel")}
              </label>
              <Input
                id="hook-token"
                onChange={(e) => setResumeToken(e.target.value)}
                value={resumeToken}
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-muted-foreground text-xs"
                htmlFor="hook-payload"
              >
                {t("hookPayloadLabel")}
              </label>
              <Input
                id="hook-payload"
                onChange={(e) => setResumePayload(e.target.value)}
                placeholder='{"ok":true} 或 原文'
                value={resumePayload}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={resumeBusy}
              onClick={() => setResumeOpen(false)}
              type="button"
              variant="ghost"
            >
              {t("confirmCancel")}
            </Button>
            <Button
              disabled={resumeBusy || !resumeToken.trim() || !selected}
              onClick={() => {
                void (async () => {
                  if (!selected) return;
                  setResumeBusy(true);
                  setResumeMsg(null);
                  try {
                    let payload: unknown = undefined;
                    if (resumePayload.trim()) {
                      try {
                        payload = JSON.parse(resumePayload) as unknown;
                      } catch {
                        payload = resumePayload;
                      }
                    }
                    const result = await workflowDebugRpc(
                      agentId,
                      "resumeHook",
                      {
                        token: resumeToken.trim(),
                        payload,
                      },
                    );
                    if (!result.success) {
                      setResumeMsg(result.error.message);
                      return;
                    }
                    setResumeMsg("OK");
                    setResumeOpen(false);
                    void load("reset");
                  } catch (err) {
                    setResumeMsg(
                      err instanceof Error ? err.message : String(err),
                    );
                  } finally {
                    setResumeBusy(false);
                  }
                })();
              }}
              type="button"
            >
              {t("confirmOk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
