import { defineChannel, GET, POST } from "eve/channels";
import {
  assertWorkflowDebugSecret,
  executeWorkflowDebugMethod,
  readWorkflowDebugStream,
  WORKFLOW_DEBUG_SECRET_HEADER,
} from "@nianagent/agent-core/workflow-debug-bridge";

async function decodeRpcBody(
  request: Request,
): Promise<{ method: string; params: Record<string, unknown> }> {
  const contentType = request.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await request.arrayBuffer());
  if (contentType.includes("application/cbor")) {
    const { decode } = await import("cbor-x");
    const data = decode(buf) as { method?: string; params?: Record<string, unknown> };
    return {
      method: String(data.method ?? ""),
      params: (data.params ?? {}) as Record<string, unknown>,
    };
  }
  // JSON 仅兼容调试；产品路径以 CBOR 为准
  const text = new TextDecoder().decode(buf);
  const data = JSON.parse(text || "{}") as {
    method?: string;
    params?: Record<string, unknown>;
  };
  return {
    method: String(data.method ?? ""),
    params: (data.params ?? {}) as Record<string, unknown>,
  };
}

async function encodeRpcResult(result: unknown, preferCbor: boolean): Promise<Response> {
  if (preferCbor) {
    const { encode } = await import("cbor-x");
    const encoded = encode(result);
    return new Response(new Uint8Array(encoded), {
      status: 200,
      headers: { "content-type": "application/cbor" },
    });
  }
  return Response.json(result);
}

export default defineChannel({
  routes: [
    POST("/workflow-debug/rpc", async (request) => {
      try {
        assertWorkflowDebugSecret(
          request.headers.get(WORKFLOW_DEBUG_SECRET_HEADER),
        );
      } catch (err) {
        return Response.json(
          {
            success: false,
            error: {
              message: err instanceof Error ? err.message : String(err),
              layer: "server",
            },
          },
          { status: 401 },
        );
      }

      const preferCbor = (request.headers.get("content-type") ?? "").includes(
        "cbor",
      );
      let method: string;
      let params: Record<string, unknown>;
      try {
        ({ method, params } = await decodeRpcBody(request));
      } catch (err) {
        return Response.json(
          {
            success: false,
            error: {
              message: `RPC 请求体无效：${err instanceof Error ? err.message : String(err)}`,
              layer: "server",
            },
          },
          { status: 400 },
        );
      }

      const result = await executeWorkflowDebugMethod(method, params);
      return encodeRpcResult(result, preferCbor);
    }),

    GET("/workflow-debug/stream/:streamId", async (request, { params }) => {
      try {
        assertWorkflowDebugSecret(
          request.headers.get(WORKFLOW_DEBUG_SECRET_HEADER),
        );
      } catch (err) {
        return Response.json(
          {
            success: false,
            error: {
              message: err instanceof Error ? err.message : String(err),
              layer: "server",
            },
          },
          { status: 401 },
        );
      }

      const url = new URL(request.url);
      const runId = url.searchParams.get("runId") ?? "";
      const streamId = params.streamId ?? url.searchParams.get("streamId") ?? "";
      const startIndex = Number(url.searchParams.get("startIndex") ?? "0");

      try {
        const data = await readWorkflowDebugStream({
          runId,
          streamId,
          startIndex: Number.isFinite(startIndex) ? startIndex : 0,
        });
        if (data == null) {
          return new Response(null, { status: 404 });
        }
        if (data instanceof Uint8Array) {
          return new Response(Buffer.from(data), {
            headers: { "content-type": "application/octet-stream" },
          });
        }
        return new Response(data as unknown as BodyInit, {
          headers: { "content-type": "application/octet-stream" },
        });
      } catch (err) {
        return Response.json(
          {
            success: false,
            error: {
              message: err instanceof Error ? err.message : String(err),
              layer: "API",
            },
          },
          { status: 500 },
        );
      }
    }),
  ],
});
