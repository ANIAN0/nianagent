import { pluginSpecSections } from "@/features/plugin-development/spec-content"
import type { DeveloperSearchItem } from "@/features/developer-tools/developer-header"
import type { ProjectIndex } from "../scripts/project-index.mjs"
import { codeModules, codeModuleFor } from "./project-modules"

export { codeModules, codeModuleFor }
export const fileHref = (path: string) =>
  `/project/?${new URLSearchParams({ path })}`
export const codeModuleHref = (module: string) =>
  `/project/?${new URLSearchParams({ module })}`

/** Source notes may include arrows and basenames within one module directory. */
export function sourcePaths(source: string) {
  const full = [
    ...source.matchAll(
      /(?:src|backend|src-tauri|scripts|devtools)\/[\w./-]+\.(?:mjs|tsx?|rs|js|md)/g
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
