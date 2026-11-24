import { openSkillDomain, SkillStoreError } from "./skills/domain.mjs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { NextResponse } from "next/server"
import type { SkillDetail, SkillSummary } from "@/skills/api"
import { getSharedCore } from "./core"

type SkillService = {
  listSkills: () => SkillSummary[]
  getSkillDetail: (id: string) => SkillDetail
  createSkill: (input: object) => SkillDetail
  updateSkillMeta: (id: string, input: object) => unknown
  deleteSkill: (id: string) => unknown
  addBlock: (id: string, input: object) => unknown
  reorderBlocks: (id: string, input: object) => unknown
  updateBlock: (id: string, block: string, input: object) => unknown
  deleteBlock: (id: string, block: string, input: object) => unknown
  getBlockLineage: (id: string, block: string) => unknown
  upsertAsset: (id: string, input: object) => unknown
  deleteAsset: (id: string, path: unknown, input: object) => unknown
  publishVersion: (id: string, input: object) => unknown
  compareVersions: (id: string, from: string, to: string) => unknown
  getVersion: (id: string, version: string) => unknown
  exportSkillDirectory: (id: string, input: object) => Promise<unknown>
}

export type SkillSharedTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  shareable?: boolean
  annotations?: Record<string, unknown>
  execute: (
    input: unknown,
    moon?: { actorId?: string; source?: string },
    signal?: AbortSignal
  ) => Promise<{
    isError?: boolean
    content: Array<{ type: string; text: string }>
  }>
}

export type SkillsRuntime = {
  port: number
  service: SkillService
  toolsByName: Map<string, SkillSharedTool>
  getRevision: () => number
  toErrorResponse: (error: unknown) => NextResponse
}

const globalForSkills = globalThis as unknown as {
  __moonSkillsWorkbenchRuntime?: Promise<SkillsRuntime>
}

async function createSkillsRuntime(): Promise<SkillsRuntime> {
  const core = getSharedCore()
  const dataDir = join(core.dataDirs.skills, "data")
  await mkdir(dataDir, { recursive: true })

  let revision = 0
  const notify = () => {
    revision += 1
  }

  const { service, toolsByName } = await openSkillDomain(dataDir, notify)

  const toErrorResponse = (error: unknown) => {
    const isStoreErr = error instanceof SkillStoreError
    const storeErr = isStoreErr
      ? (error as { status?: number; code?: string })
      : null
    const status = typeof storeErr?.status === "number" ? storeErr.status : 500
    const code = typeof storeErr?.code === "string" ? storeErr.code : "INTERNAL"
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        code,
      },
      { status }
    )
  }

  return {
    port: core.port,
    service,
    toolsByName,
    getRevision: () => revision,
    toErrorResponse,
  }
}

export function getSkillsRuntime(): Promise<SkillsRuntime> {
  if (!globalForSkills.__moonSkillsWorkbenchRuntime) {
    globalForSkills.__moonSkillsWorkbenchRuntime = createSkillsRuntime().catch(
      (error) => {
        globalForSkills.__moonSkillsWorkbenchRuntime = undefined
        throw error
      }
    )
  }
  return globalForSkills.__moonSkillsWorkbenchRuntime
}
