import { fileURLToPath } from "node:url"
import { readFile, writeFile } from "node:fs/promises"
import {
  schemas,
  operations,
  transportRecoveryByOperation,
} from "../backend/contract.mjs"
import { format, resolveConfig } from "prettier"
function type(schema) {
  if (schema.$ref) return schema.$ref
  if (schema.anyOf) return schema.anyOf.map(type).join(" | ")
  if (schema.enum)
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ")
  if (schema.type === "array") return `(${type(schema.items)})[]`
  if (schema.type === "object" && !Object.keys(schema.properties).length)
    return "Record<string, never>"
  if (schema.type === "object")
    return `{\n${Object.entries(schema.properties)
      .map(
        ([key, value]) =>
          `/** ${(value.description || "").replaceAll("*/", "")} */\n${JSON.stringify(key)}${schema.required.includes(key) ? "" : "?"}: ${type(value)}`
      )
      .join("\n")}\n}`
  return schema.type === "integer" ? "number" : schema.type
}
const output = `// Generated from backend/schema.mjs and backend/contract.mjs. Do not edit.\nexport const transportRecoveryByOperation = ${JSON.stringify(transportRecoveryByOperation)} as const\nexport const receiptOperationNames = ${JSON.stringify(Object.keys(operations).filter((name) => operations[name].writeReceipt))} as const\nexport const queueReceiptOperationNames = ${JSON.stringify(Object.keys(operations).filter((name) => operations[name].queueReceipt))} as const\n${Object.entries(
  schemas
)
  .map(([name, schema]) => `export type ${name} = ${type(schema)}`)
  .join("\n")}\nexport type RpcRequests = {\n${Object.entries(operations)
  .map(([name, op]) => `${name}: ${type(op.request)}`)
  .join("\n")}\n}\nexport type RpcResults = {\n${Object.entries(operations)
  .map(([name, op]) => `${name}: ${type(op.response)}`)
  .join("\n")}\n}\nexport type ModelOperation = keyof RpcRequests\n`
const url = new URL("../src/contracts/rpc.generated.ts", import.meta.url)
const formatted = await format(output, {
  ...(await resolveConfig(fileURLToPath(url))),
  parser: "typescript",
  semi: false,
})
if (process.argv.includes("--check")) {
  if ((await readFile(url, "utf8")) !== formatted)
    throw new Error("模型契约类型已漂移，请运行 pnpm contract:generate。")
} else await writeFile(url, formatted)
