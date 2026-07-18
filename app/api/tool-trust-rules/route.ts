import { NextResponse } from "next/server";
import {
  createToolTrustRule,
  listToolTrustRules,
  ToolTrustStoreError,
  type ToolTrustRule,
} from "@nianagent/agent-core/tool-trust-store";
import {
  readCapabilityFromRequest,
  resolveWorkspaceCapability,
  toolTrustHttpStatus,
} from "../_lib/resolve-workspace-capability";

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

/**
 * GET /api/tool-trust-rules?agentId
 * capability 优先请求头 x-nianagent-workspace-capability。
 * 当前 workspace+agent 规则列表（含 disabled）。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const capability = readCapabilityFromRequest(
    request,
    url.searchParams.get("capability"),
  );

  const resolved = await resolveWorkspaceCapability({ agentId, capability });
  if (!resolved.ok) return resolved.response;

  try {
    const rules = await listToolTrustRules(
      resolved.binding.workspaceId,
      resolved.agentId,
    );
    return NextResponse.json({
      ok: true as const,
      rules: rules.map(serializeRule),
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
 * POST /api/tool-trust-rules
 * body: capability, agentId, toolName, pattern, matchType:"exact", logicalCwd?（PS 必填）
 * 主路径：Agent execute 屏障固化；过宽 → 4xx 中文。
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

  const record = body as Record<string, unknown>;
  const capability =
    typeof record.capability === "string" ? record.capability : "";
  const resolved = await resolveWorkspaceCapability({
    agentId: record.agentId,
    capability,
  });
  if (!resolved.ok) return resolved.response;

  try {
    const { rule, rulesEpoch } = await createToolTrustRule({
      workspaceId: resolved.binding.workspaceId,
      agentId: resolved.agentId,
      toolName: record.toolName,
      pattern: record.pattern,
      logicalCwd: record.logicalCwd,
      matchType: record.matchType,
    });
    return NextResponse.json(
      {
        ok: true as const,
        rule: serializeRule(rule),
        rulesEpoch,
      },
      { status: 201 },
    );
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
