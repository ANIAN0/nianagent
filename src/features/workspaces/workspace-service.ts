import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
import type {
  WorkspaceList,
  WorkspaceRecord,
} from "@/features/models/model-contract.generated"

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
    list: (signal) => modelCall("workspaceList", {}, signal),
    add: (path, signal) => modelCall("workspaceAdd", { path }, signal),
    select: (id, signal) => modelCall("workspaceSelect", { id }, signal),
    get: (id, signal) => modelCall("workspaceGet", { id }, signal),
    choose: (signal) => modelCall("workspaceChoose", {}, signal),
  }
}
