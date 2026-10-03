import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { operations, schemas } from "../../backend/contract.mjs"
import {
  apiCatalogPlugin,
  collectReferencedSchemas,
  createOperationDocumentation,
} from "../api-catalog-plugin.ts"

function virtualSource(id) {
  const plugin = apiCatalogPlugin()
  const resolved = plugin.resolveId(id)
  assert.equal(resolved, `\0${id}`, `${id} resolves as its own virtual module`)
  const source = plugin.load(resolved)
  assert.equal(typeof source, "string")
  return source
}

function importSource(source) {
  return import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  )
}

function referencedNames(schema) {
  const names = new Set()
  JSON.stringify(schema, (_key, value) => {
    if (value && typeof value === "object" && typeof value.$ref === "string")
      names.add(value.$ref)
    return value
  })
  return names
}

test("every formal operation document preserves its definition and contains complete referenced schemas", async () => {
  for (const [operation, formal] of Object.entries(operations)) {
    const document = await importSource(
      virtualSource(`virtual:moon-api-docs/${operation}`)
    )
    assert.deepEqual(Object.keys(document).sort(), ["definition", "schemas"])
    assert.deepEqual(document.definition, formal)
    const needed = referencedNames([formal.request, formal.response])
    const pending = [...needed]
    while (pending.length) {
      const name = pending.shift()
      assert.ok(
        Object.hasOwn(document.schemas, name),
        `${operation} resolves ${name}`
      )
      assert.deepEqual(document.schemas[name], schemas[name])
      for (const reference of referencedNames(document.schemas[name])) {
        if (!needed.has(reference)) {
          needed.add(reference)
          pending.push(reference)
        }
      }
    }
    assert.deepEqual(
      Object.keys(document.schemas).sort(),
      [...needed].sort(),
      `${operation} has no unrelated schema`
    )
  }
})

test("a simple selected operation carries no other definitions or unrelated registered schemas", async () => {
  const document = await importSource(
    virtualSource("virtual:moon-api-docs/providers")
  )
  assert.deepEqual(document.definition, operations.providers)
  assert.deepEqual(document.schemas, {})
  assert.equal(document.operations, undefined)
  assert.notDeepEqual(document.definition, operations.list)
  const list = createOperationDocumentation("list")
  assert.ok(Object.hasOwn(list.schemas, "ModelConnection"))
  assert.equal(Object.hasOwn(list.schemas, "SessionCatalog"), false)
})

test("navigation contains only formal summaries and has no detailed documentation dependency", async () => {
  const source = virtualSource("virtual:moon-api-index")
  const { apiIndex } = await importSource(source)
  assert.deepEqual(
    apiIndex.map((item) => item.id),
    Object.keys(operations)
  )
  for (const item of apiIndex) {
    assert.deepEqual(Object.keys(item).sort(), [
      "effect",
      "id",
      "module",
      "title",
    ])
    const formal = operations[item.id]
    assert.equal(item.title, formal.title)
    assert.equal(item.module, formal.module ?? "模型配置")
    assert.equal(item.effect, formal.effect)
  }
  assert.equal(source.includes("virtual:moon-api-docs"), false)
  assert.equal(source.includes("import("), false)
})

test("the documentation index imports only each selected virtual document through lazy loaders", () => {
  const source = virtualSource("virtual:moon-api-docs")
  const ast = ts.createSourceFile(
    "docs.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  assert.equal(ast.statements.length, 1)
  const declaration = ast.statements[0].declarationList.declarations[0]
  assert.equal(declaration.name.text, "operationDocs")
  assert.ok(ts.isObjectLiteralExpression(declaration.initializer))
  const properties = declaration.initializer.properties
  assert.deepEqual(
    properties.map((property) => property.name.text),
    Object.keys(operations)
  )
  for (const property of properties) {
    assert.ok(ts.isArrowFunction(property.initializer))
    const body = property.initializer.body
    assert.ok(ts.isCallExpression(body))
    assert.equal(body.expression.kind, ts.SyntaxKind.ImportKeyword)
    assert.equal(
      body.arguments[0].text,
      `virtual:moon-api-docs/${property.name.text}`
    )
  }
})

test("recursive references are included once; arrays, unions and nested objects remain complete", () => {
  const registry = {
    Root: {
      type: "object",
      properties: { nodes: { type: "array", items: { $ref: "Node" } } },
    },
    Node: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: { parent: { $ref: "Root" }, state: { $ref: "State" } },
        },
      ],
    },
    State: { type: "string", enum: ["ready", "running"] },
    Unrelated: { type: "boolean" },
  }
  const selected = collectReferencedSchemas(
    [{ $ref: "Root" }, { $ref: "Node" }],
    registry
  )
  assert.deepEqual(Object.keys(selected).sort(), ["Node", "Root", "State"])
  assert.equal(selected.Root, registry.Root)
  assert.equal(selected.Node, registry.Node)
})

test("missing schema references and unknown/prototype operation IDs fail explicitly", () => {
  assert.throws(
    () =>
      collectReferencedSchemas(
        [{ type: "array", items: { $ref: "Missing" } }],
        {},
        "broken"
      ),
    /broken.*request\.items.*missing schema Missing/
  )
  const plugin = apiCatalogPlugin()
  for (const operation of ["missing-operation", "toString", "__proto__"]) {
    assert.equal(
      plugin.resolveId(`virtual:moon-api-docs/${operation}`),
      undefined
    )
    assert.throws(
      () => createOperationDocumentation(operation),
      /unknown operation/
    )
  }
})

test("the runtime navigation data statically imports neither documents nor the full formal contract", () => {
  const source = readFileSync(
    new URL("../../api-catalog/catalog-data.ts", import.meta.url),
    "utf8"
  )
  const ast = ts.createSourceFile(
    "catalog-data.ts",
    source,
    ts.ScriptTarget.Latest,
    true
  )
  const imports = ast.statements
    .filter(
      (statement) =>
        ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly
    )
    .map((statement) => statement.moduleSpecifier.text)
  assert.deepEqual(imports, ["virtual:moon-api-index"])
  assert.match(source, /import\("virtual:moon-api-docs"\)/)
  assert.match(source, /import\("\.\.\/backend\/contract\.mjs"\)/)
})
