import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, relative, resolve, sep } from "node:path"
import ts from "typescript"
import type { Plugin } from "vite"
import type { CatalogMetadata } from "../ui-catalog/catalog-types.ts"
import { catalogImportPath } from "../ui-catalog/catalog-path.ts"

const publicId = "virtual:moon-ui-catalog"
const resolvedId = `\0${publicId}`
const previewId = "virtual:moon-ui-previews"
const resolvedPreviewId = `\0${previewId}`
const sourceDirectories = ["src", "api-catalog", "ui-catalog"]
type StaticValue =
  | string
  | number
  | boolean
  | null
  | StaticValue[]
  | { [key: string]: StaticValue }
type ImportedBinding = { binding: string; from: string; root: string }
type Scope = Map<string, ts.Expression | StaticValue | ImportedBinding>
export type CatalogManifest = {
  entries: CatalogMetadata[]
  definitions: Record<string, string>
  dependencies: Record<string, string[]>
}

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return unwrap(node.expression)
  return node
}

/** Interpret only declarative metadata; never import a catalog or evaluate its render code. */
function extract(
  node: ts.Expression,
  scope: Scope,
  file: ts.SourceFile,
  resolving = new Set<string>()
): StaticValue {
  node = unwrap(node)
  const fail = (reason: string): never => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file))
    throw new Error(
      `${file.fileName}:${position.line + 1}: ${reason}。目录文档必须使用静态值，交互代码放入 render。`
    )
  }
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isIdentifier(node)) {
    const key = `${file.fileName}:${node.text}`
    if (!scope.has(node.text) || resolving.has(key))
      return fail(`无法静态读取 ${node.text}`)
    const value = scope.get(node.text)!
    if (typeof value === "object" && value !== null && "binding" in value) {
      const imported = staticImport(value as ImportedBinding)
      return extract(
        imported.expression,
        imported.scope,
        imported.file,
        new Set([...resolving, key])
      )
    }
    if (typeof value !== "object" || value === null || !("kind" in value))
      return value as StaticValue
    return extract(
      value as ts.Expression,
      scope,
      file,
      new Set([...resolving, key])
    )
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken
  ) {
    const value = extract(node.operand, scope, file, resolving)
    if (typeof value === "number") return -value
    return fail("负号只能用于数值")
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values: StaticValue[] = []
    for (const element of node.elements) {
      if (!ts.isSpreadElement(element))
        values.push(extract(element, scope, file, resolving))
      else {
        const value = extract(element.expression, scope, file, resolving)
        if (!Array.isArray(value)) return fail("数组展开只能引用静态数组")
        values.push(...value)
      }
    }
    return values
  }
  if (ts.isObjectLiteralExpression(node)) {
    const object: { [key: string]: StaticValue } = {}
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        const value = extract(property.expression, scope, file, resolving)
        if (!value || typeof value !== "object" || Array.isArray(value))
          return fail("对象展开只能引用静态对象")
        Object.assign(object, value)
        continue
      }
      if (
        !property.name ||
        (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteralLike(property.name))
      )
        return fail("不支持计算字段")
      const name = property.name.text
      if (name === "render") continue
      if (ts.isPropertyAssignment(property))
        object[name] = extract(property.initializer, scope, file, resolving)
      else if (ts.isShorthandPropertyAssignment(property))
        object[name] = extract(property.name, scope, file, resolving)
      else return fail(`字段 ${name} 必须使用静态值`)
    }
    return object
  }
  if (ts.isTemplateExpression(node)) {
    let result = node.head.text
    for (const span of node.templateSpans) {
      const value = extract(span.expression, scope, file, resolving)
      if (value !== null && typeof value === "object")
        return fail("模板字符串只能引用基本值")
      result += String(value) + span.literal.text
    }
    return result
  }
  if (ts.isConditionalExpression(node)) {
    return extract(
      extract(node.condition, scope, file, resolving)
        ? node.whenTrue
        : node.whenFalse,
      scope,
      file,
      resolving
    )
  }
  if (
    ts.isElementAccessExpression(node) ||
    ts.isPropertyAccessExpression(node)
  ) {
    const object = extract(node.expression, scope, file, resolving)
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : node.argumentExpression
        ? extract(node.argumentExpression, scope, file, resolving)
        : null
    if (
      !object ||
      typeof object !== "object" ||
      (typeof key !== "string" && typeof key !== "number") ||
      !Object.hasOwn(object, key)
    )
      return fail("无法静态读取对象字段")
    return (object as { [key: string]: StaticValue })[key]!
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Object" &&
    node.expression.name.text === "keys" &&
    node.arguments.length === 1
  ) {
    const object = extract(node.arguments[0]!, scope, file, resolving)
    if (!object || typeof object !== "object" || Array.isArray(object))
      return fail("Object.keys 只能读取静态对象")
    return Object.keys(object)
  }
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(node.operatorToken.kind)
  ) {
    const equals =
      extract(node.left, scope, file, resolving) ===
      extract(node.right, scope, file, resolving)
    return node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      ? equals
      : !equals
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "map"
  ) {
    const values = extract(node.expression.expression, scope, file, resolving)
    const callback = node.arguments[0]
    if (
      !Array.isArray(values) ||
      !callback ||
      !ts.isArrowFunction(callback) ||
      ts.isBlock(callback.body) ||
      callback.parameters.length !== 1 ||
      !ts.isIdentifier(callback.parameters[0]!.name)
    )
      return fail("仅支持静态数组的单参数表达式 map")
    const parameter = callback.parameters[0]!.name.text
    return values.map((value) =>
      extract(
        callback.body as ts.Expression,
        new Map([...scope, [parameter, value]]),
        file,
        resolving
      )
    )
  }
  return fail(`不支持静态表达式 ${ts.SyntaxKind[node.kind]}`)
}

function parse(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

function staticScope(file: ts.SourceFile, root: string): Scope {
  const scope: Scope = new Map()
  for (const statement of file.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.flags & ts.NodeFlags.Const
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          scope.set(declaration.name.text, declaration.initializer)
      }
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue
    const from = modulePath(file.fileName, statement.moduleSpecifier.text, root)
    if (!from) continue
    const imported = statement.importClause
    if (imported.name)
      scope.set(imported.name.text, { binding: "default", from, root })
    if (imported.namedBindings && ts.isNamedImports(imported.namedBindings)) {
      for (const binding of imported.namedBindings.elements) {
        if (!binding.isTypeOnly)
          scope.set(binding.name.text, {
            binding: binding.propertyName?.text ?? binding.name.text,
            from,
            root,
          })
      }
    }
  }
  return scope
}

/** Follow declarations of imported constants, without importing or running their source file. */
function staticImport(
  imported: ImportedBinding,
  visited = new Set<string>()
): { expression: ts.Expression; scope: Scope; file: ts.SourceFile } {
  const key = `${imported.from}:${imported.binding}`
  if (visited.has(key))
    throw new Error(`${imported.from}: 静态元数据导入循环：${imported.binding}`)
  const next = new Set(visited).add(key)
  const file = parse(imported.from)
  const scope = staticScope(file, imported.root)
  for (const statement of file.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      ) &&
      statement.declarationList.flags & ts.NodeFlags.Const
    ) {
      const declaration = statement.declarationList.declarations.find(
        (value) =>
          ts.isIdentifier(value.name) && value.name.text === imported.binding
      )
      if (declaration?.initializer)
        return { expression: declaration.initializer, scope, file }
    }
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      imported.binding === "default"
    )
      return { expression: statement.expression, scope, file }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue
    const target =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? modulePath(
            file.fileName,
            statement.moduleSpecifier.text,
            imported.root
          )
        : undefined
    if (!statement.exportClause && target) {
      try {
        return staticImport({ ...imported, from: target }, next)
      } catch {
        /* The next export may own this symbol. */
      }
    } else if (
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const exported = statement.exportClause.elements.find(
        (value) => !value.isTypeOnly && value.name.text === imported.binding
      )
      if (!exported) continue
      const name = exported.propertyName?.text ?? exported.name.text
      if (target)
        return staticImport({ ...imported, binding: name, from: target }, next)
      return { expression: exported.propertyName ?? exported.name, scope, file }
    }
  }
  throw new Error(`${imported.from}: 找不到静态导出常量 ${imported.binding}`)
}

function extractMetadata(file: string, root: string): CatalogMetadata {
  const source = parse(file)
  const scope = staticScope(source, root)
  let definition: ts.Expression | undefined
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals)
      definition = statement.expression
  }
  if (!definition) throw new Error(`${file}: 缺少 default 展示定义`)
  const value = extract(definition, scope, source)
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${file}: default 展示定义必须是静态对象`)
  const metadata = value as unknown as CatalogMetadata
  const invalid = (field: string): never => {
    throw new Error(`${file}: 展示字段 ${field} 无效`)
  }
  for (const field of [
    "id",
    "name",
    "layer",
    "group",
    "source",
    "description",
    "boundary",
  ] as const) {
    if (typeof metadata[field] !== "string" || !metadata[field].trim())
      invalid(field)
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(metadata.id))
    invalid("id（仅小写字母、数字和连字符）")
  if (!["基础组件", "复合组件", "页面"].includes(metadata.layer))
    invalid("layer")
  for (const field of [
    "inputs",
    "events",
    "composition",
    "consumers",
  ] as const) {
    if (
      !Array.isArray(metadata[field]) ||
      !metadata[field].every((value) => typeof value === "string")
    )
      invalid(field)
  }
  if (
    !metadata.viewport ||
    !Number.isFinite(metadata.viewport.width) ||
    !Number.isFinite(metadata.viewport.height) ||
    metadata.viewport.width <= 0 ||
    metadata.viewport.height <= 0
  )
    invalid("viewport")
  if (!Array.isArray(metadata.states) || !metadata.states.length)
    invalid("states")
  const states = new Set<string>()
  for (const state of metadata.states) {
    if (!state || typeof state !== "object" || Array.isArray(state))
      invalid("states（状态必须是对象）")
    for (const field of ["id", "name", "condition", "expected"] as const) {
      if (typeof state[field] !== "string" || !state[field].trim())
        invalid(`states.${field}`)
    }
    if (states.has(state.id)) invalid(`states.${state.id}（重复）`)
    states.add(state.id)
  }
  if (
    metadata.props !== undefined &&
    (!Array.isArray(metadata.props) ||
      !metadata.props.every((prop) =>
        ["name", "type", "default", "description"].every(
          (key) => typeof prop[key as keyof typeof prop] === "string"
        )
      ))
  )
    invalid("props")
  return metadata
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((item) => {
      const file = resolve(directory, item.name)
      // Symlinked directories are intentionally not traversed.
      return item.isDirectory()
        ? filesUnder(file)
        : item.isFile() && /\.tsx?$/.test(item.name)
          ? [file]
          : []
    })
    .sort()
}

function modulePath(
  from: string,
  specifier: string,
  root: string
): string | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return
  const base = specifier.startsWith("@/")
    ? resolve(root, "src", specifier.slice(2))
    : resolve(dirname(from), specifier)
  const path = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    resolve(base, "index.tsx"),
    resolve(base, "index.ts"),
  ].find((file) => existsSync(file) && /\.tsx?$/.test(file))
  return path
}

/** Resolve consumed static and lazy JSX sources, without loading runtime modules. */
function compositionSources(
  file: string,
  root: string,
  registered: Set<string>,
  sources: Map<string, ts.SourceFile>
): Set<string> {
  const sourceOf = (path: string) => {
    if (!sources.has(path)) sources.set(path, parse(path))
    return sources.get(path)!
  }
  const resolveSymbol = (
    path: string,
    symbol: string,
    visited = new Set<string>()
  ): string[] => {
    const key = `${path}:${symbol}`
    if (visited.has(key)) return []
    if (registered.has(path)) return [path]
    visited.add(key)
    const targets: string[] = []
    for (const statement of sourceOf(path).statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.isTypeOnly ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue
      const target = modulePath(path, statement.moduleSpecifier.text, root)
      if (!target) continue
      if (!statement.exportClause)
        targets.push(...resolveSymbol(target, symbol, visited))
      else if (ts.isNamedExports(statement.exportClause)) {
        for (const exported of statement.exportClause.elements) {
          if (!exported.isTypeOnly && exported.name.text === symbol)
            targets.push(
              ...resolveSymbol(
                target,
                exported.propertyName?.text ?? exported.name.text,
                visited
              )
            )
        }
      }
    }
    return targets
  }
  const jsx = new Map<string, Set<string>>()
  const jsxBindings: ts.Identifier[] = []
  const consumedLoaders: ts.Expression[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName
      if (ts.isIdentifier(tag)) jsxBindings.push(tag)
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          ts.isIdentifier(attribute.name) &&
          attribute.name.text === "load" &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression
        )
          consumedLoaders.push(attribute.initializer.expression)
      }
      const name = ts.isIdentifier(tag)
        ? tag.text
        : ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression)
          ? tag.expression.text
          : undefined
      if (name) {
        const values = jsx.get(name) ?? new Set<string>()
        values.add(
          ts.isIdentifier(tag)
            ? tag.text
            : ts.isPropertyAccessExpression(tag)
              ? tag.name.text
              : ""
        )
        jsx.set(name, values)
      }
    }
    ts.forEachChild(node, visit)
  }
  const source = sourceOf(file)
  visit(source)
  const result = new Set<string>()
  const reactLazy = new Set<string>()
  const reactNamespaces = new Set<string>()
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "react"
    )
      continue
    const bindings = statement.importClause
    if (bindings.name) reactNamespaces.add(bindings.name.text)
    if (bindings.namedBindings && ts.isNamespaceImport(bindings.namedBindings))
      reactNamespaces.add(bindings.namedBindings.name.text)
    else if (
      bindings.namedBindings &&
      ts.isNamedImports(bindings.namedBindings)
    )
      for (const binding of bindings.namedBindings.elements) {
        if (
          !binding.isTypeOnly &&
          (binding.propertyName?.text ?? binding.name.text) === "lazy"
        )
          reactLazy.add(binding.name.text)
      }
  }
  // Find the nearest lexical const instead of a file-wide name map, so a loader
  // declared inside a component cannot be confused with an unrelated local.
  const initializerOf = (name: ts.Identifier): ts.Expression | undefined => {
    for (
      let parent: ts.Node | undefined = name.parent;
      parent;
      parent = parent.parent
    ) {
      if (
        ts.isFunctionLike(parent) &&
        parent.parameters.some(
          (parameter) =>
            ts.isIdentifier(parameter.name) && parameter.name.text === name.text
        )
      )
        return
      if (!ts.isBlock(parent) && !ts.isSourceFile(parent)) continue
      for (const statement of parent.statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name.text
          )
            return statement.declarationList.flags & ts.NodeFlags.Const
              ? declaration.initializer
              : undefined
        }
      }
    }
  }
  const consumedSources = (
    expression: ts.Expression,
    seen = new Set<ts.Node>()
  ) => {
    expression = unwrap(expression)
    if (seen.has(expression)) return
    seen.add(expression)
    if (ts.isIdentifier(expression)) {
      const initializer = initializerOf(expression)
      if (initializer) consumedSources(initializer, seen)
    } else if (
      ts.isArrowFunction(expression) ||
      ts.isFunctionExpression(expression)
    ) {
      if (!ts.isBlock(expression.body)) consumedSources(expression.body, seen)
      else {
        const visitReturns = (node: ts.Node) => {
          // An unused nested callback is not part of the returned loader promise.
          if (ts.isFunctionLike(node)) return
          if (ts.isReturnStatement(node) && node.expression)
            consumedSources(node.expression, seen)
          else ts.forEachChild(node, visitReturns)
        }
        ts.forEachChild(expression.body, visitReturns)
      }
    } else if (ts.isCallExpression(expression)) {
      if (expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = expression.arguments[0]
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const target = modulePath(file, specifier.text, root)
          if (target)
            resolveSymbol(target, "default").forEach((path) => result.add(path))
        }
      } else {
        consumedSources(expression.expression, seen)
        expression.arguments.forEach((argument) =>
          consumedSources(argument, seen)
        )
      }
    } else if (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression) ||
      ts.isAwaitExpression(expression) ||
      ts.isSpreadElement(expression)
    )
      consumedSources(expression.expression, seen)
    else if (ts.isConditionalExpression(expression)) {
      consumedSources(expression.whenTrue, seen)
      consumedSources(expression.whenFalse, seen)
    } else if (ts.isArrayLiteralExpression(expression))
      expression.elements.forEach((element) => consumedSources(element, seen))
    else if (ts.isObjectLiteralExpression(expression))
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property))
          consumedSources(property.initializer, seen)
        else if (ts.isShorthandPropertyAssignment(property))
          consumedSources(property.name, seen)
        else if (ts.isSpreadAssignment(property))
          consumedSources(property.expression, seen)
      }
  }
  for (const loader of consumedLoaders) consumedSources(loader)
  const lazyComponent = (
    expression: ts.Expression,
    seen = new Set<ts.Node>()
  ) => {
    expression = unwrap(expression)
    if (seen.has(expression)) return
    seen.add(expression)
    if (ts.isIdentifier(expression)) {
      const initializer = initializerOf(expression)
      if (initializer) lazyComponent(initializer, seen)
    } else if (ts.isCallExpression(expression)) {
      const callee = expression.expression
      if (
        (ts.isIdentifier(callee) && reactLazy.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          reactNamespaces.has(callee.expression.text) &&
          callee.name.text === "lazy")
      )
        if (expression.arguments[0]) consumedSources(expression.arguments[0])
    }
  }
  for (const binding of jsxBindings) lazyComponent(binding)
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue
    const target = modulePath(file, statement.moduleSpecifier.text, root)
    if (!target) continue
    const bindings = statement.importClause
    if (bindings.name && jsx.has(bindings.name.text))
      resolveSymbol(target, "default").forEach((path) => result.add(path))
    if (
      bindings.namedBindings &&
      ts.isNamespaceImport(bindings.namedBindings)
    ) {
      for (const symbol of jsx.get(bindings.namedBindings.name.text) ?? [])
        resolveSymbol(target, symbol).forEach((path) => result.add(path))
    } else if (
      bindings.namedBindings &&
      ts.isNamedImports(bindings.namedBindings)
    ) {
      for (const imported of bindings.namedBindings.elements) {
        if (!imported.isTypeOnly && jsx.has(imported.name.text))
          resolveSymbol(
            target,
            imported.propertyName?.text ?? imported.name.text
          ).forEach((path) => result.add(path))
      }
    }
  }
  result.delete(file)
  return result
}

export function createCatalogManifest(root: string): CatalogManifest {
  root = resolve(root)
  const sourceRoots = sourceDirectories
    .map((directory) => resolve(root, directory))
    .filter(existsSync)
  const files = sourceRoots
    .flatMap(filesUnder)
    .filter((file) => file.endsWith(".catalog.tsx"))
  const manifest: CatalogManifest = {
    entries: [],
    definitions: {},
    dependencies: {},
  }
  const ids = new Set<string>()
  const sourceIds = new Map<string, string[]>()
  for (const file of files) {
    const metadata = extractMetadata(file, root)
    if (ids.has(metadata.id))
      throw new Error(`${file}: 组件标识重复：${metadata.id}`)
    ids.add(metadata.id)
    const source = resolve(root, metadata.source)
    if (
      !sourceRoots.some((directory) => source.startsWith(directory + sep)) ||
      !source.endsWith(".tsx") ||
      source.endsWith(".catalog.tsx") ||
      !existsSync(source)
    )
      throw new Error(
        `${file}: 正式源码不存在或超出组件目录：${metadata.source}`
      )
    metadata.source = relative(root, source).split(sep).join("/")
    const componentIds = sourceIds.get(source) ?? []
    componentIds.push(metadata.id)
    sourceIds.set(source, componentIds)
    manifest.entries.push(metadata)
    Object.defineProperty(manifest.definitions, metadata.id, {
      value: catalogImportPath(relative(root, file)),
      enumerable: true,
    })
  }
  const registered = new Set(sourceIds.keys())
  const sources = new Map<string, ts.SourceFile>()
  for (const entry of manifest.entries) {
    const dependencies = compositionSources(
      resolve(root, entry.source),
      root,
      registered,
      sources
    )
    manifest.dependencies[entry.id] = [...dependencies]
      .flatMap((source) => sourceIds.get(source) ?? [])
      .filter((id) => id !== entry.id)
  }
  return manifest
}

export function uiCatalogPlugin(): Plugin {
  let root = ""
  let manifest: CatalogManifest | undefined
  return {
    name: "moon-ui-catalog",
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      if (id === publicId) return resolvedId
      if (id === previewId) return resolvedPreviewId
    },
    load(id) {
      if (id !== resolvedId && id !== resolvedPreviewId) return
      manifest ??= createCatalogManifest(root)
      for (const directory of sourceDirectories) {
        const path = resolve(root, directory)
        if (existsSync(path))
          for (const file of filesUnder(path)) this.addWatchFile(file)
      }
      return `export default ${JSON.stringify(id === resolvedPreviewId ? manifest.definitions : { entries: manifest.entries, dependencies: manifest.dependencies })}`
    },
    configureServer(server) {
      const invalidate = (file: string) => {
        file = resolve(file)
        if (
          !sourceDirectories.some((directory) =>
            file.startsWith(resolve(root, directory) + sep)
          ) ||
          !/\.tsx?$/.test(file)
        )
          return
        manifest = undefined
        for (const id of [resolvedId, resolvedPreviewId]) {
          const module =
            server.environments.client.moduleGraph.getModuleById(id)
          if (module)
            server.environments.client.moduleGraph.invalidateModule(module)
        }
        // Only catalog documents use this index; editing application code must not reset the live app's drafts.
        server.ws.send({ type: "full-reload", path: "/ui-catalog/index.html" })
        server.ws.send({
          type: "full-reload",
          path: "/ui-catalog/preview.html",
        })
      }
      server.watcher.on("add", invalidate)
      server.watcher.on("unlink", invalidate)
      server.watcher.on("change", invalidate)
      server.httpServer?.once("close", () => {
        server.watcher.off("add", invalidate)
        server.watcher.off("unlink", invalidate)
        server.watcher.off("change", invalidate)
      })
    },
    watchChange() {
      manifest = undefined
    },
  }
}
