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
    sid?: unknown
    page?: unknown
    elements?: unknown
  } | null
  if (
    !isVersionId(body?.versionId) ||
    typeof body?.sid !== "string" ||
    typeof body.page !== "string" ||
    !Array.isArray(body.elements)
  ) {
    return previewError(400, "validation_failed", "元素清单结构无效。")
  }

  const { sid, versionId, page, elements } = body
  const session = runtime.previewSessions.resolve(sid)
  if (!session || session.versionId !== versionId) {
    return previewError(403, "validation_failed", "预览会话无效或归属不符。")
  }
  try {
    const content = await runtime.store.readVersionContent(versionId)
    const manifest = content.reading.manifest
    if (content.kind !== "ui" || !manifest) {
      return previewError(
        400,
        "unsupported_artifact",
        "元素清单仅适用于 UI 版本。"
      )
    }
    const count = runtime.previewInventories.capture(
      versionId,
      manifest,
      page,
      elements
    )
    return NextResponse.json({ captured: true, page, elements: count })
  } catch (error) {
    return previewFailure(error)
  }
}
