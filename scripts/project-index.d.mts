export type ProjectFile = {
  path: string
  purpose: string
  diskState: "file" | "missing" | "unreadable" | "non-regular"
  gitStatus: { index: string; worktree: string; conflicted: boolean }
  responsibility: string
  reason: string
  scope: string
  references: string[]
  usedBy: string[]
  entries: string[]
  declarations: { name: string; line: number }[]
}
export type ProjectIndex = {
  root: string
  files: ProjectFile[]
  issues: { path: string; code: string; message: string }[]
  directories: Record<string, [string, string]>
  pendingRegistrations: string[]
  stagedDeletions: string[]
  scope: string
  readAt: string
}
export const projectRoot: string
export const directoryRules: Record<string, [string, string]>
export function directoryRule(path: string): {
  scope: string
  responsibility: string
  reason: string
}
export function prohibitedReason(path: string): string | null
export function collectProject(): ProjectIndex
export function collectProjectAsync(): Promise<ProjectIndex>
