import { createContext } from "react"
import { rpcCall } from "@/lib/rpc/client"
import type { ConversationPermission } from "@/contracts/rpc.generated"
export const createPermissionService = () => ({
  read: (sessionId: string, signal?: AbortSignal) =>
    rpcCall("conversationPermissionRead", { sessionId }, signal),
  set: (
    permission: ConversationPermission,
    mode: ConversationPermission["mode"]
  ) =>
    rpcCall("conversationPermissionSet", {
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
    rpcCall("conversationApprovalReply", {
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
