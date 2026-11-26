import { callPlugin } from "@/features/plugins/plugin-service"
export type Project = {
  id: string
  name: string
  path: string
  available: boolean
  sources: string[]
}
export const skillLabels = {
  unknownLink: "目录链接 · 来源未确认",
  local: "独立目录",
  sharedLink: "共享链接",
  source: "已登记共享源",
  missingManifest: "缺少 SKILL.md",
  broken: "断链或缺少 SKILL.md",
  unreadable: "无法读取",
}
type Section<T> = {
  items: ({ name: string; path: string } & T)[]
  error: string
}
export type SkillSection = Section<{ state: keyof typeof skillLabels }>
export type McpSection = Section<{
  client: string
  scope: "personal" | "project"
  state: "unverified"
}>
export type Detail = {
  revision: string
  skills: SkillSection
  mcp: McpSection
  agents: { exists: boolean; content: string; error: string }
}
export type Preview = {
  previewId: string
  diff: string
  format?: "diff" | "summary"
}
export type Snippet = { id: string; name: string; content: string }
export async function invoke<T>(
  name: string,
  input: object = {},
  signal?: AbortSignal
) {
  return (
    await callPlugin<{ value: T }>(
      "project-manager",
      name,
      input,
      undefined,
      signal
    )
  ).value
}

export type ResourceDialogProps = {
  projectId: string
  pending: boolean
  error: string
  run: (action: () => Promise<void>) => Promise<void>
  buildPreview: (change: object) => Promise<string[]>
}
