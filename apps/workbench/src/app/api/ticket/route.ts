import { NextResponse } from "next/server"
import { getSharedCore, type WorkbenchAppKind } from "@/server/core"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const core = await getSharedCore()
  if (!core.authorize(request)) {
    return NextResponse.json({ error: "未授权访问。" }, { status: 401 })
  }
  const body = (await request.json().catch(() => ({}))) as { app?: string }
  const app: WorkbenchAppKind =
    body.app === "skills" || body.app === "notes" ? body.app : core.appKind
  const ticket = core.issueTicket(app)
  return NextResponse.json({
    ticket,
    url: `http://127.0.0.1:${core.port}/api/ticket?t=${encodeURIComponent(ticket)}`,
  })
}

export async function GET(request: Request) {
  const core = await getSharedCore()
  const url = new URL(request.url)
  const ticket = url.searchParams.get("t") || ""
  const result = core.consumeTicket(ticket)
  if (core.token && !result.valid) {
    return NextResponse.json(
      { error: "票据无效或已过期，请从 Moon 重新打开。" },
      { status: 401 }
    )
  }
  const targetPath = result.app === "skills" ? "/skills" : "/notes"
  const response = NextResponse.redirect(
    new URL(targetPath, `http://127.0.0.1:${core.port}`)
  )
  if (core.token) {
    response.cookies.set("moon_workbench_token", core.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    })
  }
  return response
}
