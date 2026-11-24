// @ts-check
// 笔记工作台薄监管插件（opencli 模式）：
// 仅负责独立 Next.js 工作台子进程的启停、健康探测与 HTTP 工具转发；
// 工作台本体（前端页面、API、SQLite 数据）运行在独立进程 apps/workbench 中。
import { randomUUID } from "node:crypto"
import { redactSensitive } from "../../redact.mjs"
import { notesWorkbenchOperations } from "./contract.mjs"
import { noteOperations, noteTools } from "./tool-catalog.mjs"

export async function activate(host) {
  const supervisor = host.workbench(notesWorkbenchOperations)

  const forwardV2 = async (opName, input, context, signal) => {
    if (!(await supervisor.isRunning())) {
      throw new Error("笔记工作台服务未运行，请在插件详情页启动或重启。")
    }
    const traceId = context?.traceId || randomUUID()
    const response = await fetch(`${supervisor.baseUrl()}/api/v2/${opName}`, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-moon-source": context?.source || "pi",
        "x-moon-trace": traceId,
        ...(context?.actorId
          ? { "x-moon-actor": String(context.actorId) }
          : {}),
      },
      body: JSON.stringify(input ?? {}),
      signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const summary = redactSensitive(
        body?.error || `工作台请求失败（HTTP ${response.status}）。`
      )
      if (!body?.code || !body.errorId) throw new Error(summary)
      const { code, errorId } = body
      const outcome = body.outcome === "unknown" ? "unknown" : "rejected"
      const issue = {
        module: "workbench",
        code,
        errorId,
        traceId,
        outcome,
        summary,
        recovery: outcome === "unknown" ? "check" : "reload",
        severity: code === "cancelled" ? "info" : "error",
      }
      try {
        await host.diagnostics?.append({
          module: issue.module,
          event: opName,
          level: issue.severity,
          traceId,
          operationId: context?.callId || randomUUID(),
          outcome,
          error: { code, errorId, cause: summary },
        })
      } catch {
        // 日志写入失败时仍返回工作台的原始错误标识。
      }
      throw Object.assign(new Error(summary), {
        name: "MoonOperationError",
        code,
        errorId,
        issue,
      })
    }
    return body
  }

  const v2ForwardedOperations = {}
  for (const [operationKey, definition] of Object.entries(noteOperations)) {
    if (definition.owner !== "workbench") continue
    const opName = operationKey.replace(/^v2_/, "")
    v2ForwardedOperations[operationKey] = {
      ...definition,
      execute: async (input, context, signal) => ({
        value: await forwardV2(opName, input, context, signal),
      }),
    }
  }

  const sharedTools = noteTools.map(({ operation, spec }) => {
    const definition = v2ForwardedOperations[operation]
    return {
      ...spec,
      execute: async (input, context, signal) => {
        try {
          const { value } = await definition.execute(input, context, signal)
          return { content: [{ type: "text", text: JSON.stringify(value) }] }
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: redactSensitive(
                  error?.code
                    ? `${error.code}：${error.message}`
                    : String(error?.message || error)
                ),
              },
            ],
          }
        }
      },
    }
  })

  return {
    sharedTools,
    operations: {
      ...v2ForwardedOperations,
      ...supervisor.baseOperations,
    },
    status: supervisor.statusText,
    quiesce: supervisor.quiesce,
    resume: supervisor.resume,
    close: supervisor.close,
  }
}
