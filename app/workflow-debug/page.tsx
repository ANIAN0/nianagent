import { WorkflowDebugHome } from "@/app/_components/workflow-debug/home-client";
import { parseWorkflowDebugAgent } from "@/app/_components/workflow-debug/agent-href";

export default async function WorkflowDebugPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const sp = await searchParams;
  return (
    <WorkflowDebugHome initialAgent={parseWorkflowDebugAgent(sp.agent)} />
  );
}
