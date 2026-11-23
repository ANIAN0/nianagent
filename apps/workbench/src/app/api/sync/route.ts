import { NextResponse } from "next/server"
import { getWorkbenchRuntime } from "@/server/runtime"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const runtime = await getWorkbenchRuntime()
  if (!runtime.authorize(request)) {
    return NextResponse.json({ error: "未授权访问。" }, { status: 401 })
  }
  const url = new URL(request.url)
  const rawVersion = url.searchParams.get("version")
  if (rawVersion === null || rawVersion === "") {
    return NextResponse.json({ version: runtime.getDataVersion() })
  }
  const since = Number(rawVersion)
  if (!Number.isSafeInteger(since)) {
    return NextResponse.json({ error: "version 需为整数。" }, { status: 400 })
  }
  const result = await runtime.waitForSync(since, request.signal)
  return NextResponse.json(result)
}
