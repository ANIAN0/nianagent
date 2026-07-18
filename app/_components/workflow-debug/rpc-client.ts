"use client";

import { encode, decode } from "cbor-x";
import type { AgentId } from "@nianagent/agent-core/model-catalog";

export type RpcResult<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; layer?: string } };

export async function workflowDebugRpc<T>(
  agentId: AgentId,
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const res = await fetch(`/api/workflow-debug/${agentId}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/cbor",
      accept: "application/cbor",
    },
    body: new Uint8Array(encode({ method, params })),
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  let parsed: unknown;
  try {
    parsed = decode(buf);
  } catch {
    try {
      parsed = JSON.parse(new TextDecoder().decode(buf));
    } catch {
      return {
        success: false,
        error: { message: `RPC 响应无法解析（HTTP ${res.status}）` },
      };
    }
  }
  const body = parsed as RpcResult<T>;
  if (!body || typeof body !== "object" || !("success" in body)) {
    return {
      success: false,
      error: { message: "RPC 响应缺少 success 字段" },
    };
  }
  return body;
}

export function streamUrl(
  agentId: AgentId,
  streamId: string,
  runId: string,
  startIndex = 0,
): string {
  return `/api/workflow-debug/${agentId}/stream/${encodeURIComponent(streamId)}?runId=${encodeURIComponent(runId)}&startIndex=${startIndex}`;
}
