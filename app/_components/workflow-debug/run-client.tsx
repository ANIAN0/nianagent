"use client";

import { Suspense } from "react";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { WorkflowDebugAgentProvider } from "./agent-context";
import { DebugShell } from "./components/debug-shell";
import { RunDetail } from "./components/run-detail";
import { t } from "./i18n/zh-CN";

export function WorkflowDebugRunPage({
  runId,
  initialAgent,
}: {
  readonly runId: string;
  readonly initialAgent?: AgentId;
}) {
  return (
    <Suspense fallback={<p className="p-6 text-sm">{t("loading")}</p>}>
      <WorkflowDebugAgentProvider initialAgent={initialAgent}>
        <DebugShell>
          <RunDetail runId={runId} />
        </DebugShell>
      </WorkflowDebugAgentProvider>
    </Suspense>
  );
}
