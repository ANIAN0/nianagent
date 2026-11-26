// @ts-check
// Skill 工作台薄监管插件（opencli 模式）：
// 负责独立 Next.js 工作台子进程的启停、健康探测和 HTTP 工具转发。
// 工作台本体（前端页面、API、SQLite 数据）运行在独立进程 apps/workbench 中。
import { redactSensitive } from "../../redact.mjs"
import { skillWorkbenchOperations } from "./contract.mjs"
import { createProjectSkills } from "./project-skills.mjs"
import { skillTools } from "./tool-catalog.mjs"

export async function activate(host) {
  const supervisor = host.workbench(skillWorkbenchOperations)

  const projects = createProjectSkills(host, supervisor)
  const projectOperation = (name, fn) => ({
    ...skillWorkbenchOperations[name],
    execute: async (input, _context, signal) => ({
      value: await fn(input, signal),
    }),
  })

  const sharedTools = skillTools.map((spec) => ({
    ...spec,
    execute: async (input, context, signal) => {
      if (!(await supervisor.isRunning())) {
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
            redirect: "error",
            headers: {
              "content-type": "application/json",
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
    operations: {
      ...supervisor.baseOperations,
      sharedSources: projectOperation("sharedSources", () =>
        projects.sharedSources()
      ),
      listProjectSkills: projectOperation(
        "listProjectSkills",
        (_input, signal) => projects.list(signal)
      ),
      previewInstall: projectOperation("previewInstall", projects.prepare),
      applyInstall: projectOperation("applyInstall", ({ previewId }, signal) =>
        projects.apply(previewId, signal)
      ),
      installResult: projectOperation("installResult", ({ previewId }) =>
        projects.result(previewId)
      ),
    },
    status: supervisor.statusText,
    quiesce: supervisor.quiesce,
    resume: supervisor.resume,
    close: supervisor.close,
  }
}
