"use client";

import { Suspense } from "react";
import Link from "next/link";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { Button } from "@/components/ui/button";
import { withWorkflowDebugAgent } from "./agent-href";
import {
  WorkflowDebugAgentProvider,
  useWorkflowDebugAgent,
} from "./agent-context";
import { DebugShell } from "./components/debug-shell";
import { StreamViewer } from "./components/stream-viewer";
import { t } from "./i18n/zh-CN";

function StreamInner({
  runId,
  streamId,
}: {
  readonly runId: string;
  readonly streamId: string;
}) {
  const { agentId } = useWorkflowDebugAgent();
  const runHref = withWorkflowDebugAgent(
    `/workflow-debug/${encodeURIComponent(runId)}?tab=streams&streamId=${encodeURIComponent(streamId)}`,
    agentId,
  );
  const runsHref = withWorkflowDebugAgent("/workflow-debug", agentId);

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-4">
      <nav aria-label="breadcrumb" className="text-muted-foreground text-xs">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link
              className="underline-offset-2 hover:underline hover:text-foreground"
              href={runsHref}
            >
              {t("tabRuns")}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              className="font-mono underline-offset-2 hover:underline hover:text-foreground"
              href={runHref}
            >
              {runId}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="font-mono text-foreground text-[11px]">{streamId}</li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">
            {t("streamPageTitle")}
          </h2>
          <p className="font-mono text-muted-foreground text-xs">{streamId}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild className="h-8 text-xs" size="sm" variant="outline">
            <Link href={runHref}>{t("runDetail")}</Link>
          </Button>
          <Button asChild className="h-8 text-xs" size="sm" variant="ghost">
            <Link href={runsHref}>{t("backToRuns")}</Link>
          </Button>
        </div>
      </div>

      <StreamViewer
        className="min-h-[min(36rem,70vh)] flex-1"
        live
        runId={runId}
        streamId={streamId}
      />
    </div>
  );
}

export function WorkflowDebugStreamPage({
  runId,
  streamId,
  initialAgent,
}: {
  readonly runId: string;
  readonly streamId: string;
  readonly initialAgent?: AgentId;
}) {
  return (
    <Suspense fallback={<p className="p-6 text-sm">{t("loading")}</p>}>
      <WorkflowDebugAgentProvider initialAgent={initialAgent}>
        <DebugShell>
          <StreamInner runId={runId} streamId={streamId} />
        </DebugShell>
      </WorkflowDebugAgentProvider>
    </Suspense>
  );
}
