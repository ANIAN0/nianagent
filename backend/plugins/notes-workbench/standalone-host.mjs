// @ts-check
// 笔记工作台薄监管插件（opencli 模式）：
// 仅负责独立 Next.js 工作台子进程的启停、健康探测与 HTTP 工具转发；
// 工作台本体（前端页面、API、SQLite 数据）运行在独立进程 apps/workbench 中。
import { redactSensitive } from "../../redact.mjs"
import { createWorkbenchSupervisor } from "../../loopback-host.mjs"
import { notesWorkbenchOperations } from "./contract.mjs"
import { createV2Service } from "./v2/service.mjs"
import { readOnlyTools, toolOperations } from "./v2/tool-catalog.mjs"

export async function activate(host) {
  const supervisor = await createWorkbenchSupervisor({
    appKind: "notes",
    pluginId: "notes-workbench",
    label: "笔记工作台",
    logSource: "notes",
    defaultPort: 19830,
    host,
    operationsSpec: notesWorkbenchOperations,
  })

  // 复用领域层的 RPC 契约，不在监管进程中打开 SQLite。
  const schemaSource = createV2Service(null, {
    event: () => {},
    baseUrl: `${supervisor.baseUrl()}/`,
    logger: { append: () => {} },
    changed: () => {},
  })

  const forwardV2 = async (opName, input, context, signal) => {
    if (!supervisor.running) {
      throw new Error("笔记工作台服务未运行，请在插件详情页启动或重启。")
    }
    const response = await fetch(`${supervisor.baseUrl()}/api/v2/${opName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${supervisor.identity.token}`,
        ...(context?.source ? { "x-moon-source": String(context.source) } : {}),
        ...(context?.actorId
          ? { "x-moon-actor": String(context.actorId) }
          : {}),
      },
      body: JSON.stringify(input ?? {}),
      signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const err = new Error(
        body?.error || `工作台请求失败（HTTP ${response.status}）。`
      )
      // @ts-ignore
      err.code = body?.code
      // @ts-ignore
      err.errorId = body?.errorId
      throw err
    }
    return body
  }

  const v2ForwardedOperations = {}
  for (const [operationKey, definition] of Object.entries(
    schemaSource.operations
  )) {
    if (definition.owner !== "workbench") continue
    const opName = operationKey.replace(/^v2_/, "")
    v2ForwardedOperations[operationKey] = {
      ...definition,
      execute: async (input, context, signal) => ({
        value: await forwardV2(opName, input, context, signal),
      }),
    }
  }

  const sharedTools = toolOperations.map((pair) => {
    const [operationKey, name] = pair.split(":")
    const definition = v2ForwardedOperations[operationKey]
    return {
      name,
      shareable: true,
      description: definition.title,
      inputSchema: definition.input,
      annotations: readOnlyTools.has(name) ? { readOnlyHint: true } : undefined,
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
                  error instanceof Error ? error.message : String(error)
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
