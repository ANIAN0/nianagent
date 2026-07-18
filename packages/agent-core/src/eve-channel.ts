import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { localDev, type AuthFn } from "eve/channels/auth";
import { getModelForAgent, type AgentId } from "./model-catalog";
import { MODEL_SELECTION_HEADER, modelSelectionContext } from "./model-selection";
import {
  resolveWorkspaceAuthFromRequest,
  WorkspaceAuthError,
  type WorkspaceSessionAuth,
} from "./workspace-auth";
import {
  AUTH_ATTR_ACCEPT_EDITS,
  AUTH_ATTR_GLOBAL_BYPASS,
  SESSION_ACCEPT_EDITS_HEADER,
  SESSION_GLOBAL_BYPASS_HEADER,
  TRUST_SCOPE_HEADER,
  WORKSPACE_CAPABILITY_HEADER,
} from "./workspace-constants";
import { tryRegisterTrustPendingFromRequest } from "./tool-trust-pending";

export {
  WORKSPACE_CAPABILITY_HEADER,
  SESSION_ACCEPT_EDITS_HEADER,
  SESSION_GLOBAL_BYPASS_HEADER,
  TRUST_SCOPE_HEADER,
  TRUST_CALL_ID_HEADER,
  AUTH_ATTR_ACCEPT_EDITS,
  AUTH_ATTR_GLOBAL_BYPASS,
} from "./workspace-constants";

function parseModeHeader01(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (v === "1" || v.toLowerCase() === "true") return true;
  if (v === "0" || v.toLowerCase() === "false") return false;
  // 非法 → 视为关
  return false;
}

/** 从 Eve 路由 URL 提取 sessionId（continue 路径）。 */
function sessionIdFromEveRequest(request: Request): string | undefined {
  try {
    const url = new URL(request.url);
    // /eve/v1/session/:sessionId 或 /eve/v1/session/:sessionId/stream
    const m = url.pathname.match(/\/eve\/v1\/session\/([^/]+)/);
    if (!m) return undefined;
    const id = m[1];
    if (!id || id === "stream") return undefined;
    return decodeURIComponent(id);
  } catch {
    return undefined;
  }
}

/**
 * 在 Eve 消费 body 前 clone 登记信任 pending。
 * 纯 inputResponses 路径不调用 onMessage，必须在 auth 链窥探。
 * 始终 return null 以落入后续 localDev。
 */
function trustPendingPeekAuth(agentId: AgentId): AuthFn<Request> {
  return async (request) => {
    const sessionId = sessionIdFromEveRequest(request);
    await tryRegisterTrustPendingFromRequest({
      request,
      agentId,
      sessionId,
    });
    return null;
  };
}

function applyModeBootstrapAttributes(
  auth: WorkspaceSessionAuth,
  request: Request,
): WorkspaceSessionAuth {
  const accept = parseModeHeader01(
    request.headers.get(SESSION_ACCEPT_EDITS_HEADER),
  );
  const bypass = parseModeHeader01(
    request.headers.get(SESSION_GLOBAL_BYPASS_HEADER),
  );
  if (accept === undefined && bypass === undefined) {
    return auth;
  }
  return {
    ...auth,
    attributes: {
      ...auth.attributes,
      ...(accept !== undefined
        ? { [AUTH_ATTR_ACCEPT_EDITS]: accept ? "1" : "0" }
        : {}),
      ...(bypass !== undefined
        ? { [AUTH_ATTR_GLOBAL_BYPASS]: bypass ? "1" : "0" }
        : {}),
    },
  };
}

export function createNianEveChannel(agentId: AgentId) {
  return eveChannel({
    auth: [trustPendingPeekAuth(agentId), localDev()],
    // 浏览器跨端口访问 Eve 时需放行自定义头（capability / 模式 / 信任）
    cors: true,
    async onMessage(ctx) {
      const modelId = ctx.eve.request.headers.get(MODEL_SELECTION_HEADER);
      const selected = getModelForAgent(agentId, modelId);
      const baseAuth = defaultEveAuth(ctx);

      try {
        const capability = ctx.eve.request.headers.get(
          WORKSPACE_CAPABILITY_HEADER,
        );
        const { auth: workspaceAuth } = await resolveWorkspaceAuthFromRequest({
          agentId,
          capabilityHeader: capability,
          baseAuth,
        });

        // 模式意图头 → initiator/current auth 引导（D-008）；无 sessionId 时不写 Turso。
        // 信任 pending 仅在 auth 链 trustPendingPeekAuth 登记（纯 inputResponses 不进 onMessage）。
        const auth = applyModeBootstrapAttributes(
          workspaceAuth,
          ctx.eve.request,
        );

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
