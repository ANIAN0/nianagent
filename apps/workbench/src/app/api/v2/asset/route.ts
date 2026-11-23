import { NextResponse } from "next/server"
import { getWorkbenchRuntime } from "@/server/runtime"

export const dynamic = "force-dynamic"

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

function contentTypeFor(path: string) {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return "application/octet-stream"
  return MIME[path.slice(dot).toLowerCase()] ?? "application/octet-stream"
}

export async function GET(request: Request) {
  const runtime = await getWorkbenchRuntime()
  if (!runtime.authorize(request)) {
    return NextResponse.json({ error: "未授权访问。" }, { status: 401 })
  }
  const url = new URL(request.url)
  const versionId = url.searchParams.get("versionId") || ""
  const assetPath = url.searchParams.get("path") || ""
  if (!versionId || !assetPath) {
    return NextResponse.json({ error: "缺少 versionId 或 path。" }, { status: 400 })
  }
  try {
    const asset = await runtime.store.readAsset(versionId, assetPath)
    return new NextResponse(new Uint8Array(asset), {
      status: 200,
      headers: {
        "content-type": contentTypeFor(assetPath),
        "cache-control": "private, max-age=3600",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "资源读取失败。" },
      { status: 404 }
    )
  }
}
