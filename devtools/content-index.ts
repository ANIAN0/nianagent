import { entries } from "../ui-catalog/catalog"
import { apiDocuments } from "virtual:moon-api-documents"
import { schemaRows } from "../api-catalog/components/schema-field-table"
import { pluginSpecSections } from "@/features/plugin-development/spec-content"
import type { DeveloperSearchItem } from "@/features/developer-tools/developer-header"
import type { ProjectIndex } from "../scripts/project-index.mjs"
import { codeModules, codeModuleFor } from "./project-modules"

export { codeModules, codeModuleFor }
export const componentHref = (id: string, state?: string) =>
  `/ui-catalog/?${new URLSearchParams({ component: id, ...(state ? { state } : {}) })}`
export const fileHref = (path: string) =>
  `/project/?${new URLSearchParams({ path })}`
export const codeModuleHref = (module: string) =>
  `/project/?${new URLSearchParams({ module })}`
export const apiHref = (operation: string) =>
  `/api-catalog/?${new URLSearchParams({ operation })}`

/** Source notes may include arrows and basenames within one module directory. */
export function sourcePaths(source: string) {
  const full = [
    ...source.matchAll(
      /(?:src|backend|src-tauri|scripts|devtools|ui-catalog|api-catalog)\/[\w./-]+\.(?:mjs|tsx?|rs|js|md)/g
    ),
  ].map((match) => match[0])
  const directory = full[0]?.slice(0, full[0].lastIndexOf("/"))
  const short = directory
    ? [...source.matchAll(/(?<![\w/-])([\w-]+\.(?:mjs|tsx?|rs|js|md))/g)].map(
        (match) => `${directory}/${match[1]}`
      )
    : []
  return [...new Set([...full, ...short])]
}

/** Relations belong to the relevant scene definition or explicit API consumer registration. */
export function operationsForComponent(id: string) {
  const entry = entries.find((item) => item.id === id)
  if (!entry) return []
  return Object.entries(apiDocuments).filter(([operation, doc]) =>
    entry.relatedOperations
      ? entry.relatedOperations.includes(operation)
      : doc.consumers.includes(entry.source)
  )
}
export function componentsForOperation(operation: string) {
  return entries.filter((entry) =>
    operationsForComponent(entry.id).some(([id]) => id === operation)
  )
}
export function componentsForFile(path: string) {
  return entries.filter(
    (entry) =>
      entry.source === path ||
      entry.composition.some((value) => value.includes(path))
  )
}
export function operationsForFile(path: string) {
  return Object.entries(apiDocuments).filter(
    ([, doc]) =>
      sourcePaths(doc.source).includes(path) || doc.consumers.includes(path)
  )
}
export async function loadProject(): Promise<ProjectIndex> {
  const response = await fetch("/__devtools/project", {
    signal: AbortSignal.timeout(15000),
  })
  const result = (await response.json()) as ProjectIndex & { error?: string }
  if (!response.ok) throw new Error(result.error ?? "文件索引读取失败")
  return result
}
export async function loadDeveloperSearch(
  publish?: (items: DeveloperSearchItem[]) => void
): Promise<DeveloperSearchItem[]> {
  const items: DeveloperSearchItem[] = [
    ...codeModules.map((module) => ({
      id: `module:${module.id}`,
      title: module.title,
      section: "项目结构",
      hierarchy: "按模块",
      text: `${module.task} ${module.description} ${module.boundary}`,
      href: codeModuleHref(module.id),
    })),
    ...entries.flatMap((entry) => [
      {
        id: `component:${entry.id}`,
        title: entry.name,
        section: "页面与组件",
        hierarchy: `${entry.layer} / ${entry.group}`,
        text: `${entry.description} ${entry.source} ${entry.boundary} ${entry.standards.map((rule) => `${rule.name} ${rule.rule}`).join(" ")}`,
        href: componentHref(entry.id),
      },
      ...entry.states.map((state) => ({
        id: `scene:${entry.id}:${state.id}`,
        title: state.name,
        section: "页面与组件",
        hierarchy: `${entry.name} / 场景`,
        text: `${state.condition} ${state.expected} ${state.steps.join(" ")}`,
        href: componentHref(entry.id, state.id),
      })),
    ]),
    ...Object.entries(apiDocuments).flatMap(([id, doc]) => [
      {
        id: `api:${id}`,
        title: doc.definition.title,
        section: "接口查询",
        hierarchy: doc.module,
        text: `${id} ${doc.definition.method} ${doc.definition.effect} ${doc.definition.condition} ${doc.definition.errors} ${doc.source}`,
        href: apiHref(id),
      },
      ...(["request", "response"] as const).flatMap((kind) =>
        schemaRows(doc.definition[kind], doc.schemas)
          .filter((field) => field.kind === "field")
          .map((field) => ({
            id: `field:${id}:${kind}:${field.id}`,
            title: field.path,
            section: "接口查询",
            hierarchy: `${doc.module} / ${doc.definition.title} / ${kind === "request" ? "请求" : "返回"}`,
            text: `${field.type} ${field.description} ${field.constraints.join(" ")}`,
            href: `${apiHref(id)}&field=${encodeURIComponent(field.path)}&fieldKind=${kind}`,
          }))
      ),
    ]),
    ...pluginSpecSections.map((section) => ({
      id: section.id,
      title: section.title,
      section: "插件开发",
      hierarchy: "正式规范",
      text: section.body,
      href: `/devtools/plugin-development.html?section=${encodeURIComponent(section.id)}`,
    })),
  ]
  publish?.(items)
  try {
    const project = await loadProject()
    return [
      ...items,
      ...project.files.map((file) => ({
        id: `file:${file.path}`,
        title: file.path,
        section: "项目结构",
        hierarchy: codeModuleFor(file.path).title,
        text: file.purpose || "职责未补充",
        href: fileHref(file.path),
      })),
    ]
  } catch {
    return [
      ...items,
      {
        id: "file-index-unavailable",
        title: "项目文件索引暂不可用",
        section: "项目结构",
        hierarchy: "文件索引",
        text: "页面、场景、接口与插件章节仍可搜索。请进入项目结构刷新文件索引。",
        href: "/project/",
      },
    ]
  }
}
