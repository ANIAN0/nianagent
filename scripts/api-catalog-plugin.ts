import type { Plugin } from "vite"
import { operations } from "../backend/contract.mjs"
import { createApiDocumentation } from "./api-documentation.mjs"
export { collectReferencedSchemas } from "./api-documentation.mjs"
const indexId = "virtual:moon-api-index"
const docsId = "virtual:moon-api-docs"
const allId = "virtual:moon-api-documents"
const prefix = `${docsId}/`

/** Projects pure shared contracts, never imports or activates a plugin host. */
export function apiCatalogPlugin(): Plugin {
  let documents: ReturnType<typeof createApiDocumentation> | undefined
  const read = () => (documents ??= createApiDocumentation())
  return {
    name: "moon-api-catalog-index",
    resolveId(id) {
      if (
        [indexId, docsId, allId].includes(id) ||
        (id.startsWith(prefix) &&
          Object.hasOwn(operations, id.slice(prefix.length)))
      )
        return `\0${id}`
    },
    load(id) {
      if (id === `\0${allId}`)
        return `export const apiDocuments = ${JSON.stringify(read())}`
      if (id === `\0${indexId}`)
        return `export const apiIndex = ${JSON.stringify(Object.entries(operations).map(([id, op]) => ({ id, title: op.title, module: op.module ?? "模型配置", effect: op.effect })))}; export const fileApiIndex = []`
      if (id === `\0${docsId}`)
        return `export const operationDocs = {${Object.keys(operations)
          .map(
            (id) =>
              `${JSON.stringify(id)}: () => import(${JSON.stringify(prefix + id)})`
          )
          .join(",")}}`
      if (id.startsWith(`\0${prefix}`)) {
        const doc = read()[id.slice(prefix.length + 1)]
        return `export const definition = ${JSON.stringify(doc.definition)}; export const schemas = ${JSON.stringify(doc.schemas)}`
      }
    },
    handleHotUpdate(context) {
      if (
        /backend\/(?:.*contract|schema)\.mjs$/.test(
          context.file.replaceAll("\\", "/")
        )
      ) {
        documents = undefined
        context.server.ws.send({
          type: "full-reload",
          path: "/api-catalog/index.html",
        })
      }
    },
  }
}
