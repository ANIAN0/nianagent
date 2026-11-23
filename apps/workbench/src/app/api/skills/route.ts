import { NextResponse } from "next/server"
import { getSkillsRuntime } from "@/server/skills-runtime"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const runtime = await getSkillsRuntime()
  if (!runtime.authorize(request)) {
    return NextResponse.json({ error: "未授权访问 Skill 工作台接口。" }, { status: 401 })
  }
  try {
    return NextResponse.json({ skills: runtime.service.listSkills() })
  } catch (error) {
    return runtime.toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const runtime = await getSkillsRuntime()
  if (!runtime.authorize(request)) {
    return NextResponse.json({ error: "未授权访问 Skill 工作台接口。" }, { status: 401 })
  }
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const created = runtime.service.createSkill({ ...body, actor: "local-user" })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return runtime.toErrorResponse(error)
  }
}
