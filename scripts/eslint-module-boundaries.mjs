import ts from "typescript"
import { readFileSync } from "node:fs"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "..").replaceAll("\\", "/")

const BOUNDARY_PORTS = new Set([
  "atomic-file.mjs",
  "download-file.mjs",
  "loopback-host.mjs",
  "local-path.mjs",
  "request-context.mjs",
  "logger.mjs",
  "redact.mjs",
  "contract.mjs",
  "schema.mjs",
  "issue-contract.mjs",
  "operation-issue.mjs",
  "plugin-helpers.mjs",
  "activity-log.mjs",
  "storage-bootstrap.mjs",
  "close-resources.mjs",
])

const UI_PORTS = new Set([
  "src/features/plugins/plugin-api",
  "src/features/plugins/plugin-service",
  "src/lib/rpc/client",
  "src/lib/rpc/profile-storage",
  "src/lib/rpc/remote-ports",
  "src/lib/rpc/remote-transport",
  "src/components/read-only-patch",
  "src/components/markdown-editor",
])

// Explicit P1/P2 legacy cross-boundary edges. Adding new edges is forbidden;
// removing an edge during P1/P2 refactoring requires removing it here as well.
export const LEGACY_DIRECTIONAL_ALLOWLIST = new Set([
  // P1/P2: cross-feature module coupling
  "src/features/conversation/use-live-conversation -> src/features/models/model-types",

  // P3: backend cross-domain direct imports
  "backend/conversation-transcript -> backend/mcp",
  "backend/migration-worker -> backend/conversation-store",
  "backend/pi-session-adapter -> backend/mcp",
  "backend/pi-session-adapter -> backend/session-core",
  "backend/sessions -> backend/pi-session-adapter",
])

let cachedModules
export function loadProjectModules(repoRoot = REPO_ROOT) {
  if (cachedModules && repoRoot === REPO_ROOT) return cachedModules
  const file = path.resolve(repoRoot, "devtools/project-modules.ts")
  const source = readFileSync(file, "utf8")
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports = {}
  new Function("exports", transpiled)(exports)
  const loaded = {
    codeModules: exports.codeModules,
    codeModuleFor: exports.codeModuleFor,
  }
  if (repoRoot === REPO_ROOT) cachedModules = loaded
  return loaded
}

export function stripModuleExtension(relPath) {
  return relPath
    .replace(/\/index\.(?:tsx?|jsx?|mjs)$/, "")
    .replace(/\.(?:tsx?|jsx?|mjs)$/, "")
}

export function resolveImportTarget(fromFile, specifier, repoRoot = REPO_ROOT) {
  if (typeof specifier !== "string") return null
  const clean = specifier.split("?")[0]
  if (!clean.startsWith(".") && !clean.startsWith("@/")) return null
  const baseDir = clean.startsWith("@/")
    ? path.resolve(repoRoot, "src")
    : path.dirname(fromFile)
  const raw = clean.startsWith("@/") ? clean.slice(2) : clean
  const target = path.resolve(baseDir, raw).replaceAll("\\", "/")
  const rel = path.relative(repoRoot, target).replaceAll("\\", "/")
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel
}

const SETTINGS_SHELL_FILES = new Set(["src/features/settings/settings-page"])

const BACKEND_ASSEMBLY_EXEMPT = new Set([
  "backend/services",
  "backend/rpc",
  "backend/contract",
  "backend/schema",
  "backend/storage-validation",
  "backend/governance.test",
  "backend/diagnostic-query.test",
  "backend/workbench-pi.test",
  "backend/startup-maintenance.test",
])

export function checkDirectionalBoundary(
  fromRel,
  toRel,
  codeModuleFor,
  _specifier = ""
) {
  const fromKey = stripModuleExtension(fromRel)
  const toKey = stripModuleExtension(toRel)
  const edgeKey = `${fromKey} -> ${toKey}`

  if (fromRel.startsWith("src/")) {
    const fromMod = codeModuleFor(fromRel).id
    const toMod = codeModuleFor(toRel).id
    if (fromMod !== "app" && (toMod === "app" || toMod === "toolchain")) {
      return LEGACY_DIRECTIONAL_ALLOWLIST.has(edgeKey)
        ? null
        : { messageId: "reverseAppImport", edgeKey }
    }
  }

  if (fromRel.startsWith("src/") && toRel.startsWith("backend/plugins/")) {
    return LEGACY_DIRECTIONAL_ALLOWLIST.has(edgeKey)
      ? null
      : { messageId: "coreToPlugin", edgeKey }
  }

  if (fromRel.startsWith("src/lib/")) {
    if (
      toRel.startsWith("src/features/") ||
      toRel.startsWith("src/components/")
    ) {
      return LEGACY_DIRECTIONAL_ALLOWLIST.has(edgeKey)
        ? null
        : { messageId: "lowerToUpper", edgeKey }
    }
  }

  if (fromRel.startsWith("src/components/")) {
    const isBaseUi =
      fromRel.startsWith("src/components/ui/") ||
      fromRel.startsWith("src/components/feedback/")
    if (
      toRel.startsWith("src/features/") ||
      (isBaseUi && toRel.startsWith("src/components/composer/"))
    ) {
      return LEGACY_DIRECTIONAL_ALLOWLIST.has(edgeKey)
        ? null
        : { messageId: "lowerToUpper", edgeKey }
    }
  }

  if (
    fromRel.startsWith("src/features/") &&
    toRel.startsWith("src/features/")
  ) {
    const fromMod = codeModuleFor(fromRel).id
    const toMod = codeModuleFor(toRel).id
    if (fromMod !== toMod) {
      if (
        SETTINGS_SHELL_FILES.has(fromKey) &&
        ["models", "plugins", "session"].includes(toMod)
      )
        return null
      return LEGACY_DIRECTIONAL_ALLOWLIST.has(edgeKey)
        ? null
        : { messageId: "crossFeature", edgeKey, fromMod, toMod }
    }
  }

  if (
    fromRel.startsWith("backend/") &&
    !fromRel.startsWith("backend/plugins/") &&
    toRel.startsWith("backend/") &&
    !toRel.startsWith("backend/plugins/") &&
    !BACKEND_ASSEMBLY_EXEMPT.has(fromKey)
  ) {
    const fromMod = codeModuleFor(fromRel).id
    const toMod = codeModuleFor(toRel).id
    if (fromMod !== toMod && toMod !== "transport") {
      return LEGACY_DIRECTIONAL_ALLOWLIST.has(edgeKey)
        ? null
        : { messageId: "backendCrossDomain", edgeKey, fromMod, toMod }
    }
  }

  return null
}

function visitImports(context, checkSource) {
  return {
    ImportDeclaration: (node) => checkSource(node.source),
    ExportNamedDeclaration: (node) => node.source && checkSource(node.source),
    ExportAllDeclaration: (node) => checkSource(node.source),
    // AC16-二轮：动态 import() 的可解析字面量入口同样受边界约束
    ImportExpression: (node) =>
      node.source && node.source.type === "Literal" && checkSource(node.source),
  }
}

export const moonBoundary = {
  plugins: {
    "moon-boundary": {
      rules: {
        boundary: {
          meta: {
            type: "problem",
            schema: [],
            messages: {
              boundary:
                "插件只能使用平台公共端口与自身文件；业务领域内部与兄弟插件私有实现均不可导入（G02/G15/G17/AC16）。",
            },
          },
          create(context) {
            const filename = context.filename.replaceAll("\\", "/")
            const pluginMatch = filename.match(/\/backend\/plugins\/([^/]+)\//)
            if (!pluginMatch) return {}
            const ownPrefix = `backend/plugins/${pluginMatch[1]}/`
            const check = (sourceNode) => {
              const source = sourceNode.value
              if (typeof source !== "string") return
              if (!source.startsWith(".") && !source.startsWith("@/")) return
              const rel = resolveImportTarget(filename, source, REPO_ROOT)
              if (rel) {
                if (rel.startsWith(ownPrefix)) return
                const modulePath = stripModuleExtension(rel)
                if (
                  UI_PORTS.has(modulePath) ||
                  rel.startsWith("src/components/ui/") ||
                  rel.startsWith("src/contracts/")
                )
                  return
                if (rel.startsWith("backend/plugins/")) {
                  context.report({ node: sourceNode, messageId: "boundary" })
                  return
                }
                if (
                  rel.startsWith("backend/") &&
                  !rel.slice("backend/".length).includes("/") &&
                  BOUNDARY_PORTS.has(path.basename(rel))
                )
                  return
              }
              context.report({ node: sourceNode, messageId: "boundary" })
            }
            return visitImports(context, check)
          },
        },
        layering: {
          meta: {
            type: "problem",
            schema: [],
            messages: {
              coreToPlugin:
                "核心源码禁止直接导入插件内部实现（{{edgeKey}}）；请通过公共端口注入。",
              reverseAppImport:
                "业务、组件与基础模块禁止反向导入应用装配入口或工具链（{{edgeKey}}）；请通过 Props、Context 或端口注入。",
              lowerToUpper:
                "下层基础模块禁止反向依赖上层组件或业务 feature（{{edgeKey}}）。",
              crossFeature:
                "跨功能模块禁止直接耦合（{{fromMod}} -> {{toMod}}：{{edgeKey}}）；请下沉到 src/lib 或通过插槽/服务端口组合。",
              backendCrossDomain:
                "后端业务领域禁止直接跨模块导入（{{fromMod}} -> {{toMod}}：{{edgeKey}}）；请经由 services.mjs 注入端口。",
            },
          },
          create(context) {
            const filename = context.filename.replaceAll("\\", "/")
            const fromRel = path
              .relative(REPO_ROOT, filename)
              .replaceAll("\\", "/")
            if (fromRel.startsWith("..") || path.isAbsolute(fromRel)) return {}
            const { codeModuleFor } = loadProjectModules(REPO_ROOT)
            const check = (sourceNode) => {
              const toRel = resolveImportTarget(
                filename,
                sourceNode.value,
                REPO_ROOT
              )
              if (!toRel) return
              const violation = checkDirectionalBoundary(
                fromRel,
                toRel,
                codeModuleFor,
                sourceNode.value
              )
              if (violation) {
                context.report({
                  node: sourceNode,
                  messageId: violation.messageId,
                  data: violation,
                })
              }
            }
            return visitImports(context, check)
          },
        },
      },
    },
  },
}
