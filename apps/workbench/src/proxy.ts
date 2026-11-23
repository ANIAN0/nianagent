import { NextResponse, type NextRequest } from "next/server"
import { isPreviewHost } from "../../../backend/plugins/notes-workbench/v2/preview.mjs"
import {
  classifyPreviewPath,
  previewContentRoute,
  previewHostHeader,
  previewPathHeader,
} from "@/server/preview-routing"
import { workbenchPort } from "@/server/workbench-port"

export function proxy(request: NextRequest) {
  const port = workbenchPort()
  const host = request.headers.get("host")
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) {
    if (request.nextUrl.pathname === previewContentRoute) {
      return new NextResponse(null, { status: 404 })
    }
    const headers = new Headers(request.headers)
    headers.delete(previewHostHeader)
    headers.delete(previewPathHeader)
    return NextResponse.next({
      request: { headers },
      headers: { "content-security-policy": "frame-ancestors 'none'" },
    })
  }
  if (
    !host ||
    process.env.MOON_WORKBENCH_APP === "skills" ||
    !isPreviewHost(host, port, 32)
  ) {
    return new NextResponse(null, { status: 404 })
  }
  if (request.method !== "GET") {
    return new NextResponse(null, { status: 405, headers: { allow: "GET" } })
  }

  const path = request.nextUrl.pathname
  if (!classifyPreviewPath(path)) return new NextResponse(null, { status: 404 })

  const destination = new URL(previewContentRoute, request.url)
  // Next can replace Host during an internal rewrite. Preserve the checked value.
  const headers = new Headers(request.headers)
  headers.delete("authorization")
  headers.delete("cookie")
  headers.set(previewHostHeader, host)
  headers.set(previewPathHeader, path)
  return NextResponse.rewrite(destination, { request: { headers } })
}
