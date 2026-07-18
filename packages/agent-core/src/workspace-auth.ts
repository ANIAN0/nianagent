import type { AgentId } from "./model-catalog";
import {
  digestCapability,
  getBindingByCapabilityDigest,
} from "./workspace-store";
import { WorkspaceStoreError } from "./workspace-binding";
import {
  WORKSPACE_CAPABILITY_HEADER,
  WORKSPACE_ID_ATTR,
} from "./workspace-constants";

export {
  WORKSPACE_CAPABILITY_HEADER,
  WORKSPACE_ID_ATTR,
} from "./workspace-constants";

/** 与 Eve SessionAuthContext 兼容的最小形状（避免依赖未公开的 type 路径）。 */
export type WorkspaceSessionAuth = {
  readonly attributes: Readonly<Record<string, string | readonly string[]>>;
  readonly authenticator: string;
  readonly issuer?: string;
  readonly principalId: string;
  readonly principalType: string;
  readonly subject?: string;
};

export class WorkspaceAuthError extends Error {
  readonly code:
    | "missing_capability"
    | "invalid_capability"
    | "agent_mismatch"
    | "revoked"
    | "workspace_mismatch";

  constructor(code: WorkspaceAuthError["code"], message: string) {
    super(message);
    this.name = "WorkspaceAuthError";
    this.code = code;
  }
}

function attrString(
  attributes: Readonly<Record<string, string | readonly string[]>> | undefined,
  key: string,
): string | undefined {
  if (!attributes) return undefined;
  const v = attributes[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export function workspaceIdFromAuth(
  auth: WorkspaceSessionAuth | null | undefined,
): string | undefined {
  if (!auth) return undefined;
  return attrString(auth.attributes, WORKSPACE_ID_ATTR);
}

/**
 * 校验 capability header，返回绑定的 workspaceId 与可写入 initiator/current 的 auth。
 * 库中仅 digest；明文 capability 不落库。
 */
export async function resolveWorkspaceAuthFromRequest(input: {
  readonly agentId: AgentId;
  readonly capabilityHeader: string | null;
  readonly baseAuth: WorkspaceSessionAuth | null;
}): Promise<{
  readonly workspaceId: string;
  readonly auth: WorkspaceSessionAuth;
}> {
  const raw = input.capabilityHeader?.trim() ?? "";
  if (!raw) {
    throw new WorkspaceAuthError(
      "missing_capability",
      "缺少工作区 capability 请求头。请先在页面绑定工作目录。",
    );
  }

  const digest = digestCapability(raw);
  let record;
  try {
    record = await getBindingByCapabilityDigest(digest);
  } catch (err) {
    if (err instanceof WorkspaceStoreError) {
      throw new WorkspaceAuthError(
        "invalid_capability",
        `无法校验 capability：${err.message}`,
      );
    }
    throw err;
  }

  if (!record) {
    throw new WorkspaceAuthError(
      "invalid_capability",
      "capability 无效或不存在。",
    );
  }
  if (record.revokedAt) {
    throw new WorkspaceAuthError(
      "revoked",
      "该工作区 binding 已撤销。",
    );
  }
  if (record.agentId !== input.agentId) {
    throw new WorkspaceAuthError(
      "agent_mismatch",
      `capability 不属于当前 Agent（期望 ${input.agentId}）。`,
    );
  }

  const base = input.baseAuth;
  const auth: WorkspaceSessionAuth = {
    authenticator: base?.authenticator ?? "nianagent-workspace",
    principalId: base?.principalId ?? `workspace:${record.workspaceId}`,
    principalType: base?.principalType ?? "user",
    issuer: base?.issuer,
    subject: base?.subject,
    attributes: {
      ...(base?.attributes ?? {}),
      [WORKSPACE_ID_ATTR]: record.workspaceId,
    },
  };

  return { workspaceId: record.workspaceId, auth };
}

/**
 * 工具/sandbox：initiator 上的 workspaceId 必须存在，且与期望 id 一致。
 */
export function assertWorkspaceIdMatch(
  expected: string | undefined,
  actual: string | undefined,
  label: string,
): asserts actual is string {
  if (!actual) {
    throw new WorkspaceAuthError(
      "workspace_mismatch",
      `${label}：会话未绑定 workspaceId。`,
    );
  }
  if (!expected || expected !== actual) {
    throw new WorkspaceAuthError(
      "workspace_mismatch",
      `${label}：workspaceId 不一致，拒绝操作。`,
    );
  }
}
