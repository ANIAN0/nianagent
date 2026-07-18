import { defineTool } from "eve/tools";
import { z } from "zod";
import { executePowerShellTool } from "@nianagent/agent-core/workspace-tools";
import { POWERSHELL_TOOL_DESCRIPTION } from "@nianagent/agent-core/workspace-protocol";
import {
  decideSensitiveToolApproval,
  runExecuteTrustBarrier,
} from "@nianagent/agent-core/tool-approval-policy";

export default defineTool({
  description: POWERSHELL_TOOL_DESCRIPTION,
  inputSchema: z.object({
    command: z
      .string()
      .min(1)
      .describe(
        "PowerShell 命令正文。cwd 已是绑定目录时优先相对路径（如 Get-ChildItem）。禁止写 /workspace/...",
      ),
    cwd: z
      .string()
      .min(1)
      .describe("逻辑工作目录：/workspace/<alias> 或 /workspace/<alias>/子目录"),
    description: z
      .string()
      .min(1)
      .describe("一句话说明为何运行该命令，将显示在用户审批卡上"),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(600_000)
      .optional()
      .describe("超时毫秒，默认 120000，最大 600000"),
  }),
  approval: (ctx) => decideSensitiveToolApproval(ctx, "knowledge-base"),
  async execute(input, ctx) {
    await runExecuteTrustBarrier({
      agentId: "knowledge-base",
      sessionId: ctx.session.id,
      toolName: ctx.toolName,
      toolInput: input,
      callId: ctx.callId,
      auth: ctx.session.auth,
    });
    return executePowerShellTool({
      agentId: "knowledge-base",
      auth: ctx.session.auth,
      command: input.command,
      cwdLogical: input.cwd,
      timeoutMs: input.timeoutMs,
      abortSignal: ctx.abortSignal,
    });
  },
});
