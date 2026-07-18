import { NextResponse } from "next/server";
import {
  getSessionPermissionForApi,
  patchSessionPermission,
  ToolTrustStoreError,
} from "@nianagent/agent-core/tool-trust-store";
import {
  readCapabilityFromRequest,
  resolveWorkspaceCapability,
  toolTrustHttpStatus,
} from "../_lib/resolve-workspace-capability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeState(
  state: Awaited<ReturnType<typeof getSessionPermissionForApi>>,
) {
  return {
    sessionId: state.sessionId,
    workspaceId: state.workspaceId,
    agentId: state.agentId,
    acceptEdits: state.acceptEdits,
    globalBypass: state.globalBypass,
    sessionToolGrants: [...state.sessionToolGrants],
    updatedAt: state.updatedAt,
  };
}

/**
 * GET /api/session-permissions?agentId&sessionId
 * capability 优先请求头 x-nianagent-workspace-capability（也可 query，不推荐）。
 * 无行 → 默认全关空 grants；三元组错配 → 4xx。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const sessionId = url.searchParams.get("sessionId");
  const capability = readCapabilityFromRequest(
    request,
    url.searchParams.get("capability"),
  );

  const resolved = await resolveWorkspaceCapability({ agentId, capability });
  if (!resolved.ok) return resolved.response;

  if (!sessionId?.trim()) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_session",
          message: "sessionId 必填且须为真实 Eve 会话 id。",
        },
      },
      { status: 400 },
    );
  }

  try {
    const state = await getSessionPermissionForApi(
      sessionId,
      resolved.binding.workspaceId,
      resolved.agentId,
    );
    return NextResponse.json({
      ok: true as const,
      state: serializeState(state),
    });
  } catch (err) {
    if (err instanceof ToolTrustStoreError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: toolTrustHttpStatus(err.code) },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "database_error", message } },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/session-permissions
 * body: capability, agentId, sessionId, acceptEdits?, globalBypass?, grantTool?, revokeTool?
 * 关闭模式不清 grants；grantTool 供 Agent 固化调用。
 */
export async function PATCH(request: Request) {
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

  const record = body as Record<string, unknown>;
  const capability =
    typeof record.capability === "string" ? record.capability : "";
  const resolved = await resolveWorkspaceCapability({
    agentId: record.agentId,
    capability,
  });
  if (!resolved.ok) return resolved.response;

  const acceptEdits =
    typeof record.acceptEdits === "boolean" ? record.acceptEdits : undefined;
  const globalBypass =
    typeof record.globalBypass === "boolean" ? record.globalBypass : undefined;
  const grantTool =
    typeof record.grantTool === "string" ? record.grantTool : undefined;
  const revokeTool =
    typeof record.revokeTool === "string" ? record.revokeTool : undefined;

  try {
    const state = await patchSessionPermission({
      sessionId: String(record.sessionId ?? ""),
      workspaceId: resolved.binding.workspaceId,
      agentId: resolved.agentId,
      acceptEdits,
      globalBypass,
      grantTool,
      revokeTool,
    });
    return NextResponse.json({
      ok: true as const,
      state: serializeState(state),
    });
  } catch (err) {
    if (err instanceof ToolTrustStoreError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: toolTrustHttpStatus(err.code) },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "database_error", message } },
      { status: 500 },
    );
  }
}
