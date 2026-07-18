/**
 * 从 events 推导 step 节点执行状态（简化版 graph-execution-mapper）。
 */

import { isStepEventType } from "../trace/event-types";
import type { WorkflowEvent } from "../trace/types";
import type { NodeExecStatus } from "./types";

export function buildStepExecStatus(
  events: readonly WorkflowEvent[],
): Map<string, NodeExecStatus> {
  const map = new Map<string, NodeExecStatus>();

  for (const ev of events) {
    if (!isStepEventType(ev.eventType)) continue;
    const id = ev.correlationId;
    if (!id) continue;

    switch (ev.eventType) {
      case "step_created":
        if (!map.has(id) || map.get(id) === "unknown") {
          map.set(id, "pending");
        }
        break;
      case "step_started":
      case "step_retrying":
        map.set(id, "running");
        break;
      case "step_completed":
        map.set(id, "completed");
        break;
      case "step_failed":
        map.set(id, "failed");
        break;
    }
  }

  return map;
}
