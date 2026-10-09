import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { format, resolveConfig } from "prettier"
import {
  desktopSchemas,
  desktopCommands,
  desktopEvents,
} from "../backend/desktop-contract.mjs"
const pascal = (value) => value[0].toUpperCase() + value.slice(1)
const snake = (value) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
function ts(schema) {
  if (schema.$ref) return schema.$ref
  if (schema.nullable) return `${ts(schema.nullable)} | null`
  if (schema.enum) return schema.enum.map(JSON.stringify).join(" | ")
  if (schema.type === "array") return `(${ts(schema.items)})[]`
  if (schema.type === "object")
    return `{${Object.entries(schema.properties)
      .map(([key, value]) => `${key}: ${ts(value)}`)
      .join(";")}}`
  return schema.type === "integer" ? "number" : schema.type
}
function rustType(schema) {
  if (schema.$ref) return schema.$ref
  if (schema.nullable) return `Option<${rustType(schema.nullable)}>`
  if (schema.type === "array") return `Vec<${rustType(schema.items)}>`
  return { string: "String", integer: "u64", boolean: "bool" }[schema.type]
}
const outputs = new Map()
const types = Object.entries(desktopSchemas)
  .map(([name, schema]) => `export type ${name} = ${ts(schema)}`)
  .join("\n")
const mapping = (key) =>
  Object.entries(desktopCommands)
    .map(
      ([name, command]) =>
        `${name}: ${command[key] === "OptionalString" ? "string | null" : command[key] || (key === "input" ? "undefined" : "null")}`
    )
    .join(";\n")
const target = new URL("../src/contracts/desktop.generated.ts", import.meta.url)
outputs.set(
  target,
  await format(
    `// Generated from backend/desktop-contract.mjs. Do not edit.\n${types}\nexport type DesktopRequests = {${mapping("input")}}\nexport type DesktopResults = {${mapping("result")}}\nexport type DesktopCommand = keyof DesktopRequests\nexport const desktopCommandMetadata = ${JSON.stringify(desktopCommands)} as const\nexport const desktopSchemaMetadata = ${JSON.stringify(desktopSchemas)} as const\nexport type DesktopEvents = {${Object.entries(
      desktopEvents
    )
      .map(([name, value]) => `${JSON.stringify(name)}: ${value}`)
      .join(";")}}\n`,
    { ...(await resolveConfig(fileURLToPath(target))), parser: "typescript" }
  )
)
const rust = Object.entries(desktopSchemas)
  .map(([name, schema]) => {
    const common =
      "#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]\n"
    if (schema.enum)
      return `${common}pub enum ${name} {\n${schema.enum.map((value) => `    #[serde(rename = ${JSON.stringify(value)})]\n    ${pascal(value)},`).join("\n")}\n}`
    return `${common}#[serde(rename_all = "camelCase", deny_unknown_fields)]\npub struct ${name} {\n${Object.entries(
      schema.properties
    )
      .map(([key, value]) => `    pub ${snake(key)}: ${rustType(value)},`)
      .join("\n")}\n}`
  })
  .join("\n\n")
outputs.set(
  new URL("../src-tauri/src/desktop_contract_generated.rs", import.meta.url),
  `// Generated from backend/desktop-contract.mjs. Do not edit.\n${rust}\n`
)
for (const [url, value] of outputs) {
  if (process.argv.includes("--check")) {
    if ((await readFile(url, "utf8")) !== value)
      throw new Error("桌面契约已漂移，请生成桌面契约。")
  } else await writeFile(url, value)
}
if (process.argv.includes("--check")) {
  const entry = await readFile(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8"
  )
  for (const name of Object.keys(desktopCommands))
    if (!entry.includes(`desktop_commands::${name}`))
      throw new Error(`桌面命令未注册：${name}`)
}
