import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { writeFile as defaultWriteFile } from "eve/tools/defaults";
import { loadRootsForToolContext, assertPathInBinding } from "@nianagent/agent-core/workspace-tools";

/**
 * 覆写 write_file：durable approval + 路径 containment。
 * Eve schema 字段为 filePath（不是 path）；真正写入走 host-workspace sandbox。
 * 注意：Eve 对已存在文件要求先 read_file，再允许整文件覆写。
 * 局部修改请用 edit_file（Claude Code 风格 old_string/new_string）。
 */
export default defineTool({
  ...defaultWriteFile,
  approval: always(),
  async execute(input: { filePath: string; content: string }, ctx) {
    const auth = ctx.session.auth;
    const { roots } = await loadRootsForToolContext({
      agentId: "knowledge-base",
      auth,
    });
    await assertPathInBinding(input.filePath, roots);
    return defaultWriteFile.execute(input, ctx);
  },
});
