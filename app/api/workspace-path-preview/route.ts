import { NextResponse } from "next/server";
import { AGENT_IDS, type AgentId } from "@nianagent/agent-core/model-catalog";
import {
  digestCapability,
  getBindingByCapabilityDigest,
  WorkspaceStoreError,
} from "@nianagent/agent-core/workspace-store";
import { previewWorkspaceLogicalPathForRoots } from "@nianagent/agent-core/workspace-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * POST /api/workspace-path-preview
 * 审批 UI 专用：capability + 逻辑路径 → 与执行同源的宿主路径预览。
 * 不写入 agent 协议；响应含 hostPath 仅供本机审批展示。
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "请求体必须是 JSON。" } },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "请求体无效。" } },
      { status: 400 },
    );
  }

  const recordBody = body as Record<string, unknown>;
  const agentId = recordBody.agentId;
  const capability =
    typeof recordBody.capability === "string" ? recordBody.capability.trim() : "";
  const logicalPath =
    typeof recordBody.logicalPath === "string" ? recordBody.logicalPath.trim() : "";

  if (!isAgentId(agentId)) {
    return NextResponse.json(
      { error: { code: "invalid_agent", message: "agentId 无效。" } },
      { status: 400 },
    );
  }
  if (!capability) {
    return NextResponse.json(
      { error: { code: "missing_capability", message: "缺少 capability。" } },
      { status: 401 },
    );
  }
  if (!logicalPath) {
    return NextResponse.json(
      { error: { code: "invalid_path", message: "logicalPath 不能为空。" } },
      { status: 400 },
    );
  }

  try {
    const digest = digestCapability(capability);
    const binding = await getBindingByCapabilityDigest(digest);
    if (!binding) {
      return NextResponse.json(
        { error: { code: "invalid_capability", message: "capability 无效或不存在。" } },
        { status: 401 },
      );
    }
    if (binding.revokedAt) {
      return NextResponse.json(
        { error: { code: "revoked", message: "该工作区 binding 已撤销。" } },
        { status: 403 },
      );
    }
    if (binding.agentId !== agentId) {
      return NextResponse.json(
        {
          error: {
            code: "agent_mismatch",
            message: `capability 不属于当前 Agent（期望 ${agentId}）。`,
          },
        },
        { status: 403 },
      );
    }

    const preview = await previewWorkspaceLogicalPathForRoots({
      logicalPath,
      roots: binding.roots,
    });

    return NextResponse.json({
      ok: true as const,
      preview: {
        alias: preview.alias,
        logicalPath: preview.logicalPath,
        hostPath: preview.hostPath,
        displayRoot: preview.displayRoot,
      },
    });
  } catch (err) {
    if (err instanceof WorkspaceStoreError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 500 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "path_rejected", message } },
      { status: 400 },
    );
  }
}
