import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { localDev } from "eve/channels/auth";
import { getModelForAgent, type AgentId } from "./model-catalog";
import { MODEL_SELECTION_HEADER, modelSelectionContext } from "./model-selection";
import {
  resolveWorkspaceAuthFromRequest,
  WorkspaceAuthError,
} from "./workspace-auth";
import { WORKSPACE_CAPABILITY_HEADER } from "./workspace-constants";

export { WORKSPACE_CAPABILITY_HEADER } from "./workspace-constants";

export function createNianEveChannel(agentId: AgentId) {
  return eveChannel({
    auth: [localDev()],
    async onMessage(ctx) {
      const modelId = ctx.eve.request.headers.get(MODEL_SELECTION_HEADER);
      const selected = getModelForAgent(agentId, modelId);
      const baseAuth = defaultEveAuth(ctx);

      try {
        const capability = ctx.eve.request.headers.get(
          WORKSPACE_CAPABILITY_HEADER,
        );
        const { auth } = await resolveWorkspaceAuthFromRequest({
          agentId,
          capabilityHeader: capability,
          baseAuth,
        });

        // 只把服务端白名单内的模型选择写入会话上下文；workspaceId 固化在 auth.attributes。
        return {
          auth,
          context: selected ? [modelSelectionContext(selected.id)] : [],
        };
      } catch (err) {
        if (err instanceof WorkspaceAuthError) {
          // 拒绝创建/续写：抛出可观察错误（不静默 return null）
          throw new Error(`[workspace-auth] ${err.message}`);
        }
        throw err;
      }
    },
  });
}
