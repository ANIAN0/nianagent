import { NextResponse } from "next/server"
import { getSkillsRuntime } from "@/server/skills-runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const runtime = await getSkillsRuntime()
  return NextResponse.json({ revision: runtime.getRevision() })
}
