import type { SkillsRuntime } from "../skills-runtime"

export class SkillStoreError extends Error {
  code: string
  status: number
}
export function openSkillDomain(
  directory: string,
  changed: () => void
): Promise<Pick<SkillsRuntime, "service" | "toolsByName">>
