import { createContext, useContext } from "react"
import type { ConversationChatTool } from "@/contracts/rpc.generated"
export const PluginPathContext = createContext<null | {
  openPath: (path: string) => Promise<void>
  reference: (path: string) => Promise<void>
  download: (path: string) => Promise<void>
  openChange?: (tool: Pick<ConversationChatTool, "id" | "occurrenceId">) => void
}>(null)
export const usePluginPaths = () => useContext(PluginPathContext)
