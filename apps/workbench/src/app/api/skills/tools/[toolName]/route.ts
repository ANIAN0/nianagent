import { NextResponse } from "next/server"
import { getSkillsRuntime } from "@/server/skills-runtime"

export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ toolName: string }> }
) {
  const runtime = await getSkillsRuntime()
  const { toolName } = await context.params
  const tool = runtime.toolsByName.get(decodeURIComponent(toolName))
  if (!tool) {
    return NextResponse.json({ error: `未知工具：${toolName}` }, { status: 404 })
  }
  try {
    const input = await request.json().catch(() => ({}))
    const actorId = request.headers.get("x-moon-actor") || undefined
    const source = request.headers.get("x-moon-source") || undefined
    const result = await tool.execute(input, { actorId, source }, request.signal)
    return NextResponse.json(result)
  } catch (error) {
    return runtime.toErrorResponse(error)
  }
}
