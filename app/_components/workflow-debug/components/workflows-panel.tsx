"use client";

/**
 * 首页 Workflows 清单 + 图浏览（P6）。
 */

import { GitBranchIcon, Loader2Icon, RefreshCwIcon, WorkflowIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkflowDebugAgent } from "../agent-context";
import { adaptManifest } from "../flow-graph/adapt-manifest";
import type { WorkflowGraph, WorkflowGraphManifest } from "../flow-graph/types";
import { WorkflowGraphView } from "../flow-graph/workflow-graph-view";
import { shortWorkflowName } from "../display-utils/workflow-name";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import { SidePanel } from "./side-panel";

export function WorkflowsPanel() {
  const { agentId } = useWorkflowDebugAgent();
  const [manifest, setManifest] = useState<WorkflowGraphManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<WorkflowGraph | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await workflowDebugRpc<unknown>(
        agentId,
        "fetchWorkflowsManifest",
        {},
      );
      if (!result.success) {
        setError(result.error.message);
        return;
      }
      setManifest(adaptManifest(result.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const workflows = useMemo(() => {
    const list = manifest ? Object.values(manifest.workflows) : [];
    list.sort((a, b) => a.workflowName.localeCompare(b.workflowName, "zh-CN"));
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (w) =>
        w.workflowName.toLowerCase().includes(q) ||
        w.workflowId.toLowerCase().includes(q) ||
        w.filePath.toLowerCase().includes(q),
    );
  }, [manifest, filter]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-medium text-sm">{t("sectionGraph")}</h2>
          <Input
            className="h-8 max-w-xs text-xs"
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("workflowsFilterPlaceholder")}
            value={filter}
          />
          <Button
            className="h-8 gap-1.5"
            disabled={loading}
            onClick={() => void load()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
            {t("refresh")}
          </Button>
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {loading && !manifest ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("loading")}
          </p>
        ) : null}

        {!loading && workflows.length === 0 && !error ? (
          <div className="rounded-lg border p-10 text-center">
            <WorkflowIcon className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="font-medium text-sm">{t("emptyWorkflows")}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {t("emptyWorkflowsHint")}
            </p>
          </div>
        ) : null}

        {workflows.length > 0 ? (
          <div className="max-h-[calc(100dvh-14rem)] overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/80 text-muted-foreground text-xs backdrop-blur">
                <tr>
                  <th className="px-3 py-2">{t("colWorkflow")}</th>
                  <th className="px-3 py-2">{t("colWorkflowFile")}</th>
                  <th className="px-3 py-2 text-center">{t("colWorkflowSteps")}</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf) => {
                  const stepCount = wf.nodes.filter(
                    (n) => n.data.nodeKind === "step",
                  ).length;
                  return (
                    <tr
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                      key={wf.workflowId}
                      onClick={() => setSelected(wf)}
                    >
                      <td className="px-3 py-2 font-medium">
                        {shortWorkflowName(wf.workflowName)}
                      </td>
                      <td className="max-w-[18rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                        {wf.filePath || "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                          <GitBranchIcon className="size-3" />
                          {stepCount}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {manifest?.sourcePath ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            source: {manifest.sourcePath}
          </p>
        ) : null}

        {manifest ? (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">{t("rawJson")}</summary>
            <pre className="mt-2 max-h-80 overflow-auto font-mono text-xs">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>

      <SidePanel
        onClose={() => setSelected(null)}
        open={selected !== null}
        title={selected?.workflowName ?? t("sectionGraph")}
        wide
      >
        {selected ? (
          <div className="flex h-[min(36rem,70vh)] flex-col gap-2">
            <p className="font-mono text-[11px] text-muted-foreground">
              {selected.filePath || selected.workflowId}
            </p>
            <WorkflowGraphView className="min-h-0 flex-1" workflow={selected} />
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
