import { modelCall } from "@/features/models/model-service"
import type {
  McpConfiguration,
  McpServer,
  McpTestResult,
  WriteReceipt,
} from "@/features/models/model-contract.generated"
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
    modelCall("writeReceiptRead", { operation, operationRequestId }, signal),
  list: (signal) => modelCall("mcpList", {}, signal),
  save: (configuration, revision, signal, operationRequestId) =>
    modelCall(
      "mcpSave",
      { configuration, revision, operationRequestId },
      signal
    ),
  remove: async (name, revision, signal, operationRequestId) => {
    await modelCall("mcpRemove", { name, revision, operationRequestId }, signal)
  },
  test: (configuration, cwd, signal) =>
    modelCall("mcpTest", { configuration, cwd }, signal),
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
