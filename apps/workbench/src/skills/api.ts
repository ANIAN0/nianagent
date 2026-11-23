const normalizeSkillsApiPath = (path: string) => {
  if (path === "/api/skills" || path.startsWith("/api/skills/")) return path
  if (path.startsWith("/api/")) return `/api/skills/${path.slice("/api/".length)}`
  return path
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const res = await fetch(normalizeSkillsApiPath(path), {
    ...init,
    credentials: "same-origin",
    headers,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `请求失败（${res.status}）`
    )
  }
  return data as T
}

export type SkillSummary = {
  id: string
  slug: string
  name: string
  description: string
  exportDir: string
  currentVersion: number
  draftRevision: number
  createdAt: string
  updatedAt: string
}

export type SkillBlock = {
  id: string
  skillId: string
  sortOrder: number
  heading: string
  content: string
  createdVersion: number
  createdAt: string
  updatedAt: string
}

export type SkillAsset = {
  id: string
  skillId: string
  relPath: string
  content: string
  updatedAt: string
}

export type SkillVersionSummary = {
  id: string
  skillId: string
  versionNumber: number
  summary: string
  createdBy: string
  createdAt: string
}

export type SkillRevision = {
  id: string
  skillId: string
  versionNumber: number
  action: string
  blockId: string | null
  actor: string
  reason: string
  beforeSnapshot: Record<string, unknown> | null
  afterSnapshot: Record<string, unknown> | null
  createdAt: string
}

export type SkillDetail = {
  skill: SkillSummary
  blocks: SkillBlock[]
  assets: SkillAsset[]
  versions: SkillVersionSummary[]
  compiledMd: string
  revisions: SkillRevision[]
}

export type BlockLineage = {
  blockId: string
  current: SkillBlock | null
  deleted: boolean
  createdAt: string
  createdVersion: number
  editCount: number
  revisions: SkillRevision[]
}

export type VersionCompare = {
  from: { versionNumber: number; label: string }
  to: { versionNumber: number; label: string }
  diffs: Array<{
    blockId: string
    status:
      | "added"
      | "removed"
      | "modified"
      | "moved"
      | "modified_and_moved"
      | "unchanged"
    from: (SkillBlock & { index: number }) | null
    to: (SkillBlock & { index: number }) | null
  }>
  revisions: SkillRevision[]
}
