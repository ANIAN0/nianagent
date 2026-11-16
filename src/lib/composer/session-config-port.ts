import { createContext, type ReactNode } from "react"
import type {
  RpcRequests,
  SessionCatalog,
  SessionConfiguration,
} from "@/contracts/rpc.generated"

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

export type ExtensionManagerSlotProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigured: () => void
}

export const ExtensionManagerContext = createContext<
  ((props: ExtensionManagerSlotProps) => ReactNode) | null
>(null)

export type PermissionControlSlotProps = {
  sessionId?: string
  disabled?: boolean
  disabledReason?: string
}

export const PermissionControlContext = createContext<
  ((props: PermissionControlSlotProps) => ReactNode) | null
>(null)
