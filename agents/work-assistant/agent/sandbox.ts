import { defineSandbox } from "eve/sandbox";
import { createHostWorkspaceBackend } from "@nianagent/agent-core/host-workspace-sandbox";
import { workspaceIdFromAuth } from "@nianagent/agent-core/workspace-auth";

export default defineSandbox({
  backend: createHostWorkspaceBackend("work-assistant"),
  async onSession({ ctx, use }) {
    // 仅首次（initialized === false）运行：从不可变 initiator auth 取 workspaceId
    const workspaceId =
      workspaceIdFromAuth(ctx.session.auth.initiator) ??
      workspaceIdFromAuth(ctx.session.auth.current);
    if (!workspaceId) {
      // 保持未绑定；工具侧会拒绝宿主操作
      return;
    }
    await use({ workspaceId });
  },
});
