import type { Schema } from "../backend/contract.mjs"

type ApiDocument = {
  module: string
  source: string
  consumers: string[]
  definition: {
    title: string
    method: string
    effect: string
    condition: string
    errors: string
    request: Schema
    response: Schema
  }
  schemas: Record<string, Schema>
}
export function documentSchema(value: Schema, key?: string): Schema
export function collectReferencedSchemas(
  roots: readonly Schema[],
  registry?: Record<string, Schema>,
  operation?: string
): Record<string, Schema>
export function createApiDocumentation(): Record<string, ApiDocument>
