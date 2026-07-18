import { NextResponse } from "next/server";
import {
  deleteToolTrustRule,
  setToolTrustRuleEnabled,
  ToolTrustStoreError,
  type ToolTrustRule,
} from "@nianagent/agent-core/tool-trust-store";
import {
  readCapabilityFromRequest,
  resolveWorkspaceCapability,
  toolTrustHttpStatus,
} from "../../_lib/resolve-workspace-capability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeRule(rule: ToolTrustRule) {
  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    agentId: rule.agentId,
    toolName: rule.toolName,
    matchType: rule.matchType,
    pattern: rule.pattern,
    logicalCwd: rule.logicalCwd,
    enabled: rule.enabled,
    createdAt: rule.createdAt,
  };
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/tool-trust-rules/:id
 * body: capability, agentId, enabled
 */
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
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

  if (typeof record.enabled !== "boolean") {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "enabled 必须是布尔值。" } },
      { status: 400 },
    );
  }

  try {
    const rule = await setToolTrustRuleEnabled({
      id,
      workspaceId: resolved.binding.workspaceId,
      agentId: resolved.agentId,
      enabled: record.enabled,
    });
    return NextResponse.json({ ok: true as const, rule: serializeRule(rule) });
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
 * DELETE /api/tool-trust-rules/:id
 * body 或 query：capability + agentId（capability 优先头）
 */
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);

  let agentId: unknown = url.searchParams.get("agentId");
  let capability = readCapabilityFromRequest(
    request,
    url.searchParams.get("capability"),
  );

  // 优先 body（与 path-preview / PATCH 对齐）
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (body && typeof body === "object") {
        if (body.agentId != null) agentId = body.agentId;
        if (typeof body.capability === "string") capability = body.capability;
      }
    } catch {
      // 无 body 时仍可用 query / 头
    }
  }

  const resolved = await resolveWorkspaceCapability({ agentId, capability });
  if (!resolved.ok) return resolved.response;

  try {
    await deleteToolTrustRule({
      id,
      workspaceId: resolved.binding.workspaceId,
      agentId: resolved.agentId,
    });
    return NextResponse.json({ ok: true as const });
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
