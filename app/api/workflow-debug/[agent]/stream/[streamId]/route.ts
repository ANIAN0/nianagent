import { NextResponse } from "next/server";
import {
  WORKFLOW_DEBUG_SECRET_ENV,
  WORKFLOW_DEBUG_SECRET_HEADER,
} from "@nianagent/agent-core/workflow-debug-bridge";
import { AGENT_IDS, type AgentId } from "@nianagent/agent-core/model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_LOOPBACK: Record<AgentId, string> = {
  "knowledge-base": "http://127.0.0.1:4274",
  "work-assistant": "http://127.0.0.1:4275",
};

function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * 同源 stream 代理：固定 agent 映射，附加内部密钥。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ agent: string; streamId: string }> },
) {
  const { agent: agentParam, streamId } = await context.params;
  if (!isAgentId(agentParam)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: `未知 agent：${agentParam}`,
          layer: "server",
        },
      },
      { status: 400 },
    );
  }

  const secret = process.env[WORKFLOW_DEBUG_SECRET_ENV]?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: `服务器未配置 ${WORKFLOW_DEBUG_SECRET_ENV}`,
          layer: "server",
        },
      },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const runId = url.searchParams.get("runId") ?? "";
  const startIndex = url.searchParams.get("startIndex") ?? "0";
  const base = AGENT_LOOPBACK[agentParam];
  const target = new URL(
    `${base}/workflow-debug/stream/${encodeURIComponent(streamId)}`,
  );
  target.searchParams.set("runId", runId);
  target.searchParams.set("startIndex", startIndex);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: {
        [WORKFLOW_DEBUG_SECRET_HEADER]: secret,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: `无法连接 Agent stream bridge：${err instanceof Error ? err.message : String(err)}`,
          layer: "server",
        },
      },
      { status: 502 },
    );
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
