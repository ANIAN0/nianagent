import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
import type { ConversationPermission } from "@/features/models/model-contract.generated"
export const createPermissionService = () => ({
  read: (sessionId: string, signal?: AbortSignal) =>
    modelCall("conversationPermissionRead", { sessionId }, signal),
  set: (
    permission: ConversationPermission,
    mode: ConversationPermission["mode"]
  ) =>
    modelCall("conversationPermissionSet", {
      sessionId: permission.sessionId,
      revision: permission.revision,
      mode,
    }),
  reply: (
    sessionId: string,
    approvalId: string,
    runId: string,
    value: string
  ) =>
    modelCall("conversationApprovalReply", {
      sessionId,
      approvalId,
      runId,
      value,
    }),
})
export type PermissionService = ReturnType<typeof createPermissionService>
export const PermissionServiceContext = createContext<
  PermissionService | undefined
>(undefined)
