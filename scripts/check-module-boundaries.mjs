// AST运行时依赖检查：忽略纯类型与JSDoc引用以检测环；同时校验模块地图失效前缀与方向性跨边界直连。
import ts from "typescript"
import { readdir, readFile } from "node:fs/promises"
import { resolve, relative, dirname, join } from "node:path"
import {
  LEGACY_DIRECTIONAL_ALLOWLIST,
  checkDirectionalBoundary,
  loadProjectModules,
  stripModuleExtension,
} from "./eslint-module-boundaries.mjs"

const root = process.cwd(),
  files = [],
  projectFiles = []

async function walk(dir, list, filter) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "target", ".dev", ".git"].includes(e.name))
      continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, list, filter)
    else if (filter(p)) list.push(p)
  }
}

const isModuleSource = (p) =>
  /\.(mjs|tsx?|jsx?)$/.test(p) &&
  !p.endsWith(".d.ts") &&
  !p.endsWith(".d.mts")

await walk(resolve("backend"), files, isModuleSource)
await walk(resolve("src"), files, isModuleSource)
for (const dir of [
  "src",
  "backend",
  "devtools",
  "scripts",
  "src-tauri",
  "public",
]) {
  await walk(resolve(dir), projectFiles, () => true)
}

const known = new Set(files),
  edges = new Map(),
  dynamic = [],
  boundaryViolations = [],
  seenStaticEdges = new Set()

const { codeModules, codeModuleFor } = loadProjectModules(root)
const trackedRelFiles = projectFiles.map((file) =>
  relative(root, file).replaceAll("\\", "/")
)
const deadPrefixes = []
for (const module of codeModules) {
  for (const prefix of module.prefixes) {
    if (!prefix) continue
    if (!trackedRelFiles.some((file) => file.startsWith(prefix))) {
      deadPrefixes.push(`${module.id}:${prefix}`)
    }
  }
}

function resolveKnownFile(fromFile, spec) {
  if (!spec?.startsWith(".") && !spec?.startsWith("@/")) return null
  const p = spec.startsWith("@/")
    ? resolve("src", spec.slice(2))
    : resolve(dirname(fromFile), spec)
  return (
    [
      p,
      ...[".ts", ".tsx", ".mjs", ".js"].map((e) => p + e),
      resolve(p, "index.ts"),
      resolve(p, "index.tsx"),
    ].find((candidate) => known.has(candidate)) ?? null
  )
}

for (const file of files) {
  const fromRel = relative(root, file).replaceAll("\\", "/")
  const src = ts.createSourceFile(
    file,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
  const runtimeImports = []
  const allStaticImports = []
  function visit(n) {
    if (ts.isImportDeclaration(n)) {
      allStaticImports.push(n.moduleSpecifier.text)
      if (
        !n.importClause?.isTypeOnly &&
        !(
          !n.importClause?.name &&
          n.importClause?.namedBindings &&
          ts.isNamedImports(n.importClause.namedBindings) &&
          n.importClause.namedBindings.elements.length &&
          n.importClause.namedBindings.elements.every((e) => e.isTypeOnly)
        )
      )
        runtimeImports.push(n.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(n) &&
      n.moduleSpecifier &&
      !n.isTypeOnly
    ) {
      allStaticImports.push(n.moduleSpecifier.text)
      if (!(
        n.exportClause &&
        ts.isNamedExports(n.exportClause) &&
        n.exportClause.elements.length &&
        n.exportClause.elements.every((e) => e.isTypeOnly)
      ))
        runtimeImports.push(n.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      if (ts.isStringLiteralLike(n.arguments[0])) {
        runtimeImports.push(n.arguments[0].text)
        allStaticImports.push(n.arguments[0].text)
      } else
        dynamic.push(
          relative(root, file) +
            ":" +
            (src.getLineAndCharacterOfPosition(n.pos).line + 1)
        )
    }
    ts.forEachChild(n, visit)
  }
  visit(src)
  edges.set(
    file,
    runtimeImports.flatMap((name) => {
      const found = resolveKnownFile(file, name)
      return found ? [found] : []
    })
  )
  for (const name of allStaticImports) {
    const found = resolveKnownFile(file, name)
    if (!found) continue
    const toRel = relative(root, found).replaceAll("\\", "/")
    seenStaticEdges.add(
      `${stripModuleExtension(fromRel)} -> ${stripModuleExtension(toRel)}`
    )
    if (fromRel.startsWith("backend/plugins/")) continue
    const violation = checkDirectionalBoundary(fromRel, toRel, codeModuleFor)
    if (violation) {
      boundaryViolations.push(`${violation.messageId}:${violation.edgeKey}`)
    }
  }
}

const staleAllowlist = [...LEGACY_DIRECTIONAL_ALLOWLIST].filter(
  (edge) => !seenStaticEdges.has(edge)
)

let next = 0
const indices = new Map(),
  low = new Map(),
  stack = [],
  on = new Set(),
  cycles = []
function visit(v) {
  indices.set(v, next)
  low.set(v, next++)
  stack.push(v)
  on.add(v)
  for (const w of edges.get(v) || []) {
    if (!indices.has(w)) {
      visit(w)
      low.set(v, Math.min(low.get(v), low.get(w)))
    } else if (on.has(w)) low.set(v, Math.min(low.get(v), indices.get(w)))
  }
  if (low.get(v) === indices.get(v)) {
    const group = []
    let w
    do {
      w = stack.pop()
      on.delete(w)
      group.push(relative(root, w))
    } while (w !== v)
    if (group.length > 1 || (edges.get(v) || []).includes(v)) cycles.push(group)
  }
}
for (const f of files) if (!indices.has(f)) visit(f)
console.log(
  JSON.stringify(
    {
      files: files.length,
      cycles,
      deadPrefixes,
      boundaryViolations,
      staleAllowlist,
      dynamic,
    },
    null,
    2
  )
)

if (
  cycles.length ||
  deadPrefixes.length ||
  boundaryViolations.length ||
  staleAllowlist.length
)
  process.exitCode = 1
