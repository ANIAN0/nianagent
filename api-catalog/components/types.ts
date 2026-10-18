import type { operations, Schema } from "../../backend/contract.mjs"
import type { ModelOperation } from "@/contracts/rpc.generated"

export type { Schema, ModelOperation }
export type OperationDefinition = (typeof operations)[ModelOperation]
export type SchemaRegistry = Record<string, Schema>
export type NavigationItem = {
  id: string
  title: string
  module: string
  effect?: string
}
export type { ResponseState as CatalogResponse } from "../request-controller"

export type ApiDocument = {
  definition: OperationDefinition
  schemas: SchemaRegistry
  kind: "rpc" | "plugin" | "desktop"
  module: string
  source: string
  storage: string
  responsibility: string
  consumers: string[]
  plugin?: string
  name?: string
  envelope?: OperationDefinition
  related?: string[]
}
