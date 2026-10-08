import { apiIndex } from "virtual:moon-api-index"
import type { ModelOperation } from "@/contracts/rpc.generated"
import type { OperationDefinition, SchemaRegistry } from "./components/types"

export type OperationIndexItem = {
  id: ModelOperation
  title: string
  module: string
  effect: string
}
export const operationIndex: readonly OperationIndexItem[] = apiIndex
export type OperationDocumentation = {
  definition: OperationDefinition
  schemas: SchemaRegistry
}
const pendingDocuments = new Map<
  ModelOperation,
  Promise<OperationDocumentation>
>()
export function loadOperationDocs(
  operation: ModelOperation
): Promise<OperationDocumentation> {
  let pending = pendingDocuments.get(operation)
  if (!pending) {
    pending = import("virtual:moon-api-docs")
      .then(({ operationDocs }) => {
        if (!Object.hasOwn(operationDocs, operation))
          throw new Error(`找不到接口文档：${operation}`)
        return operationDocs[operation]()
      })
      .catch((error: unknown) => {
        pendingDocuments.delete(operation)
        throw error
      })
    pendingDocuments.set(operation, pending)
  }
  return pending
}
export type Contract = typeof import("../backend/contract.mjs")
let pendingContract: Promise<Contract> | undefined
export function loadContract() {
  pendingContract ??= import("../backend/contract.mjs").catch(
    (error: unknown) => {
      pendingContract = undefined
      throw error
    }
  )
  return pendingContract
}
export const loadArchitecture = () =>
  import("./architecture-data").then((module) => module.architectureText())
export function readLocation(search = location.search) {
  const params = new URLSearchParams(search)
  const operation = params.get("operation") ?? "list"
  const module = params.get("module")
  return { operation, module }
}
export function operationUrl(operation: string) {
  return `?${new URLSearchParams({ operation })}`
}
export function moduleUrl(module: string) {
  return `?${new URLSearchParams({ module })}`
}
