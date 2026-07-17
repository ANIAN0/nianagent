import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { localDev } from "eve/channels/auth";
import { getModelForAgent, type AgentId } from "./model-catalog";
import { MODEL_SELECTION_HEADER, modelSelectionContext } from "./model-selection";

export function createNianEveChannel(agentId: AgentId) {
  return eveChannel({
    auth: [localDev()],
    onMessage(ctx) {
      const modelId = ctx.eve.request.headers.get(MODEL_SELECTION_HEADER);
      const selected = getModelForAgent(agentId, modelId);

      // 只把服务端白名单内的模型选择写入会话上下文。
      return {
        auth: defaultEveAuth(ctx),
        context: selected ? [modelSelectionContext(selected.id)] : [],
      };
    },
  });
}
