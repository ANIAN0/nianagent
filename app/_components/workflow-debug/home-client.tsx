"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { AgentId } from "@nianagent/agent-core/model-catalog";
import { WorkflowDebugAgentProvider } from "./agent-context";
import { DebugShell } from "./components/debug-shell";
import { RunsPanel } from "./components/runs-panel";
import { HooksPanel } from "./components/hooks-panel";
import { WorkflowsPanel } from "./components/workflows-panel";
import { t } from "./i18n/zh-CN";

function HomeInner({ initialAgent }: { readonly initialAgent?: AgentId }) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "runs";

  return (
    <WorkflowDebugAgentProvider initialAgent={initialAgent}>
      <DebugShell>
        <div className="mb-4 rounded-lg border bg-muted/20 px-3 py-2 text-muted-foreground text-xs leading-relaxed">
          <span className="font-medium text-foreground">{t("appTitle")}</span>
          {" · "}
          {t("surfaceRuns")} / {t("surfaceHooks")} / {t("surfaceWorkflows")}
          {" · "}
          {t("surfaceRunDetail")}（{t("surfaceTrace")} / {t("surfaceStream")} /{" "}
          {t("surfaceActions")}）
        </div>
        {tab === "hooks" ? (
          <HooksPanel />
        ) : tab === "workflows" ? (
          <WorkflowsPanel />
        ) : (
          <RunsPanel />
        )}
      </DebugShell>
    </WorkflowDebugAgentProvider>
  );
}

export function WorkflowDebugHome({
  initialAgent,
}: {
  readonly initialAgent?: AgentId;
}) {
  return (
    <Suspense fallback={<p className="p-6 text-sm">{t("loading")}</p>}>
      <HomeInner initialAgent={initialAgent} />
    </Suspense>
  );
}
