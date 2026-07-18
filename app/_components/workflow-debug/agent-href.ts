import type { AgentId } from "@nianagent/agent-core/model-catalog";

/** 两个 Agent 各持有独立 Eve Workflow World，调试 URL 必须带 agent。 */
export function parseWorkflowDebugAgent(
  value: string | null | undefined,
): AgentId | undefined {
  if (value === "work-assistant" || value === "knowledge-base") {
    return value;
  }
  return undefined;
}

/**
 * 给 workflow-debug 路径补上/覆盖 `agent` 查询参数，避免深链落到默认 Agent 后 not found。
 * @param href 如 `/workflow-debug`、`/workflow-debug/wrun_x?sidebar=hook`
 */
export function withWorkflowDebugAgent(
  href: string,
  agentId: AgentId,
): string {
  const qIndex = href.indexOf("?");
  const path = qIndex >= 0 ? href.slice(0, qIndex) : href;
  const params = new URLSearchParams(qIndex >= 0 ? href.slice(qIndex + 1) : "");
  params.set("agent", agentId);
  return `${path}?${params.toString()}`;
}

export function otherWorkflowDebugAgent(agentId: AgentId): AgentId {
  return agentId === "work-assistant" ? "knowledge-base" : "work-assistant";
}
