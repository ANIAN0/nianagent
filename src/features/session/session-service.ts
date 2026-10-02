import type { Workspace } from "@/features/home/home-types"
import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
import type {
  SessionCatalog,
  SessionConfiguration,
  RpcRequests,
} from "@/features/models/model-contract.generated"

export type SessionService = {
  catalog: (cwd: string, signal?: AbortSignal) => Promise<SessionCatalog>
  read: (
    sessionId: string,
    signal?: AbortSignal
  ) => Promise<SessionConfiguration | null>
  apply: (
    input: RpcRequests["sessionApply"],
    signal?: AbortSignal
  ) => Promise<SessionConfiguration>
}
export const SessionServiceContext = createContext<SessionService | undefined>(
  undefined
)
export function createSessionService(): SessionService {
  return {
    catalog: (cwd, signal) => modelCall("sessionCatalog", { cwd }, signal),
    read: (sessionId, signal) =>
      modelCall("sessionRead", { sessionId }, signal),
    apply: (input, signal) => modelCall("sessionApply", input, signal),
  }
}

const key = "moon.home-session.v1"
export function homeSessionId(cwd: string): string {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}") as Record<
      string,
      string
    >
    if (typeof stored[cwd] === "string") return stored[cwd]
    const id = crypto.randomUUID()
    localStorage.setItem(key, JSON.stringify({ ...stored, [cwd]: id }))
    return id
  } catch {
    return crypto.randomUUID()
  }
}
export function consumeHomeSession(cwd: string): void {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}") as Record<
      string,
      string
    >
    delete stored[cwd]
    localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    /* Storage can be disabled; active draft identity remains in memory. */
  }
}

const workspaceKey = "moon.workspaces.v1"
export function readHomeWorkspaces(): Workspace[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(workspaceKey) || "[]"
    )
    return Array.isArray(value)
      ? value.filter(
          (item): item is Workspace =>
            !!item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            typeof item.path === "string" &&
            !!item.path
        )
      : []
  } catch {
    return []
  }
}
export function lastHomeWorkspace(): string | undefined {
  try {
    return localStorage.getItem("moon.workspace.selected.v1") ?? undefined
  } catch {
    return undefined
  }
}
export function rememberHomeWorkspace(workspace: Workspace): void {
  if (!workspace.path) return
  try {
    localStorage.setItem(
      workspaceKey,
      JSON.stringify([
        ...readHomeWorkspaces().filter((item) => item.id !== workspace.id),
        workspace,
      ])
    )
    localStorage.setItem("moon.workspace.selected.v1", workspace.id)
  } catch {
    /* Session continues when local storage is disabled. */
  }
}
