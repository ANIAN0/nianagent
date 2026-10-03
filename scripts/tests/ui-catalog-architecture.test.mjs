import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import ts from "typescript"
import { createCatalogManifest } from "../ui-catalog-plugin.ts"
import { catalogImportPath } from "../../ui-catalog/catalog-path.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
function sandbox(t) {
  const directory = mkdtempSync(join(tmpdir(), "moon-ui-catalog-"))
  t.after(() => {
    const absolute = resolve(directory)
    assert.ok(absolute.startsWith(resolve(tmpdir()) + sep))
    assert.ok(absolute.split(sep).at(-1).startsWith("moon-ui-catalog-"))
    rmSync(absolute, { recursive: true, force: true })
  })
  return directory
}
function put(root, file, value) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, value)
}
function definition(
  id,
  source,
  states = '[{ id: "default", name: "默认", condition: "初始", expected: "可操作", render: () => { throw new Error("MUST_NOT_RUN") } }]'
) {
  return `throw new Error("MUST_NOT_IMPORT"); export default {
    id: ${JSON.stringify(id)}, name: "组件", layer: "复合组件", group: "试验", source: ${JSON.stringify(source)},
    description: "职责", boundary: "边界", inputs: [], events: [], composition: [], consumers: [], viewport: { width: 800, height: 600 },
    states: ${states}
  }`
}
function definitionsUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? definitionsUnder(path)
      : entry.isFile() && path.endsWith(".catalog.tsx")
        ? [path]
        : []
  })
}

test("automatically extracts every adjacent catalog without executing demonstrations or render functions", (t) => {
  const directory = sandbox(t)
  put(
    directory,
    "src/example.tsx",
    "export function Example() { return <div /> }"
  )
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "src/example.tsx")
  )
  put(
    directory,
    "api-catalog/components/panel.tsx",
    "export function Panel() { return <aside /> }"
  )
  put(
    directory,
    "api-catalog/components/panel.catalog.tsx",
    definition("api-panel", "api-catalog/components/panel.tsx")
  )
  const manifest = createCatalogManifest(directory)
  assert.deepEqual(manifest.entries.map((entry) => entry.id).sort(), [
    "api-panel",
    "example",
  ])
  assert.equal(
    manifest.definitions["api-panel"],
    "../api-catalog/components/panel.catalog.tsx"
  )
  assert.equal("render" in manifest.entries[0].states[0], false)
  assert.equal(JSON.stringify(manifest).includes("MUST_NOT"), false)
})

test("static state maps keep unique IDs, condition text and names without invoking JavaScript", (t) => {
  const directory = sandbox(t)
  put(directory, "src/example.tsx", "export const Example = () => <div />")
  put(
    directory,
    "src/example.catalog.tsx",
    definition(
      "example",
      "src/example.tsx",
      `(["light", "dark"] as const).map((variant) => ({
    id: variant, name: variant === "light" ? "浅色" : "深色", condition: \`theme=\${variant}\`, expected: "可操作", render: () => variant
  }))`
    )
  )
  assert.deepEqual(createCatalogManifest(directory).entries[0].states, [
    { id: "light", name: "浅色", condition: "theme=light", expected: "可操作" },
    { id: "dark", name: "深色", condition: "theme=dark", expected: "可操作" },
  ])
})

test("composition follows used JSX aliases and local export barrels, ignoring unused and type-only imports", (t) => {
  const directory = sandbox(t)
  put(directory, "src/button.tsx", "export const Button = () => <button />")
  put(
    directory,
    "src/button.catalog.tsx",
    definition("button", "src/button.tsx")
  )
  put(directory, "src/unused.tsx", "export const Unused = () => <span />")
  put(
    directory,
    "src/unused.catalog.tsx",
    definition("unused", "src/unused.tsx")
  )
  put(directory, "src/barrel.ts", 'export { Button as Action } from "./button"')
  put(
    directory,
    "src/example.tsx",
    'import { Action as Trigger } from "@/barrel"; import { Unused } from "./unused"; import type { Button } from "./button"; export const Example = () => <Trigger />'
  )
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "src/example.tsx")
  )
  assert.deepEqual(createCatalogManifest(directory).dependencies.example, [
    "button",
  ])
})

test("composition follows consumed JSX loaders, including direct arrows and returned promises, without unused dynamic dependencies", (t) => {
  const directory = sandbox(t)
  for (const id of ["table", "unused", "service"]) {
    put(
      directory,
      `src/${id}.tsx`,
      `throw new Error("MUST_NOT_IMPORT"); export const View = () => <div />`
    )
    put(directory, `src/${id}.catalog.tsx`, definition(id, `src/${id}.tsx`))
  }
  put(
    directory,
    "src/deferred.tsx",
    "export const DeferredContent = () => null"
  )
  put(
    directory,
    "src/example.tsx",
    `
    import { DeferredContent } from "./deferred"
    const unusedLoader = () => import("./unused")
    const fetchService = () => import("./service")
    const loadFields = () => import("./table").then((module) => ({ default: module.View }))
    const blockLoader = () => {
      const ignoredNestedLoader = () => import("./unused")
      const module = import("./table")
      return module.then((value) => ({ default: value.View }))
    }
    export const Example = () => <>
      <DeferredContent load={loadFields} />
      <DeferredContent load={() => import("./table")} />
      <DeferredContent load={blockLoader} />
    </>
  `
  )
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "src/example.tsx")
  )
  assert.deepEqual(createCatalogManifest(directory).dependencies.example, [
    "table",
  ])
})

test("composition follows JSX-consumed React.lazy direct and referenced loaders, excluding unused lazy declarations", (t) => {
  const directory = sandbox(t)
  for (const id of ["direct", "referenced", "unused"]) {
    put(
      directory,
      `src/${id}.tsx`,
      "export default function View() { return <div /> }"
    )
    put(directory, `src/${id}.catalog.tsx`, definition(id, `src/${id}.tsx`))
  }
  put(
    directory,
    "src/example.tsx",
    `
    import { lazy as asyncView } from "react"
    import * as React from "react"
    const loader = () => import("./referenced")
    const Direct = asyncView(() => import("./direct"))
    const Reference = React.lazy(loader)
    const Unused = asyncView(() => import("./unused"))
    export const Example = () => <><Direct /><Reference /></>
  `
  )
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "src/example.tsx")
  )
  assert.deepEqual(createCatalogManifest(directory).dependencies.example, [
    "direct",
    "referenced",
  ])
})

test("formal OperationDocs composition includes its consumed lazy SchemaFieldTable", () => {
  const manifest = createCatalogManifest(root)
  assert.ok(
    manifest.dependencies["api-operation-docs"].includes(
      "api-schema-field-table"
    )
  )
})

test("imported static labels and Object.keys preserve the formal constant as the single authority", (t) => {
  const directory = sandbox(t)
  put(
    directory,
    "src/status.tsx",
    'throw new Error("MUST_NOT_IMPORT"); export const labels = { idle: "空闲", running: "运行中" } as const; export const Status = () => <span />'
  )
  put(
    directory,
    "src/status.catalog.tsx",
    `import { labels } from "./status"; ${definition("status", "src/status.tsx", `Object.keys(labels).map((status) => ({ id: status, name: labels[status], condition: labels[status], expected: "可辨认", render: () => status }))`)}`
  )
  assert.deepEqual(createCatalogManifest(directory).entries[0].states, [
    { id: "idle", name: "空闲", condition: "空闲", expected: "可辨认" },
    { id: "running", name: "运行中", condition: "运行中", expected: "可辨认" },
  ])
})

test("catalog self-documentation preview and source keys match the relative Vite globs", (t) => {
  const directory = sandbox(t)
  put(
    directory,
    "ui-catalog/components/panel.tsx",
    "export const Panel = () => <aside />"
  )
  put(
    directory,
    "ui-catalog/components/panel.catalog.tsx",
    definition("catalog-panel", "ui-catalog/components/panel.tsx")
  )
  const manifest = createCatalogManifest(directory)
  assert.equal(
    manifest.definitions["catalog-panel"],
    "./components/panel.catalog.tsx"
  )
  assert.equal(
    catalogImportPath(manifest.entries[0].source),
    "./components/panel.tsx"
  )
  const actualGlobKeys = new Set(
    definitionsUnder(join(directory, "ui-catalog")).map(
      (file) =>
        `./${relative(join(directory, "ui-catalog"), file).split(sep).join("/")}`
    )
  )
  assert.ok(actualGlobKeys.has(manifest.definitions["catalog-panel"]))
  assert.equal(
    catalogImportPath("src/components/ui/button.tsx"),
    "../src/components/ui/button.tsx"
  )
  assert.equal(
    catalogImportPath("api-catalog/components/request-editor.tsx"),
    "../api-catalog/components/request-editor.tsx"
  )
})

test("duplicate component and state IDs fail at the source definition", (t) => {
  const directory = sandbox(t)
  put(directory, "src/example.tsx", "export const Example = () => <div />")
  put(
    directory,
    "src/one.catalog.tsx",
    definition("example", "src/example.tsx")
  )
  put(
    directory,
    "src/two.catalog.tsx",
    definition("example", "src/example.tsx")
  )
  assert.throws(
    () => createCatalogManifest(directory),
    /two\.catalog\.tsx: 组件标识重复/
  )
  rmSync(join(directory, "src/two.catalog.tsx"))
  put(
    directory,
    "src/one.catalog.tsx",
    definition(
      "example",
      "src/example.tsx",
      '[{id:"same",name:"一",condition:"a",expected:"a",render:()=>null},{id:"same",name:"二",condition:"b",expected:"b",render:()=>null}]'
    )
  )
  assert.throws(() => createCatalogManifest(directory), /states\.same（重复）/)
})

test("dynamic metadata and missing or out-of-scope source paths are rejected instead of silently hidden", (t) => {
  const directory = sandbox(t)
  put(directory, "src/example.tsx", "export const Example = () => <div />")
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "src/example.tsx").replace(
      'name: "组件"',
      "name: getName()"
    )
  )
  assert.throws(
    () => createCatalogManifest(directory),
    /目录文档必须使用静态值/
  )
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "src/missing.tsx")
  )
  assert.throws(() => createCatalogManifest(directory), /正式源码不存在/)
  put(
    directory,
    "src/example.catalog.tsx",
    definition("example", "../outside.tsx")
  )
  assert.throws(() => createCatalogManifest(directory), /超出组件目录/)
})

test("project index remains metadata-only and formal source relations include the home composer", () => {
  const manifest = createCatalogManifest(root)
  assert.equal(
    manifest.entries.length,
    ["src", "api-catalog", "ui-catalog"].flatMap((directory) =>
      definitionsUnder(join(root, directory))
    ).length
  )
  assert.ok(manifest.dependencies["home-page"].includes("home-composer"))
  assert.ok(
    manifest.entries.every((entry) =>
      entry.states.every((state) => !("render" in state))
    )
  )
  assert.ok(manifest.entries.every((entry) => manifest.definitions[entry.id]))
})

test("preview and source modules use deferred glob functions and the iframe never imports the full documentation index", () => {
  const calls = []
  for (const name of ["catalog-loader.ts", "source-loader.ts"]) {
    const file = ts.createSourceFile(
      name,
      readFileSync(join(root, "ui-catalog", name), "utf8"),
      ts.ScriptTarget.Latest,
      true
    )
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.MetaProperty &&
        node.expression.name.text === "glob"
      )
        calls.push([node, file])
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  assert.equal(calls.length, 2)
  for (const [call, file] of calls) {
    const options = call.arguments[1]
    assert.ok(
      !options ||
        !ts.isObjectLiteralExpression(options) ||
        !options.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText(file) === "eager" &&
            property.initializer.kind === ts.SyntaxKind.TrueKeyword
        ),
      "eager glob would execute all demonstrations or load all source text on first access"
    )
  }
  const preview = ts.createSourceFile(
    "preview.tsx",
    readFileSync(join(root, "ui-catalog/preview.tsx"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  assert.ok(
    !preview.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        ["./catalog", "./source-loader", "virtual:moon-ui-catalog"].includes(
          statement.moduleSpecifier.text
        )
    ),
    "an iframe must not parse every component's documentation or source import map"
  )
})
