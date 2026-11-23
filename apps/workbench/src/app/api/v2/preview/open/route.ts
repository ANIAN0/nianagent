import { NextResponse } from "next/server"
import {
  isVersionId,
  previewError,
  previewFailure,
} from "@/server/preview-http"
import { getWorkbenchRuntime } from "@/server/runtime"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const runtime = await getWorkbenchRuntime()
  if (!runtime.authorize(request)) {
    return previewError(401, "unauthorized", "未授权访问。")
  }
  const body = (await request.json().catch(() => null)) as {
    versionId?: unknown
  } | null
  const versionId = body?.versionId
  if (!isVersionId(versionId)) {
    return previewError(400, "validation_failed", "版本标识无效。")
  }
  try {
    const content = await runtime.store.readVersionContent(versionId)
    if (content.kind !== "ui") {
      return previewError(
        400,
        "unsupported_artifact",
        "该版本不是 UI 预览产物。"
      )
    }
    const sid = runtime.previewSessions.open(versionId)
    return NextResponse.json({
      sid,
      sessionUrl: `http://${sid}.localhost:${runtime.port}/`,
    })
  } catch (error) {
    return previewFailure(error)
  }
}
