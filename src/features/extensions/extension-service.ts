import { createContext } from "react"
import { rpcCall } from "@/lib/rpc/client"
import type {
  ExtensionDescriptor,
  RpcRequests,
  WriteReceipt,
} from "@/contracts/rpc.generated"

export type { ExtensionDescriptor } from "@/contracts/rpc.generated"
export type ExtensionConfiguration = Omit<
  RpcRequests["extensionConfigure"],
  "operationRequestId"
>
export type ExtensionService = {
  /** Catalog fixtures must never write formal recovery storage. */
  evidence?: "demo"
  list(signal?: AbortSignal): Promise<ExtensionDescriptor[]>
  configure(
    value: ExtensionConfiguration,
    signal?: AbortSignal,
    operationRequestId?: string
  ): Promise<ExtensionDescriptor>
  readWriteReceipt(
    operation: "extensionConfigure",
    operationRequestId: string,
    signal?: AbortSignal
  ): Promise<WriteReceipt>
}

export const ExtensionServiceContext = createContext<ExtensionService | null>(
  null
)

/** The same formal transport and operation identity as other application configuration. */
export function createExtensionService(): ExtensionService {
  return {
    list: (signal) => rpcCall("extensionList", {}, signal),
    configure: (value, signal, operationRequestId) =>
      rpcCall(
        "extensionConfigure",
        {
          ...value,
          ...(operationRequestId ? { operationRequestId } : {}),
        },
        signal
      ),
    readWriteReceipt: (operation, operationRequestId, signal) =>
      rpcCall("writeReceiptRead", { operation, operationRequestId }, signal),
  }
}
