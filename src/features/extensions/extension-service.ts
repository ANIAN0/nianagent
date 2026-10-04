import { createContext } from "react"
import { modelCall } from "@/features/models/model-service"
import type {
  ExtensionDescriptor,
  RpcRequests,
  WriteReceipt,
} from "@/features/models/model-contract.generated"

export type { ExtensionDescriptor } from "@/features/models/model-contract.generated"
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
    list: (signal) => modelCall("extensionList", {}, signal),
    configure: (value, signal, operationRequestId) =>
      modelCall(
        "extensionConfigure",
        {
          ...value,
          ...(operationRequestId ? { operationRequestId } : {}),
        },
        signal
      ),
    readWriteReceipt: (operation, operationRequestId, signal) =>
      modelCall("writeReceiptRead", { operation, operationRequestId }, signal),
  }
}
