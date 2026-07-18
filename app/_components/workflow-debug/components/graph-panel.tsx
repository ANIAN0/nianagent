"use client";

/**
 * Run 详情 Graph tab（P4）：manifest 图 + 执行状态叠加。
 */

import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkflowDebugAgent } from "../agent-context";
import { adaptManifest, findWorkflowGraph } from "../flow-graph/adapt-manifest";
import { buildStepExecStatus } from "../flow-graph/execution-status";
import type { WorkflowGraphManifest } from "../flow-graph/types";
import { WorkflowGraphView } from "../flow-graph/workflow-graph-view";
import { shortWorkflowName } from "../display-utils/workflow-name";
import { workflowDebugRpc } from "../rpc-client";
import { t } from "../i18n/zh-CN";
import type { WorkflowEvent, WorkflowRunLike } from "../trace/types";

export function GraphPanel({
  run,
  events,
}: {
  readonly run: WorkflowRunLike;
  readonly events: readonly WorkflowEvent[];
}) {
  const { agentId } = useWorkflowDebugAgent();
  const [manifest, setManifest] = useState<WorkflowGraphManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await workflowDebugRpc<unknown>(
        agentId,
        "fetchWorkflowsManifest",
        {},
      );
      if (!res.success) {
        setError(res.error.message);
        setManifest(null);
        return;
      }
      setManifest(adaptManifest(res.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const workflowName =
    typeof run.workflowName === "string" ? run.workflowName : undefined;
  const graph = useMemo(
    () => findWorkflowGraph(manifest, workflowName),
    [manifest, workflowName],
  );
  const execStatus = useMemo(() => buildStepExecStatus(events), [events]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
        <Button
          className="h-8"
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="space-y-2 rounded-lg border p-6 text-center">
        <p className="font-medium text-sm">{t("graphNotFound")}</p>
        <p className="text-muted-foreground text-xs">
          {t("graphNotFoundHint").replace(
            "{name}",
            shortWorkflowName(workflowName),
          )}
        </p>
        <p className="text-muted-foreground text-[11px]">
          {t("graphManifestCount").replace(
            "{n}",
            String(Object.keys(manifest?.workflows ?? {}).length),
          )}
        </p>
        <Button
          className="h-8"
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("refresh")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[28rem] flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-sm">{graph.workflowName}</h3>
          {graph.filePath ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              {graph.filePath}
            </p>
          ) : null}
        </div>
        <Button
          className="h-8 text-xs"
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("refresh")}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <WorkflowGraphView
          className="h-[min(32rem,60vh)]"
          execStatus={execStatus}
          workflow={graph}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{t("graphExecLegend")}</p>
    </div>
  );
}
