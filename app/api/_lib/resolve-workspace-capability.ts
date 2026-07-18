/**
 * 信任/会话权限 API 共用：用 capability + agentId 解析并校验 workspace binding。
 * 不回显明文 capability；失败时返回已构造的 JSON 响应。
 */
import { NextResponse } from "next/server";
import { AGENT_IDS, type AgentId } from "@nianagent/agent-core/model-catalog";
import {
  digestCapability,
  getBindingByCapabilityDigest,
  WorkspaceStoreError,
} from "@nianagent/agent-core/workspace-store";
import type { WorkspaceBindingRecord } from "@nianagent/agent-core/workspace-binding";
import type { ToolTrustStoreError } from "@nianagent/agent-core/tool-trust-store";

export function isAgentId(value: unknown): value is AgentId {
  return (
    typeof value === "string" &&
    (AGENT_IDS as readonly string[]).includes(value)
  );
}

export function toolTrustHttpStatus(
  code: ToolTrustStoreError["code"],
): number {
  switch (code) {
    case "invalid_session":
    case "invalid_agent":
    case "invalid_tool":
    case "invalid_pattern":
    case "overbroad_rule":
      return 400;
    case "triple_mismatch":
      return 403;
    case "conflict":
      return 409;
    case "not_found":
      return 404;
    case "database_error":
    default:
      return 500;
  }
}

export type ResolveWorkspaceCapabilityResult =
  | { ok: true; agentId: AgentId; binding: WorkspaceBindingRecord }
  | { ok: false; response: NextResponse };

/**
 * 校验 agentId 与 capability，返回未撤销且归属匹配的 binding。
 */
export async function resolveWorkspaceCapability(input: {
  readonly agentId: unknown;
  readonly capability: string;
}): Promise<ResolveWorkspaceCapabilityResult> {
  if (!isAgentId(input.agentId)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "invalid_agent",
            message: `agentId 必须是 ${AGENT_IDS.join(" | ")} 之一。`,
          },
        },
        { status: 400 },
      ),
    };
  }
  const capability = input.capability.trim();
  if (!capability) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "missing_capability", message: "缺少 capability。" } },
        { status: 401 },
      ),
    };
  }

  try {
    const digest = digestCapability(capability);
    const binding = await getBindingByCapabilityDigest(digest);
    if (!binding) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: {
              code: "invalid_capability",
              message: "capability 无效或不存在。",
            },
          },
          { status: 401 },
        ),
      };
    }
    if (binding.revokedAt) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: "revoked", message: "该工作区 binding 已撤销。" } },
          { status: 403 },
        ),
      };
    }
    if (binding.agentId !== input.agentId) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: {
              code: "agent_mismatch",
              message: `capability 不属于当前 Agent（期望 ${input.agentId}）。`,
            },
          },
          { status: 403 },
        ),
      };
    }
    return { ok: true, agentId: input.agentId, binding };
  } catch (err) {
    if (err instanceof WorkspaceStoreError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.code === "database_error" ? 500 : 400 },
        ),
      };
    }
    throw err;
  }
}

/** 从 query / 自定义头读取 capability（优先头，避免写入访问日志）。 */
export function readCapabilityFromRequest(
  request: Request,
  queryValue?: string | null,
): string {
  const header =
    request.headers.get("x-nianagent-workspace-capability")?.trim() ?? "";
  if (header) return header;
  return queryValue?.trim() ?? "";
}
