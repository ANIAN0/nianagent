import { operations } from "../backend/contract.mjs"
import {
  serviceRegistry,
  serviceRoot,
  operationDependencies,
} from "../backend/service-registry.mjs"

/** 只投影运行时注册信息与正式契约，构建不依赖本地开发文档。 */
export function architectureText() {
  const modules = new Map<string, string[]>()
  for (const [id, operation] of Object.entries(operations)) {
    const module =
      ("module" in operation ? operation.module : undefined) ?? "模型配置"
    const rows = modules.get(module) ?? []
    const root = serviceRoot(operation.method) as keyof typeof serviceRegistry
    const service = serviceRegistry[root]
    rows.push(
      `- ${id} → ${operation.method}\n  源码：${service.source}\n  数据归属：${service.storage}\n  就绪依赖：${operationDependencies(operation.method).join("、") || "无共享初始化依赖"}`
    )
    modules.set(module, rows)
  }
  return [...modules]
    .map(([module, rows]) => `## ${module}\n\n${rows.join("\n\n")}`)
    .join("\n\n")
}
