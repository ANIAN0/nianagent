import { WorkflowDebugRunPage } from "@/app/_components/workflow-debug/run-client";
import { parseWorkflowDebugAgent } from "@/app/_components/workflow-debug/agent-href";

export default async function WorkflowDebugRunRoute({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const { runId } = await params;
  const sp = await searchParams;
  return (
    <WorkflowDebugRunPage
      initialAgent={parseWorkflowDebugAgent(sp.agent)}
      runId={decodeURIComponent(runId)}
    />
  );
}
