import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent, defineDynamic } from "eve";
import {
  getDefaultModel,
  getModelForAgent,
  modelIdFromMessages,
  type AgentId,
} from "./model-catalog";

const provider = createOpenAICompatible({
  name: "nianagent-openai-compatible",
  baseURL: process.env.OPENAI_BASE_URL!,
  apiKey: process.env.OPENAI_API_KEY!,
});

export function createNianAgent(agentId: AgentId) {
  const fallback = getDefaultModel();

  return defineAgent({
    model: defineDynamic({
      fallback: provider(fallback.providerModelId),
      events: {
        // OpenAI-compatible Provider 返回实时模型对象，只能在 step 作用域切换。
        "step.started": (_event, ctx) => {
          const modelId = modelIdFromMessages(ctx.messages);
          const selected = getModelForAgent(agentId, modelId);
          if (!selected) return null;

          return {
            model: provider(selected.providerModelId),
            modelContextWindowTokens: selected.contextWindowTokens,
          };
        },
      },
    }),
    modelContextWindowTokens: fallback.contextWindowTokens,
  });
}
