import { NextResponse } from "next/server"
import { isVersionId, previewError } from "@/server/preview-http"
import { getWorkbenchRuntime } from "@/server/runtime"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const runtime = await getWorkbenchRuntime()
  if (!runtime.authorize(request)) {
    return previewError(401, "unauthorized", "未授权访问。")
  }
  const body = (await request.json().catch(() => null)) as {
    sid?: unknown
    versionId?: unknown
  } | null
  const sid = body?.sid
  const versionId = body?.versionId
  if (
    typeof sid !== "string" ||
    !runtime.preview.isPreviewSid(sid) ||
    !isVersionId(versionId)
  ) {
    return previewError(400, "validation_failed", "会话或版本标识无效。")
  }
  return NextResponse.json({
    sid,
    released: runtime.previewSessions.release(sid, versionId),
  })
}
