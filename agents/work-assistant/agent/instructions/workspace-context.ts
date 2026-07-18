import { createWorkspaceBindingInstructions } from "@nianagent/agent-core/workspace-instructions";

/** 每 session/turn 注入 A1 绑定表（system）。 */
export default createWorkspaceBindingInstructions("work-assistant");
