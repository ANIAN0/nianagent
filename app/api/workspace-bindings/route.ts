import { NextResponse } from "next/server";
import {
  createWorkspaceBinding,
  listRecentRootSets,
  WorkspaceStoreError,
} from "@nianagent/agent-core/workspace-store";
import type { CreateBindingRequest } from "@nianagent/agent-core/workspace-binding";
import { AGENT_IDS, type AgentId } from "@nianagent/agent-core/model-catalog";
import {
  assertPwshAvailable,
  checkPwshAvailable,
  PowerShellError,
} from "@nianagent/agent-core/host-powershell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

function errorStatus(code: WorkspaceStoreError["code"]): number {
  switch (code) {
    case "invalid_agent":
    case "invalid_roots":
    case "overlapping_roots":
      return 400;
    case "directory_unavailable":
      return 400;
    case "not_found":
      return 404;
    case "revoked":
      return 403;
    case "database_error":
    default:
      return 500;
  }
}

/**
 * GET /api/workspace-bindings
 * - 运行前置预检（pwsh）
 * - 从 Turso binding 历史派生最近目录集合（仅 displayPath）
 * 查询参数：
 * - agentId（可选）：只聚合该 agent；缺省为本机全 agent
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentParam = url.searchParams.get("agentId");
  let agentFilter: AgentId | undefined;
  if (agentParam != null && agentParam !== "") {
    if (!isAgentId(agentParam)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_agent",
            message: `agentId 必须是 ${AGENT_IDS.join(" | ")} 之一。`,
          },
        },
        { status: 400 },
      );
    }
    agentFilter = agentParam;
  }

  const [pwsh, recent] = await Promise.all([
    checkPwshAvailable(),
    listRecentRootSets({
      limit: 3,
      ...(agentFilter ? { agentId: agentFilter } : {}),
    }),
  ]);

  // 仅序列化公开字段，禁止夹带 canonicalPath
  const recentPublic = recent.map((e) => ({
    paths: [...e.paths],
    usedAt: e.usedAt,
  }));

  if (pwsh.ok) {
    return NextResponse.json({
      ok: true,
      pwsh: { ok: true as const, path: pwsh.path, major: pwsh.major },
      recent: recentPublic,
    });
  }
  return NextResponse.json(
    {
      ok: false,
      pwsh: { ok: false as const, message: pwsh.message },
      recent: recentPublic,
      error: { code: "pwsh_missing", message: pwsh.message },
    },
    { status: 503 },
  );
}

/**
 * POST /api/workspace-bindings
 * 创建不可变多根 binding；响应省略 canonicalPath；capability 仅返回一次。
 * 创建前 fail-closed 预检 PowerShell 7。
 */
export async function POST(request: Request) {
  try {
    await assertPwshAvailable();
  } catch (err) {
    if (err instanceof PowerShellError && err.code === "pwsh_missing") {
      return NextResponse.json(
        { error: { code: "pwsh_missing", message: err.message } },
        { status: 503 },
      );
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_roots", message: "请求体必须是 JSON。" } },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: { code: "invalid_roots", message: "请求体无效。" } },
      { status: 400 },
    );
  }

  const { agentId, roots } = body as {
    agentId?: unknown;
    roots?: unknown;
  };

  if (!isAgentId(agentId)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_agent",
          message: `agentId 必须是 ${AGENT_IDS.join(" | ")} 之一。`,
        },
      },
      { status: 400 },
    );
  }

  if (!Array.isArray(roots) || roots.some((r) => typeof r !== "string")) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_roots",
          message: "roots 必须是非空字符串路径数组。",
        },
      },
      { status: 400 },
    );
  }

  const req: CreateBindingRequest = {
    agentId,
    roots: roots as string[],
  };

  try {
    const result = await createWorkspaceBinding(req);
    // 显式序列化，确保无 canonicalPath 泄漏
    return NextResponse.json({
      workspaceId: result.workspaceId,
      agentId: result.agentId,
      roots: result.roots.map((r) => ({
        alias: r.alias,
        displayPath: r.displayPath,
      })),
      capability: result.capability,
    });
  } catch (err: unknown) {
    if (err instanceof WorkspaceStoreError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: errorStatus(err.code) },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: {
          code: "database_error",
          message: `创建 workspace binding 失败：${message}`,
        },
      },
      { status: 500 },
    );
  }
}
