import { createContext } from "react"
import { rpcCall } from "@/lib/rpc/client"
export const createCommandService = () => ({
  run: (
    sessionId: string,
    commandRequestId: string,
    name: string,
    args: string
  ) =>
    rpcCall("conversationCommandRun", {
      sessionId,
      commandRequestId,
      name,
      arguments: args,
    }),
  read: (sessionId: string, commandRequestId: string) =>
    rpcCall("conversationCommandRead", { sessionId, commandRequestId }),
})
export const CommandServiceContext = createContext<
  ReturnType<typeof createCommandService> | undefined
>(undefined)
