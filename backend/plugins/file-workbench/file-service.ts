import { createContext, useContext } from "react"
import { callPlugin } from "@/features/plugins/plugin-service"
import { rpcCall } from "@/lib/rpc/client"
import { invoke, isTauri } from "@tauri-apps/api/core"
import type { ConversationChatTool } from "@/contracts/rpc.generated"

export type FileWorkbenchService = {
  call: <T>(
    operation: string,
    input: object,
    sessionId: string,
    signal?: AbortSignal
  ) => Promise<T>
  tools: (
    sessionId: string,
    signal: AbortSignal
  ) => Promise<ConversationChatTool[]>
  desktop?: {
    editorPath: (signal: AbortSignal) => Promise<string>
    exportFile: (path: string, name: string) => Promise<string | null>
    open: (path: string, program: string | null) => Promise<void>
  }
}
export const fileWorkbenchService: FileWorkbenchService = {
  ...(isTauri()
    ? {
        desktop: {
          editorPath: async (signal: AbortSignal) => {
            const plugins = await rpcCall("pluginList", {}, signal)
            return (
              JSON.parse(
                plugins.find((plugin) => plugin.id === "file-workbench")
                  ?.configuration || "{}"
              ).editorPath || ""
            )
          },
          exportFile: (path: string, name: string) =>
            invoke<string | null>("file_export", { input: { path, name } }),
          open: (path: string, program: string | null) =>
            invoke<void>("file_open", { input: { path, program } }),
        },
      }
    : {}),
  call: async <T>(
    operation: string,
    input: object,
    sessionId: string,
    signal?: AbortSignal
  ) =>
    (
      await callPlugin<{ value: T }>(
        "file-workbench",
        operation,
        input,
        sessionId,
        signal
      )
    ).value,
  tools: async (sessionId, signal) =>
    (await rpcCall("conversationRead", { sessionId }, signal)).messages
      .flatMap((message) => message.tools || [])
      .filter((tool) => tool.status === "success" && !!tool.artifact),
}
export const FileWorkbenchServiceContext = createContext(fileWorkbenchService)
export const useFileWorkbenchService = () =>
  useContext(FileWorkbenchServiceContext)
