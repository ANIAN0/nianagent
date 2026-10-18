import type { ApiDocument } from "../api-catalog/components/types"
import type { Schema } from "../backend/contract.mjs"
export function documentSchema(value: Schema, key?: string): Schema
export function collectReferencedSchemas(
  roots: readonly Schema[],
  registry?: Record<string, Schema>,
  operation?: string
): Record<string, Schema>
export function createApiDocumentation(): Record<string, ApiDocument>
