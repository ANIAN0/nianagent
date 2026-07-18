/**
 * 敏感工具审批策略（F-004 顺序；D-001/D-003/D-005/D-007/D-008）。
 * 禁止：pending 放行、approvedTools 自动 once、默认 approved。
 */
import type { ApprovalContext, ApprovalStatus } from "eve/tools";
import type { AgentId } from "./model-catalog";
import {
  AUTH_ATTR_ACCEPT_EDITS,
  AUTH_ATTR_GLOBAL_BYPASS,
  WORKSPACE_ID_ATTR,
} from "./workspace-constants";
import {
  getBindingByWorkspaceId,
  WorkspaceStoreError,
} from "./workspace-store";
import {
  getSessionPermissionReadonly,
  getToolTrustRuleByIdReadonly,
  getToolTrustRulesEpochReadonly,
  listEnabledRulesReadonly,
  isTrustableToolName,
} from "./tool-trust-store";
import {
  bareToolName,
  commitTrustBeforeExecute,
  hasHotSessionGrant,
  listHotRules,
  removeHotRule,
  ruleMatchesToolInput,
} from "./tool-trust-pending";

const ACCEPT_EDITS_TOOLS = new Set(["write_file", "edit_file"]);

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

function isTruthy01(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

/** 首 turn：Eve SessionTurn.sequence 零基，首轮为 0。 */
export function isFirstSessionTurn(sequence: number | undefined): boolean {
  return sequence === 0;
}

/**
 * 统一 decide：归属 → 热缓存 → DB 会话行 → 首 turn 引导 → DB 规则 → user-approval。
 * 显式忽略 ctx.approvedTools（D-003）。
 */
export async function decideSensitiveToolApproval(
  ctx: ApprovalContext,
  agentId: AgentId,
): Promise<ApprovalStatus> {
  // D-003：不得用 approvedTools 冒充本会话授权
  void ctx.approvedTools;

  const bare = bareToolName(ctx.toolName);
  const initiator = ctx.session.auth.initiator;
  const workspaceId = attrString(initiator?.attributes, WORKSPACE_ID_ATTR);

  if (!workspaceId) {
    return {
      type: "denied",
      reason: "会话未绑定工作区，拒绝敏感工具。",
    };
  }

  let binding;
  try {
    binding = await getBindingByWorkspaceId(workspaceId);
  } catch (err) {
    if (err instanceof WorkspaceStoreError) {
      return {
        type: "denied",
        reason: `读取工作区 binding 失败：${err.message}`,
      };
    }
    throw err;
  }

  if (!binding || binding.revokedAt || binding.agentId !== agentId) {
    return {
      type: "denied",
      reason: "工作区 binding 无效、已撤销或不属于当前 Agent。",
    };
  }

  const sessionId = ctx.session.id;
  const toolInput = ctx.toolInput;

  // 1) 热缓存 session grant（会话 grant 不受管理页规则禁用影响）
  if (
    isTrustableToolName(bare) &&
    hasHotSessionGrant({
      sessionId,
      workspaceId,
      agentId,
      toolName: bare,
    })
  ) {
    return { type: "approved", reason: "session_grant_hot" };
  }

  // 2) DB 会话行（三元组一致才信）
  const state = await getSessionPermissionReadonly(
    sessionId,
    workspaceId,
    agentId,
  );
  if (state) {
    if (state.globalBypass) {
      return { type: "approved", reason: "global_bypass" };
    }
    if (state.acceptEdits && ACCEPT_EDITS_TOOLS.has(bare)) {
      return { type: "approved", reason: "accept_edits" };
    }
    if (state.sessionToolGrants.includes(bare)) {
      return { type: "approved", reason: "session_grant" };
    }
  } else if (isFirstSessionTurn(ctx.session.turn.sequence)) {
    // 3) 无行且首 turn：initiator 模式引导（无 grants）
    const bootstrapAccept = isTruthy01(
      attrString(initiator?.attributes, AUTH_ATTR_ACCEPT_EDITS),
    );
    const bootstrapBypass = isTruthy01(
      attrString(initiator?.attributes, AUTH_ATTR_GLOBAL_BYPASS),
    );
    if (bootstrapBypass) {
      return { type: "approved", reason: "bootstrap_global_bypass" };
    }
    if (bootstrapAccept && ACCEPT_EDITS_TOOLS.has(bare)) {
      return { type: "approved", reason: "bootstrap_accept_edits" };
    }
  }

  // 4) DB enabled 规则 exact 匹配（权威；禁用/删除后只读即不命中）
  if (isTrustableToolName(bare)) {
    const rules = await listEnabledRulesReadonly(workspaceId, agentId, bare);
    for (const rule of rules) {
      if (ruleMatchesToolInput(rule, toolInput)) {
        return { type: "approved", reason: "persistent_rule" };
      }
    }
  }

  // 5) 热缓存规则：仅桥接同 turn 写后可见性窗口；必须通过 epoch + 行状态复核
  if (isTrustableToolName(bare)) {
    const dbEpoch = await getToolTrustRulesEpochReadonly(workspaceId, agentId);
    for (const rule of listHotRules(workspaceId, agentId, bare, dbEpoch)) {
      if (!ruleMatchesToolInput(rule, toolInput)) continue;

      // 行级复核：已禁用/删除不得继续 hot 放行
      const live = await getToolTrustRuleByIdReadonly(rule.id);
      if (live) {
        if (
          live.workspaceId === workspaceId &&
          live.agentId === agentId &&
          live.enabled &&
          ruleMatchesToolInput(live, toolInput)
        ) {
          return { type: "approved", reason: "persistent_rule_hot" };
        }
        // 存在但不可用（禁用或内容不匹配）
        removeHotRule(workspaceId, agentId, rule.id);
        continue;
      }

      // 库中无此 id：可能是刚固化可见性滞后，或已硬删除。
      // epoch 桶已保证「删除后世代升高 → 整桶清空」；此处仅允许同世代窗口。
      return { type: "approved", reason: "persistent_rule_hot" };
    }
  }

  // 6) 默认 HITL（禁止 pending 放行）
  return "user-approval";
}

/**
 * execute 屏障前置：从 auth 解析 workspaceId，再按 callId 精确 commit 信任。
 * 失败不抛（不阻断已批准执行）。
 */
export async function runExecuteTrustBarrier(input: {
  readonly agentId: AgentId;
  readonly sessionId: string;
  readonly toolName: string;
  readonly toolInput: unknown;
  /** Eve ToolContext.callId，与审批 requestId/approvalId 对齐 */
  readonly callId: string;
  readonly auth: {
    readonly initiator?: {
      readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
    } | null;
    readonly current?: {
      readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
    } | null;
  };
}): Promise<void> {
  const workspaceId =
    attrString(input.auth.initiator?.attributes, WORKSPACE_ID_ATTR) ??
    attrString(input.auth.current?.attributes, WORKSPACE_ID_ATTR);
  if (!workspaceId) return;

  await commitTrustBeforeExecute({
    sessionId: input.sessionId,
    agentId: input.agentId,
    workspaceId,
    toolName: input.toolName,
    toolInput: input.toolInput,
    callId: input.callId,
  });
}
