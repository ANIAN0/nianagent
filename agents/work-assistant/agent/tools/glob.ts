import { defineTool } from "eve/tools";
import { glob as defaultGlob } from "eve/tools/defaults";
import { executeGlobTool } from "@nianagent/agent-core/workspace-tools";

type GlobInput = {
  pattern: string;
  path?: string;
  limit?: number;
};

/**
 * 覆写默认 glob：保留 schema/描述，执行改走宿主 FS（DEF-006）。
 * 不得调用 defaultGlob.execute（其内部依赖 sandbox.run）。
 */
export default defineTool({
  ...defaultGlob,
  async execute(input: GlobInput, ctx) {
    return executeGlobTool({
      agentId: "work-assistant",
      auth: ctx.session.auth,
      args: {
        pattern: input.pattern,
        path: input.path,
        limit: input.limit,
      },
      abortSignal: ctx.abortSignal,
    });
  },
});
