import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
export const createCommandService = () => ({
  run: (
    sessionId: string,
    commandRequestId: string,
    name: string,
    args: string
  ) =>
    modelCall("conversationCommandRun", {
      sessionId,
      commandRequestId,
      name,
      arguments: args,
    }),
  read: (sessionId: string, commandRequestId: string) =>
    modelCall("conversationCommandRead", { sessionId, commandRequestId }),
})
export const CommandServiceContext = createContext<
  ReturnType<typeof createCommandService> | undefined
>(undefined)
