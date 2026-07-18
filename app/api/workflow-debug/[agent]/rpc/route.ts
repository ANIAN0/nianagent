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
 * 同源 RPC 代理：仅固定 agent → 回环端口；附加内部密钥，永不回传浏览器。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ agent: string }> },
) {
  const { agent: agentParam } = await context.params;
  if (!isAgentId(agentParam)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: `未知 agent：${agentParam}。仅允许 ${AGENT_IDS.join(", ")}。`,
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

  const base = AGENT_LOOPBACK[agentParam];
  // Eve custom channel 路由为文件内声明的绝对路径（本产品：/workflow-debug/rpc）
  const target = `${base}/workflow-debug/rpc`;
  const body = await request.arrayBuffer();
  const contentType =
    request.headers.get("content-type") ?? "application/cbor";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": contentType,
        [WORKFLOW_DEBUG_SECRET_HEADER]: secret,
      },
      body,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: `无法连接 Agent debug bridge（${base}）：${err instanceof Error ? err.message : String(err)}`,
          layer: "server",
        },
      },
      { status: 502 },
    );
  }

  const responseBody = await upstream.arrayBuffer();
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  // 永不转发内部密钥
  return new Response(responseBody, {
    status: upstream.status,
    headers,
  });
}
