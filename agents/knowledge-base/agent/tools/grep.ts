import { defineTool } from "eve/tools";
import { grep as defaultGrep } from "eve/tools/defaults";
import { executeGrepTool } from "@nianagent/agent-core/workspace-tools";

type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  limit?: number;
  context?: number;
};

/**
 * 覆写默认 grep：保留 schema/描述，执行改走宿主 FS（DEF-006）。
 * 不得调用 defaultGrep.execute（其内部依赖 sandbox.run）。
 */
export default defineTool({
  ...defaultGrep,
  async execute(input: GrepInput, ctx) {
    return executeGrepTool({
      agentId: "knowledge-base",
      auth: ctx.session.auth,
      args: {
        pattern: input.pattern,
        path: input.path,
        glob: input.glob,
        ignoreCase: input.ignoreCase,
        literal: input.literal,
        limit: input.limit,
        context: input.context,
      },
      abortSignal: ctx.abortSignal,
    });
  },
});
