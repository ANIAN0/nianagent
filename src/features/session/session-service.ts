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
export function consumeHomeSession(
  cwd: string,
  strict = false,
  expectedSessionId?: string
): void {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}") as Record<
      string,
      string
    >
    if (expectedSessionId && stored[cwd] && stored[cwd] !== expectedSessionId)
      return
    delete stored[cwd]
    localStorage.setItem(key, JSON.stringify(stored))
  } catch (error) {
    if (strict) throw error
    /* Storage can be disabled; active draft identity remains in memory. */
  }
}
