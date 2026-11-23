import {
  classifyPreviewPath,
  previewBridgePath,
  previewHostHeader,
  previewPathHeader,
} from "@/server/preview-routing"
import { getWorkbenchRuntime } from "@/server/runtime"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const runtime = await getWorkbenchRuntime()
  const { preview, previewSessions, port, store } = runtime
  const headers = {
    ...preview.previewHeaders(port),
    "cache-control": "no-store",
  }
  const missing = () => new Response(null, { status: 404, headers })
  const sid = preview.isPreviewHost(
    request.headers.get(previewHostHeader),
    port
  )
  const path = request.headers.get(previewPathHeader)
  if (!sid || !path || process.env.MOON_WORKBENCH_APP === "skills")
    return missing()

  try {
    const pathKind = classifyPreviewPath(path)
    if (!pathKind) return missing()
    const session = previewSessions.resolve(sid)
    if (!session) return missing()
    if (pathKind === "bridge") {
      const script = preview.bridgeScript([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ])
      return new Response(script, {
        headers: {
          ...headers,
          "content-type": "text/javascript; charset=utf-8",
        },
      })
    }

    const content = await store.readVersionContent(session.versionId)
    const routes = content.reading.manifest?.routes
    if (content.kind !== "ui" || !routes) return missing()
    const entry = Object.hasOwn(routes, path) ? routes[path] : undefined
    const file = entry ?? decodeURIComponent(path.slice(1))
    if (!file) return missing()
    const bytes = await store.readAsset(session.versionId, file)
    if (entry && /\.html?$/i.test(file)) {
      return new Response(
        preview.injectBridge(bytes.toString("utf8"), previewBridgePath, port),
        {
          headers: { ...headers, "content-type": "text/html; charset=utf-8" },
        }
      )
    }
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, "content-type": preview.assetContentType(file) },
    })
  } catch (error) {
    if (
      error instanceof URIError ||
      (error instanceof Error &&
        "code" in error &&
        (error.code === "not_found" || error.code === "validation_failed"))
    ) {
      return missing()
    }
    return new Response("预览资源暂时无法读取。", { status: 500, headers })
  }
}
