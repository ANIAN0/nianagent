import { defineTool } from "eve/tools";
import { executeEditFileTool } from "@nianagent/agent-core/workspace-tools";
import { EDIT_FILE_TOOL_DESCRIPTION } from "@nianagent/agent-core/workspace-protocol";
import { editFileInputSchema } from "@nianagent/agent-core/edit-file-schema";
import {
  decideSensitiveToolApproval,
  runExecuteTrustBarrier,
} from "@nianagent/agent-core/tool-approval-policy";

/**
 * Claude Code / Keydex 风格局部编辑：精确字符串替换。
 * filePath 用 Eve 逻辑路径；old_string/new_string/replace_all 对齐 Claude Code。
 * new_string="" 删除片段（null/undefined 也会规范成空串）。
 */
export default defineTool({
  description: EDIT_FILE_TOOL_DESCRIPTION,
  inputSchema: editFileInputSchema,
  approval: (ctx) => decideSensitiveToolApproval(ctx, "work-assistant"),
  async execute(input, ctx) {
    await runExecuteTrustBarrier({
      agentId: "work-assistant",
      sessionId: ctx.session.id,
      toolName: ctx.toolName,
      toolInput: input,
      callId: ctx.callId,
      auth: ctx.session.auth,
    });
    return executeEditFileTool({
      agentId: "work-assistant",
      auth: ctx.session.auth,
      args: {
        filePath: input.filePath,
        old_string: input.old_string,
        new_string: input.new_string,
        replace_all: input.replace_all,
      },
    });
  },
});
