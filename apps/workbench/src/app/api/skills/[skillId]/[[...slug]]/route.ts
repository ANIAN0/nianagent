import { NextResponse } from "next/server"
import { getSkillsRuntime } from "@/server/skills-runtime"

export const dynamic = "force-dynamic"

const actor = "local-user"

async function handle(
  request: Request,
  context: { params: Promise<{ skillId: string; slug?: string[] }> }
) {
  const runtime = await getSkillsRuntime()

  const { skillId, slug = [] } = await context.params
  const [resource, child, action] = slug
  const oneSegment = slug.length === 1
  const method = request.method
  const url = new URL(request.url)

  const readJson = async () =>
    (await request.json().catch(() => ({}))) as Record<string, unknown>

  try {
    if (slug.length === 0) {
      if (method === "GET") {
        return NextResponse.json(runtime.service.getSkillDetail(skillId))
      }
      if (method === "PATCH") {
        const body = await readJson()
        return NextResponse.json(
          runtime.service.updateSkillMeta(skillId, { ...body, actor })
        )
      }
      if (method === "DELETE") {
        return NextResponse.json(runtime.service.deleteSkill(skillId))
      }
    }

    if (method === "POST" && oneSegment && resource === "blocks") {
      const body = await readJson()
      return NextResponse.json(
        runtime.service.addBlock(skillId, { ...body, actor }),
        { status: 201 }
      )
    }
    if (
      method === "POST" &&
      slug.length === 2 &&
      resource === "blocks" &&
      child === "reorder"
    ) {
      const body = await readJson()
      return NextResponse.json(
        runtime.service.reorderBlocks(skillId, { ...body, actor })
      )
    }

    if (resource === "blocks" && child) {
      const blockId = child
      if (slug.length === 2) {
        if (method === "PATCH") {
          const body = await readJson()
          return NextResponse.json(
            runtime.service.updateBlock(skillId, blockId, { ...body, actor })
          )
        }
        if (method === "DELETE") {
          const body = await readJson()
          return NextResponse.json(
            runtime.service.deleteBlock(skillId, blockId, {
              actor,
              reason: body.reason,
            })
          )
        }
      }
      if (method === "GET" && slug.length === 3 && action === "lineage") {
        return NextResponse.json(
          runtime.service.getBlockLineage(skillId, blockId)
        )
      }
    }

    if (oneSegment && resource === "assets") {
      if (method === "POST") {
        const body = await readJson()
        return NextResponse.json(
          runtime.service.upsertAsset(skillId, { ...body, actor })
        )
      }
      if (method === "DELETE") {
        const body = await readJson()
        return NextResponse.json(
          runtime.service.deleteAsset(skillId, body.relPath, {
            actor,
            reason: body.reason,
          })
        )
      }
    }

    if (method === "POST" && oneSegment && resource === "versions") {
      const body = await readJson()
      return NextResponse.json(
        runtime.service.publishVersion(skillId, { ...body, actor }),
        { status: 201 }
      )
    }

    if (method === "GET" && oneSegment && resource === "compare") {
      const from = url.searchParams.get("from") ?? "0"
      const to = url.searchParams.get("to") ?? "0"
      return NextResponse.json(
        runtime.service.compareVersions(skillId, from, to)
      )
    }

    if (method === "GET" && resource === "versions" && slug.length === 2) {
      return NextResponse.json(runtime.service.getVersion(skillId, child))
    }

    if (method === "POST" && oneSegment && resource === "export") {
      const body: unknown = await request.json().catch(() => null)
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json(
          { error: "导出参数必须为 JSON 对象。", code: "INVALID_INPUT" },
          { status: 400 }
        )
      }
      return NextResponse.json(
        await runtime.service.exportSkillDirectory(skillId, body)
      )
    }

    return NextResponse.json({ error: "接口不存在。" }, { status: 404 })
  } catch (error) {
    return runtime.toErrorResponse(error)
  }
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const DELETE = handle
