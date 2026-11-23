// @ts-check
// Skill 工作台薄监管插件（opencli 模式）：
// 负责独立 Next.js 工作台子进程的启停、健康探测和 HTTP 工具转发。
// 工作台本体（前端页面、API、SQLite 数据）运行在独立进程 apps/workbench 中。
import { createWorkbenchSupervisor } from "../../loopback-host.mjs"
import { redactSensitive } from "../../redact.mjs"
import { skillWorkbenchOperations } from "./contract.mjs"
import { buildSharedTools } from "./tool-catalog.mjs"

export async function activate(host) {
  const supervisor = await createWorkbenchSupervisor({
    appKind: "skills",
    pluginId: "skill-workbench",
    label: "Skill 工作台",
    logSource: "skills",
    defaultPort: 19832,
    host,
    operationsSpec: skillWorkbenchOperations,
  })

  // 仅提取工具元数据与 schema；不打开 SQLite。
  const toolSpecs = buildSharedTools({})
  const sharedTools = toolSpecs.map((spec) => ({
    name: spec.name,
    shareable: spec.shareable,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    execute: async (input, context, signal) => {
      if (!supervisor.running) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Skill 工作台服务未运行，请在插件详情页启动或重启。",
            },
          ],
        }
      }
      try {
        const response = await fetch(
          `${supervisor.baseUrl()}/api/skills/tools/${encodeURIComponent(spec.name)}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${supervisor.identity.token}`,
              ...(context?.source
                ? { "x-moon-source": String(context.source) }
                : {}),
              ...(context?.actorId
                ? { "x-moon-actor": String(context.actorId) }
                : {}),
            },
            body: JSON.stringify(input ?? {}),
            signal,
          }
        )
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(
            body?.error || `Skill 工具调用失败（HTTP ${response.status}）。`
          )
        }
        return body
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: redactSensitive(
                error instanceof Error ? error.message : String(error)
              ),
            },
          ],
        }
      }
    },
  }))

  return {
    sharedTools,
    operations: supervisor.baseOperations,
    status: supervisor.statusText,
    quiesce: supervisor.quiesce,
    resume: supervisor.resume,
    close: supervisor.close,
  }
}
