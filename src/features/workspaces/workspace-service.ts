import { createContext } from "react"
import { rpcCall } from "@/lib/rpc/client"
import type { WorkspaceList, WorkspaceRecord } from "@/contracts/rpc.generated"

export type WorkspaceService = {
  list: (signal?: AbortSignal) => Promise<WorkspaceList>
  add: (path: string, signal?: AbortSignal) => Promise<WorkspaceRecord>
  select: (id: string, signal?: AbortSignal) => Promise<WorkspaceRecord>
  get: (id: string, signal?: AbortSignal) => Promise<WorkspaceRecord | null>
  choose: (signal?: AbortSignal) => Promise<WorkspaceRecord | null>
}
export const WorkspaceServiceContext = createContext<
  WorkspaceService | undefined
>(undefined)
export function createWorkspaceService(): WorkspaceService {
  return {
    list: (signal) => rpcCall("workspaceList", {}, signal),
    add: (path, signal) => rpcCall("workspaceAdd", { path }, signal),
    select: (id, signal) => rpcCall("workspaceSelect", { id }, signal),
    get: (id, signal) => rpcCall("workspaceGet", { id }, signal),
    choose: (signal) => rpcCall("workspaceChoose", {}, signal),
  }
}
