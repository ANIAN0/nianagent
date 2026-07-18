import { defineTool } from "eve/tools";
import { writeFile as defaultWriteFile } from "eve/tools/defaults";
import { loadRootsForToolContext, assertPathInBinding } from "@nianagent/agent-core/workspace-tools";
import {
  decideSensitiveToolApproval,
  runExecuteTrustBarrier,
} from "@nianagent/agent-core/tool-approval-policy";

/**
 * 覆写 write_file：策略审批 + execute 屏障固化 + 路径 containment。
 * Eve schema 字段为 filePath（不是 path）；真正写入走 host-workspace sandbox。
 * 注意：Eve 对已存在文件要求先 read_file，再允许整文件覆写。
 * 局部修改请用 edit_file（Claude Code 风格 old_string/new_string）。
 */
export default defineTool({
  ...defaultWriteFile,
  approval: (ctx) => decideSensitiveToolApproval(ctx, "work-assistant"),
  async execute(input: { filePath: string; content: string }, ctx) {
    await runExecuteTrustBarrier({
      agentId: "work-assistant",
      sessionId: ctx.session.id,
      toolName: ctx.toolName,
      toolInput: input,
      callId: ctx.callId,
      auth: ctx.session.auth,
    });
    const auth = ctx.session.auth;
    const { roots } = await loadRootsForToolContext({
      agentId: "work-assistant",
      auth,
    });
    await assertPathInBinding(input.filePath, roots);
    return defaultWriteFile.execute(input, ctx);
  },
});
