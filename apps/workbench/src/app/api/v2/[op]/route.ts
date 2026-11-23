import { NextResponse } from "next/server"
import { getWorkbenchRuntime, newTraceId } from "@/server/runtime"

export const dynamic = "force-dynamic"

const maxBody = 8 * 1024 * 1024

async function readBody(request: Request) {
  if (!request.body) return {}
  if (Number(request.headers.get("content-length")) > maxBody) {
    throw new BodyLimitError()
  }
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let length = 0
  let body = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBody) {
        void reader.cancel().catch(() => {})
        throw new BodyLimitError()
      }
      body += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  body += decoder.decode()
  return body ? JSON.parse(body) : {}
}

class BodyLimitError extends Error {
  status = 413
  code = "limit_exceeded"

  constructor() {
    super("请求体超过 8 MiB。")
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ op: string }> }
) {
  const runtime = await getWorkbenchRuntime()
  const { op } = await context.params
  const definition = runtime.v2.operations[`v2_${op}`]
  if (!definition) {
    return NextResponse.json({ error: "未知操作。" }, { status: 404 })
  }
  try {
    const parsed = await readBody(request)
    runtime.validatePluginValue(definition.input, parsed)
    const sourceHeader = request.headers.get("x-moon-source")
    const actorHeader = request.headers.get("x-moon-actor")
    const source =
      sourceHeader === "mcp" ||
      sourceHeader === "pi" ||
      sourceHeader === "remote"
        ? sourceHeader
        : "local"
    const { value } = await definition.execute(
      parsed,
      {
        source,
        ...(actorHeader ? { actorId: actorHeader } : {}),
        traceId: newTraceId(),
      },
      request.signal
    )
    return NextResponse.json(value ?? {})
  } catch (error) {
    const err = error as {
      status?: number
      code?: string
      errorId?: string
      message?: string
      issue?: { safeMessage?: string; outcome?: string }
    }
    const status =
      err?.status ??
      (err?.code === "not_found" || err?.code === "invalid_anchor" ? 404 : 400)
    return NextResponse.json(
      {
        error: err?.issue?.safeMessage || err?.message || "操作未完成。",
        code: err?.code,
        errorId: err?.errorId,
        outcome: err?.issue?.outcome ?? "rejected",
      },
      { status }
    )
  }
}
