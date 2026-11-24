import { version } from "../../../../package.json"
import { NextResponse } from "next/server"
import { getSharedCore } from "@/server/core"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const core = getSharedCore()
    return NextResponse.json({
      ok: true,
      app: "moon-workbench",
      pid: process.pid,
      port: core.port,
      dataDirs: core.dataDirs,
      version,
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
