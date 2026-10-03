import type { operations, Schema } from "../../backend/contract.mjs"
import type { ModelOperation } from "@/features/models/model-contract.generated"

export type { Schema, ModelOperation }
export type OperationDefinition = (typeof operations)[ModelOperation]
export type SchemaRegistry = Record<string, Schema>
export type NavigationItem = {
  id: ModelOperation
  title: string
  module: string
  effect?: string
}
export type CatalogResponse = {
  status: "idle" | "running" | "success" | "error" | "cancelled"
  text: string
  elapsedMs?: number
  startedAt?: string
}
