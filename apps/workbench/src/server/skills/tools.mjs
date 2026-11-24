import { skillTools } from "../../../../../backend/plugins/skill-workbench/tool-catalog.mjs"

export function buildSharedTools(service) {
  const actorFrom = (moon) =>
    moon?.actorId ? `agent:${moon.actorId}` : "agent:moon"

  const ok = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  })

  const handlers = {
    async list_skills() {
      return ok({ skills: service.listSkills() })
    },
    async read_skill_blocks(input) {
      const detail = service.getSkillDetail(input.skillId)
      return ok({
        skill: detail.skill,
        blocks: detail.blocks,
        assets: detail.assets.map((a) => ({ relPath: a.relPath })),
      })
    },
    async get_block_lineage(input) {
      return ok(service.getBlockLineage(input.skillId, input.blockId))
    },
    async compare_versions(input) {
      return ok(
        service.compareVersions(
          input.skillId,
          input.fromVersion,
          input.toVersion
        )
      )
    },
    async create_skill(input, moon) {
      return ok(
        service.createSkill({
          ...input,
          actor: actorFrom(moon),
        })
      )
    },
    async add_block(input, moon) {
      return ok(
        service.addBlock(input.skillId, {
          ...input,
          actor: actorFrom(moon),
        })
      )
    },
    async update_block(input, moon) {
      return ok(
        service.updateBlock(input.skillId, input.blockId, {
          ...input,
          actor: actorFrom(moon),
        })
      )
    },
    async delete_block(input, moon) {
      return ok(
        service.deleteBlock(input.skillId, input.blockId, {
          actor: actorFrom(moon),
          reason: input.reason,
        })
      )
    },
    async reorder_blocks(input, moon) {
      return ok(
        service.reorderBlocks(input.skillId, {
          orderedBlockIds: input.orderedBlockIds,
          actor: actorFrom(moon),
          reason: input.reason,
        })
      )
    },
    async upsert_asset(input, moon) {
      return ok(
        service.upsertAsset(input.skillId, {
          relPath: input.relPath,
          content: input.content,
          actor: actorFrom(moon),
          reason: input.reason,
        })
      )
    },
    async publish_version(input, moon) {
      return ok(
        service.publishVersion(input.skillId, {
          summary: input.summary,
          actor: actorFrom(moon),
        })
      )
    },
  }
  return skillTools.map((spec) => ({ ...spec, execute: handlers[spec.name] }))
}
