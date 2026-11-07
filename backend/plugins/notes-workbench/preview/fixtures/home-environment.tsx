import { useState, type ReactNode } from "react"
import {
  PermissionServiceContext,
  type PermissionService,
} from "@/features/conversation/permissions/permission-service"
import type { ConversationPermission } from "@/contracts/rpc.generated"

/** Keep normal home controls visible without reading or writing user data. */
export function HomeCatalogEnvironment({ children }: { children: ReactNode }) {
  const [service] = useState<PermissionService>(() => {
    const permissions = new Map<string, ConversationPermission>()
    const read = (sessionId: string) => {
      const current = permissions.get(sessionId) ?? {
        sessionId,
        mode: "workspace" as const,
        revision: 0,
      }
      permissions.set(sessionId, current)
      return current
    }
    return {
      read: async (sessionId, signal) => {
        signal?.throwIfAborted()
        return read(sessionId)
      },
      set: async (current, mode) => {
        const saved = read(current.sessionId)
        if (saved.revision !== current.revision)
          throw new Error("演示权限已更新，请重新读取。")
        const next = { ...saved, mode, revision: saved.revision + 1 }
        permissions.set(current.sessionId, next)
        return next
      },
      reply: async () => {
        throw new Error("首页展示不提供审批回复。")
      },
    }
  })
  return (
    <PermissionServiceContext.Provider value={service}>
      {children}
    </PermissionServiceContext.Provider>
  )
}
