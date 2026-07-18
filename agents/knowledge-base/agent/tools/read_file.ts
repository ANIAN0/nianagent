import { defineTool } from "eve/tools";
import { readFile as defaultReadFile } from "eve/tools/defaults";
import { loadRootsForToolContext, assertPathInBinding } from "@nianagent/agent-core/workspace-tools";

/**
 * 读文件前做 binding auth + 路径 containment。
 * Eve schema 字段为 filePath（不是 path）；错用 path 会得到 undefined 并在 normalize 时 trim 崩溃。
 */
export default defineTool({
  ...defaultReadFile,
  async execute(input: { filePath: string; offset?: number; limit?: number }, ctx) {
    const { roots } = await loadRootsForToolContext({
      agentId: "knowledge-base",
      auth: ctx.session.auth,
    });
    await assertPathInBinding(input.filePath, roots);
    return defaultReadFile.execute(input, ctx);
  },
});
