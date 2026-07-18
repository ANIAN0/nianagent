import { WorkflowDebugStreamPage } from "@/app/_components/workflow-debug/stream-client";
import { parseWorkflowDebugAgent } from "@/app/_components/workflow-debug/agent-href";

export default async function WorkflowDebugStreamRoute({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string; streamId: string }>;
  searchParams: Promise<{ agent?: string }>;
}) {
  const { runId, streamId } = await params;
  const sp = await searchParams;
  return (
    <WorkflowDebugStreamPage
      initialAgent={parseWorkflowDebugAgent(sp.agent)}
      runId={decodeURIComponent(runId)}
      streamId={decodeURIComponent(streamId)}
    />
  );
}
