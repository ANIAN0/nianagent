/**
 * 动态 instructions：每 turn 注入 A1 工作区绑定表（system，不污染用户消息流）。
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import type { AgentId } from "./model-catalog";
import { workspaceIdFromAuth } from "./workspace-auth";
import { getBindingByWorkspaceId } from "./workspace-store";
import {
  buildWorkspaceContextMarkdown,
  toPublicRoots,
} from "./workspace-context";

type ResolveCtx = {
  readonly session: {
    readonly auth: {
      readonly current: unknown;
      readonly initiator: unknown;
    };
  };
};

async function resolveWorkspaceMarkdown(
  agentId: AgentId,
  ctx: ResolveCtx,
): Promise<string> {
  const workspaceId =
    workspaceIdFromAuth(
      ctx.session.auth.initiator as Parameters<typeof workspaceIdFromAuth>[0],
    ) ??
    workspaceIdFromAuth(
      ctx.session.auth.current as Parameters<typeof workspaceIdFromAuth>[0],
    );

  if (!workspaceId) {
    return buildWorkspaceContextMarkdown([]);
  }

  try {
    const record = await getBindingByWorkspaceId(workspaceId);
    if (!record || record.revokedAt || record.agentId !== agentId) {
      return buildWorkspaceContextMarkdown([]);
    }
    return buildWorkspaceContextMarkdown(toPublicRoots(record.roots));
  } catch {
    return buildWorkspaceContextMarkdown([]);
  }
}

/** 供各 agent `agent/instructions/workspace-context.ts` 复用。 */
export function createWorkspaceBindingInstructions(agentId: AgentId) {
  const handler = async (_event: unknown, ctx: ResolveCtx) => {
    const markdown = await resolveWorkspaceMarkdown(agentId, ctx);
    return defineInstructions({ markdown });
  };

  return defineDynamic({
    events: {
      "session.started": handler,
      "turn.started": handler,
    },
  });
}
