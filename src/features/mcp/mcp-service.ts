import { rpcCall } from "@/lib/rpc/client"
import type {
  McpConfiguration,
  McpServer,
  McpTestResult,
  WriteReceipt,
} from "@/contracts/rpc.generated"
export type { McpConfiguration, McpServer, McpTestResult }
export type McpService = {
  evidence?: "demo"
  readWriteReceipt?: (
    operation: WriteReceipt["operation"],
    operationRequestId: string,
    signal?: AbortSignal
  ) => Promise<WriteReceipt>
  list(signal?: AbortSignal): Promise<McpServer[]>
  save(
    configuration: McpConfiguration,
    revision?: number,
    signal?: AbortSignal,
    operationRequestId?: string
  ): Promise<McpServer>
  remove(
    name: string,
    revision: number,
    signal?: AbortSignal,
    operationRequestId?: string
  ): Promise<void>
  test(
    configuration: McpConfiguration,
    cwd: string,
    signal?: AbortSignal
  ): Promise<McpTestResult>
}
export const createMcpService = (): McpService => ({
  readWriteReceipt: (operation, operationRequestId, signal) =>
    rpcCall("writeReceiptRead", { operation, operationRequestId }, signal),
  list: (signal) => rpcCall("mcpList", {}, signal),
  save: (configuration, revision, signal, operationRequestId) =>
    rpcCall("mcpSave", { configuration, revision, operationRequestId }, signal),
  remove: async (name, revision, signal, operationRequestId) => {
    await rpcCall("mcpRemove", { name, revision, operationRequestId }, signal)
  },
  test: (configuration, cwd, signal) =>
    rpcCall("mcpTest", { configuration, cwd }, signal),
})
export const blankMcpConfiguration = (): McpConfiguration => ({
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  cwd: "",
  env: [],
  url: "",
  headers: [],
  description: "",
  enabled: true,
  exposure: "codemode",
  timeout: 60,
})
