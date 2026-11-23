import { NextResponse } from "next/server"
import { getSharedCore } from "@/server/core"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const core = await getSharedCore()
    return NextResponse.json({
      ok: true,
      app: core.appKind,
      pid: process.pid,
      port: core.port,
      version: "0.2.0",
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        pid: process.pid,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
