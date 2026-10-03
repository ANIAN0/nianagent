import { modelCall } from "@/features/models/model-service"
import type {
  McpConfiguration,
  McpServer,
  McpTestResult,
} from "@/features/models/model-contract.generated"
export type { McpConfiguration, McpServer, McpTestResult }
export type McpService = {
  list(signal?: AbortSignal): Promise<McpServer[]>
  save(
    configuration: McpConfiguration,
    revision?: number,
    signal?: AbortSignal
  ): Promise<McpServer>
  remove(name: string, revision: number, signal?: AbortSignal): Promise<void>
  test(
    configuration: McpConfiguration,
    cwd: string,
    signal?: AbortSignal
  ): Promise<McpTestResult>
}
export const createMcpService = (): McpService => ({
  list: (signal) => modelCall("mcpList", {}, signal),
  save: (configuration, revision, signal) =>
    modelCall("mcpSave", { configuration, revision }, signal),
  remove: async (name, revision, signal) => {
    await modelCall("mcpRemove", { name, revision }, signal)
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
