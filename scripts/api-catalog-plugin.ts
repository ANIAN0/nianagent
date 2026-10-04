import type { Plugin } from "vite"
import { operations, schemas } from "../backend/contract.mjs"
import type { Schema } from "../backend/contract.mjs"

const indexId = "virtual:moon-api-index"
const docsId = "virtual:moon-api-docs"
const documentPrefix = `${docsId}/`

/** Follow the same JSON Schema subset as the formal runtime contract, including cycles. */
export function collectReferencedSchemas(
  roots: readonly Schema[],
  registry: Record<string, Schema>,
  operation = "documentation"
): Record<string, Schema> {
  const selected: Record<string, Schema> = Object.create(null)
  const visited = new Set<string>()
  function visit(schema: Schema, path: string) {
    if (schema.$ref) {
      const name = schema.$ref
      if (!Object.hasOwn(registry, name))
        throw new Error(
          `API documentation ${operation}: ${path} references missing schema ${name}`
        )
      if (!visited.has(name)) {
        visited.add(name)
        selected[name] = registry[name]!
        visit(registry[name]!, `schemas.${name}`)
      }
    }
    for (const [name, property] of Object.entries(schema.properties ?? {}))
      visit(property, `${path}.properties.${name}`)
    if (schema.items) visit(schema.items, `${path}.items`)
    schema.anyOf?.forEach((part, index) =>
      visit(part, `${path}.anyOf[${index}]`)
    )
  }
  roots.forEach((schema, index) =>
    visit(schema, index ? "response" : "request")
  )
  return selected
}

/** Derive a document from the authority; never persist a second editable definition. */
export function createOperationDocumentation(operation: string) {
  if (!Object.hasOwn(operations, operation))
    throw new Error(`API documentation: unknown operation ${operation}`)
  const definition = operations[operation as keyof typeof operations]
  return {
    definition,
    schemas: collectReferencedSchemas(
      [definition.request, definition.response, { $ref: "RpcFailure" }],
      schemas,
      operation
    ),
  }
}

/** Navigation and detailed documents are separate virtual modules derived from one authority. */
export function apiCatalogPlugin(): Plugin {
  return {
    name: "moon-api-catalog-index",
    resolveId(id) {
      if (
        id === indexId ||
        id === docsId ||
        (id.startsWith(documentPrefix) &&
          Object.hasOwn(operations, id.slice(documentPrefix.length)))
      )
        return `\0${id}`
    },
    load(id) {
      if (id === `\0${indexId}`) {
        const items = Object.entries(operations).map(([id, definition]) => ({
          id,
          title: definition.title,
          module: definition.module ?? "模型配置",
          effect: definition.effect,
        }))
        return `export const apiIndex = ${JSON.stringify(items)}`
      }
      if (id === `\0${docsId}`) {
        const loaders = Object.keys(operations).map(
          (operation) =>
            `${JSON.stringify(operation)}: () => import(${JSON.stringify(`${documentPrefix}${operation}`)})`
        )
        return `export const operationDocs = {${loaders.join(",")}}`
      }
      if (id.startsWith(`\0${documentPrefix}`)) {
        const document = createOperationDocumentation(
          id.slice(documentPrefix.length + 1)
        )
        return (
          `export const definition = ${JSON.stringify(document.definition)};\n` +
          `export const schemas = ${JSON.stringify(document.schemas)};\n`
        )
      }
    },
    handleHotUpdate(context) {
      if (
        !/backend\/(?:.*contract|schema)\.mjs$/.test(
          context.file.replaceAll("\\", "/")
        )
      )
        return
      // Vite reloads its configuration dependency when a contract changes. The
      // catalog refresh reads a matching navigation index and selected document.
      context.server.ws.send({ type: "full-reload" })
    },
  }
}
