// @ts-check
// 目录种子迁移：ui-catalog 清单（AST 静态提取）→ notes-workbench seed.json。
// 生成的是文档优先的种子页面：保留描述、边界、story、设计标准、状态文档与关联接口；
// 已进预览清单的条目指向预览 bundle，其余附最小占位源码。运行：node scripts/migrate-catalog-notes.mts
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createCatalogManifest } from "./ui-catalog-plugin.ts"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const manifest = createCatalogManifest(root)

/** 与 ui-catalog/catalog-navigation 的固定分组同序。 */
const groupOrder = [
  "会话",
  "首页",
  "设置与启动",
  "插件",
  "文件工作栏",
  "操作与选择",
  "输入与表单",
  "浮层与导航",
  "内容与反馈",
  "数据展示",
]

/** 与 preview/manifest.mjs 对应：条目 id → 预览 bundle 条目。 */
const previewByEntry = {
  "notification-toast": "notification-toast",
  "home-page": "home-story",
}

/** 状态 id → 预览组件 args（fixture 场景参数）。 */
const stateArgsByEntry = {
  "home-page": {
    "home-ready": { scenario: "normal" },
    "home-missing-workspace": { scenario: "workspace-empty" },
  },
  "notification-toast": {
    info: { tone: "info" },
    warning: { tone: "warning" },
    error: { tone: "error" },
  },
}

const placeholder = (title, description) =>
  [
    "function Page() {",
    "  return (",
    '    <div className="min-h-screen bg-white p-8 text-neutral-800">',
    `      <h1 className="text-lg font-semibold">${title}</h1>`,
    `      <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">${description}</p>`,
    "    </div>",
    "  )",
    "}",
  ].join("\n")

const directories = []
const directoryIds = new Map()
const pages = []
for (const entry of [...manifest.entries].sort((a, b) => a.order - b.order)) {
  const group = entry.group || "未分组"
  if (!directoryIds.has(group)) {
    directoryIds.set(group, `seed-${directories.length + 1}`)
    directories.push({
      id: directoryIds.get(group),
      name: group,
      order: groupOrder.indexOf(group) === -1 ? groupOrder.length : groupOrder.indexOf(group),
    })
  }
  const description = entry.source
    ? `${entry.description}\n\n正式源码：${entry.source}`
    : entry.description
  pages.push({
    directoryId: directoryIds.get(group),
    name: entry.id,
    title: entry.name,
    code: previewByEntry[entry.id] ? "" : placeholder(entry.name, entry.description || ""),
    meta: {
      description,
      boundary: entry.boundary || "",
      preview: previewByEntry[entry.id] ?? "",
      story: entry.story
        ? {
            goal: entry.story.goal || "",
            preconditions: entry.story.preconditions ?? [],
            result: entry.story.result || "",
          }
        : undefined,
      standards: entry.standards ?? [],
      tags: [entry.layer].filter(Boolean),
      viewport: entry.viewport ?? undefined,
      argTypes: [],
      relatedOperations: entry.relatedOperations ?? [],
    },
    states: (entry.states ?? []).map((state) => ({
      id: state.id,
      name: state.name,
      section: state.section,
      args: stateArgsByEntry[entry.id]?.[state.id] ?? {},
      condition: state.condition || "",
      expected: state.expected || "",
      steps: state.steps ?? [],
      knownIssue: state.knownIssue || "",
    })),
  })
}

directories.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
const seed = {
  generatedFrom: "ui-catalog manifest（设计规范与场景文档迁移）",
  directories: directories.map(({ id, name }) => ({ id, name })),
  pages,
}
const target = resolve(root, "backend/plugins/notes-workbench/seed.json")
writeFileSync(target, JSON.stringify(seed, null, 2) + "\n")
console.log(
  `seed: ${directories.length} 个目录，${pages.length} 个页面 → ${target}`
)
