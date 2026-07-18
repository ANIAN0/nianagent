import type { AgentId } from "./model-catalog";
import {
  assertWorkspaceIdMatch,
  workspaceIdFromAuth,
  WorkspaceAuthError,
} from "./workspace-auth";
import {
  getBindingByWorkspaceId,
  WorkspaceStoreError,
} from "./workspace-store";
import type { WorkspaceRoot } from "./workspace-binding";
import {
  resolveWorkspacePath,
  WorkspacePathError,
} from "./workspace-paths";
import {
  runHostPowerShell,
  PowerShellError,
  POWERSHELL_DEFAULT_TIMEOUT_MS,
  POWERSHELL_MAX_TIMEOUT_MS,
} from "./host-powershell";
import {
  assertPowerShellCommandProtocol,
} from "./workspace-command-guard";
import type { WorkspacePathPreview } from "./workspace-protocol";
import { toPublicRoots } from "./workspace-context";
import {
  executeHostGlob,
  executeHostGrep,
  type HostGlobInput,
  type HostGrepInput,
} from "./host-workspace-search";
import {
  executeHostEditFile,
  type HostEditFileInput,
} from "./host-workspace-edit";

type AuthLike = {
  readonly current?: { readonly attributes?: Readonly<Record<string, string | readonly string[]>> } | null;
  readonly initiator?: { readonly attributes?: Readonly<Record<string, string | readonly string[]>> } | null;
};

/**
 * 从 tool ctx.session.auth 取出不可变 initiator workspaceId，并加载 roots。
 * 同时校验 current 与 initiator 一致（若 current 带 workspaceId）。
 */
export async function loadRootsForToolContext(input: {
  readonly agentId: AgentId;
  readonly auth: AuthLike;
}): Promise<{ workspaceId: string; roots: readonly WorkspaceRoot[] }> {
  const initiatorId = workspaceIdFromAuth(
    (input.auth.initiator ?? null) as Parameters<typeof workspaceIdFromAuth>[0],
  );
  const currentId = workspaceIdFromAuth(
    (input.auth.current ?? null) as Parameters<typeof workspaceIdFromAuth>[0],
  );

  if (!initiatorId) {
    throw new WorkspaceAuthError(
      "workspace_mismatch",
      "会话 initiator 未绑定 workspaceId，拒绝工具执行。",
    );
  }
  if (currentId) {
    assertWorkspaceIdMatch(initiatorId, currentId, "工具 auth");
  }

  let record;
  try {
    record = await getBindingByWorkspaceId(initiatorId);
  } catch (err) {
    if (err instanceof WorkspaceStoreError) {
      throw new WorkspaceAuthError(
        "invalid_capability",
        `读取 binding 失败：${err.message}`,
      );
    }
    throw err;
  }
  if (!record || record.revokedAt || record.agentId !== input.agentId) {
    throw new WorkspaceAuthError(
      "workspace_mismatch",
      "workspace binding 无效、已撤销或 agent 不匹配。",
    );
  }
  return { workspaceId: record.workspaceId, roots: record.roots };
}

/** 路径 containment 预检：失败则抛错且不启动宿主副作用。 */
export async function assertPathInBinding(
  logicalPath: string,
  roots: readonly WorkspaceRoot[],
): Promise<string> {
  try {
    const resolved = await resolveWorkspacePath(logicalPath, roots);
    return resolved.hostPath;
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new Error(`路径拒绝：${err.message}`);
    }
    throw err;
  }
}

/**
 * 审批 UI 与执行共用：逻辑路径 → 宿主路径预览（含 displayRoot）。
 */
export async function previewWorkspaceLogicalPath(input: {
  readonly agentId: AgentId;
  readonly auth: AuthLike;
  readonly logicalPath: string;
}): Promise<WorkspacePathPreview> {
  const { roots } = await loadRootsForToolContext({
    agentId: input.agentId,
    auth: input.auth,
  });
  try {
    const resolved = await resolveWorkspacePath(input.logicalPath, roots);
    return {
      alias: resolved.alias,
      logicalPath: resolved.logicalPath,
      hostPath: resolved.hostPath,
      displayRoot: resolved.root.displayPath,
    };
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new Error(`路径预览拒绝：${err.message}`);
    }
    throw err;
  }
}

/**
 * 由 capability 校验后的 binding 直接预览（Next API 用，无 session auth）。
 */
export async function previewWorkspaceLogicalPathForRoots(input: {
  readonly logicalPath: string;
  readonly roots: readonly WorkspaceRoot[];
}): Promise<WorkspacePathPreview> {
  try {
    const resolved = await resolveWorkspacePath(input.logicalPath, input.roots);
    return {
      alias: resolved.alias,
      logicalPath: resolved.logicalPath,
      hostPath: resolved.hostPath,
      displayRoot: resolved.root.displayPath,
    };
  } catch (err) {
    if (err instanceof WorkspacePathError) {
      throw new Error(`路径预览拒绝：${err.message}`);
    }
    throw err;
  }
}

/**
 * 宿主原生 glob：auth + containment 后直接扫绑定 FS，不调用 sandbox.run。
 */
export async function executeGlobTool(input: {
  readonly agentId: AgentId;
  readonly auth: AuthLike;
  readonly args: HostGlobInput;
  readonly abortSignal?: AbortSignal;
}) {
  const { roots } = await loadRootsForToolContext({
    agentId: input.agentId,
    auth: input.auth,
  });
  return executeHostGlob(roots, input.args, {
    abortSignal: input.abortSignal,
  });
}

/**
 * 宿主原生 grep：auth + containment 后直接扫绑定 FS，不调用 sandbox.run。
 */
export async function executeGrepTool(input: {
  readonly agentId: AgentId;
  readonly auth: AuthLike;
  readonly args: HostGrepInput;
  readonly abortSignal?: AbortSignal;
}) {
  const { roots } = await loadRootsForToolContext({
    agentId: input.agentId,
    auth: input.auth,
  });
  return executeHostGrep(roots, input.args, {
    abortSignal: input.abortSignal,
  });
}

/**
 * 宿主原生 edit_file：Claude Code 风格精确替换；auth + containment 后写绑定 FS。
 */
export async function executeEditFileTool(input: {
  readonly agentId: AgentId;
  readonly auth: AuthLike;
  readonly args: HostEditFileInput;
}) {
  const { roots } = await loadRootsForToolContext({
    agentId: input.agentId,
    auth: input.auth,
  });
  return executeHostEditFile(roots, input.args);
}

export async function executePowerShellTool(input: {
  readonly agentId: AgentId;
  readonly auth: AuthLike;
  readonly command: string;
  readonly cwdLogical: string;
  readonly timeoutMs?: number;
  readonly abortSignal?: AbortSignal;
}) {
  // 先拦逻辑路径进 command，避免误 spawn
  assertPowerShellCommandProtocol(input.command);

  const { roots } = await loadRootsForToolContext({
    agentId: input.agentId,
    auth: input.auth,
  });
  await assertPathInBinding(input.cwdLogical, roots);

  const timeoutMs = Math.min(
    Math.max(1, input.timeoutMs ?? POWERSHELL_DEFAULT_TIMEOUT_MS),
    POWERSHELL_MAX_TIMEOUT_MS,
  );

  try {
    const result = await runHostPowerShell({
      command: input.command,
      cwdLogical: input.cwdLogical,
      roots,
      timeoutMs,
      abortSignal: input.abortSignal,
    });
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      logicalCwd: result.logicalCwd,
      hostCwd: result.hostCwd,
      timedOut: result.timedOut,
      /** A1 公开根，便于结果侧对照（不含 canonical）。 */
      roots: toPublicRoots(roots),
    };
  } catch (err) {
    if (err instanceof PowerShellError) {
      throw new Error(err.message);
    }
    throw err;
  }
}
