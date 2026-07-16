import { AgentChat } from "@/app/_components/agent-chat";
import { getPublicModelsForAgent } from "@nianagent/agent-core/model-catalog";

export default function WorkAssistantPage() {
  return (
    <AgentChat
      agentId="work-assistant"
      models={getPublicModelsForAgent("work-assistant")}
    />
  );
}
