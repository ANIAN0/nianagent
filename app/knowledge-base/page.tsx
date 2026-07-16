import { AgentChat } from "@/app/_components/agent-chat";
import { getPublicModelsForAgent } from "@nianagent/agent-core/model-catalog";

export default function KnowledgeBasePage() {
  return (
    <AgentChat
      agentId="knowledge-base"
      models={getPublicModelsForAgent("knowledge-base")}
    />
  );
}
