import { rpcCall } from "@/lib/rpc/client"
import { type SessionService } from "@/lib/composer/session-config-port"
export {
  SessionServiceContext,
  type SessionService,
} from "@/lib/composer/session-config-port"
export function createSessionService(): SessionService {
  return {
    catalog: (cwd, signal, sessionId) =>
      rpcCall(
        "sessionCatalog",
        { cwd, ...(sessionId && { sessionId }) },
        signal
      ),
    read: (sessionId, signal) => rpcCall("sessionRead", { sessionId }, signal),
    apply: (input, signal) => rpcCall("sessionApply", input, signal),
  }
}
