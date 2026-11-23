import { NextResponse } from "next/server"
import { getSkillsRuntime } from "@/server/skills-runtime"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const runtime = await getSkillsRuntime()
  if (!runtime.authorize(request)) {
    return NextResponse.json({ error: "未授权访问 Skill 工作台接口。" }, { status: 401 })
  }
  return NextResponse.json({ revision: runtime.getRevision() })
}
