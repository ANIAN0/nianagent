// ② 共享工具网关（G16 自 plugin-host 拆分）：声明校验、目录、受信调用与变更通知。
// 依赖显式注入：{ entries, logs, lease }；不访问 PluginHost 其他私有状态。
// 身份由可信适配（mcp-service 认证）传入，只进日志与执行上下文；工具入参不能提供。
import { currentTraceId } from "./request-context.mjs"
import { randomUUID } from "node:crypto"
import { base64Image, check, jsonValue } from "./plugin-primitives.mjs"
import { safeSummary, valueSummary } from "./activity-log.mjs"
import { publicFailure } from "./operation-issue.mjs"

export function validateSharedTools(tools) {
  check(Array.isArray(tools) && tools.length <= 128, "共享工具声明无效。")
  const seen = new Set()
  for (const tool of tools) {
    check(
      /^[a-z][a-z0-9_]{0,47}$/.test(tool.name) &&
        !seen.has(tool.name) &&
        typeof tool.description === "string" &&
        tool.description.length <= 8000 &&
        typeof tool.execute === "function" &&
        tool.inputSchema?.type === "object" &&
        tool.inputSchema.additionalProperties === false,
      "共享工具须使用唯一名称、说明、严格参数schema和执行方法。"
    )
    seen.add(tool.name)
    check(
      tool.annotations === undefined ||
        (tool.annotations &&
          typeof tool.annotations === "object" &&
          !Array.isArray(tool.annotations) &&
          Object.entries(tool.annotations).every(
            ([key, value]) =>
              [
                "readOnlyHint",
                "destructiveHint",
                "idempotentHint",
                "openWorldHint",
              ].includes(key) && typeof value === "boolean"
          )),
      "共享工具annotations只允许声明的布尔影响提示。"
    )
  }
}

/** 共享工具网关：目录与调用全部经本对象；变更通知由 subscribe 注册。 */
export function createSharedToolGateway({ entries, logs, lease }) {
  const sharedListeners = new Set()

  const changed = () => {
    for (const listener of sharedListeners) {
      try {
        listener()
      } catch {
        /* Notifications cannot change lifecycle results. */
      }
    }
  }

  const catalog = () => {
    return [...entries.values()]
      .filter((entry) => entry.enabled && entry.state === "active")
      .flatMap((entry) =>
        (entry.application?.sharedTools || [])
          .filter((tool) => tool.shareable === true)
          .map((tool) => ({
            name: `${entry.id}__${tool.name}`,
            plugin: entry.id,
            generation: entry.generation,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations || {},
          }))
      )
  }

  const call = (name, ...args) => {
    const descriptor = catalog().find((tool) => tool.name === name)
    const entry = descriptor && entries.get(descriptor.plugin)
    const pending = executeSharedTool(name, ...args)
    if (entry) {
      entry.sharedPending.add(pending)
      void pending.then(
        () => entry.sharedPending.delete(pending),
        () => entry.sharedPending.delete(pending)
      )
    }
    return pending
  }

  async function executeSharedTool(
    name,
    input,
    {
      allowed,
      generation,
      client = "未提供",
      actorId = "",
      credentialId = "",
      signal,
    } = {}
  ) {
    const callId = randomUUID(),
      started = Date.now()
    const identity =
      typeof actorId === "string" &&
      actorId &&
      typeof credentialId === "string" &&
      credentialId
        ? { actorId, credentialId }
        : null
    if (!identity)
      throw new Error("共享工具缺少可信身份上下文（identity_denied）。")
    const descriptor = catalog().find((tool) => tool.name === name)
    const entry = descriptor && entries.get(descriptor.plugin)
    const definition = entry?.application?.sharedTools?.find(
      (tool) => `${entry.id}__${tool.name}` === name
    )
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    entry?.sharedCalls.add(controller)
    const metadata = {
      callId,
      source: "tool",
      plugin: descriptor?.plugin || "",
      tool: descriptor?.name || "未注册工具",
      client,
      actorId: identity.actorId,
      credentialId: identity.credentialId,
    }
    let admitted = false
    let inputSummary = ""
    try {
      check(
        descriptor && definition?.shareable === true,
        "共享工具已停用或未声明。"
      )
      check(allowed?.(name) === true, "共享工具未获用户授权。")
      check(
        generation === undefined || generation === descriptor.generation,
        "共享工具代次已变化，请刷新目录。"
      )
      controller.signal.throwIfAborted()
      const { validatePluginValue } = await import("./plugin-helpers.mjs")
      controller.signal.throwIfAborted()
      validatePluginValue(definition.inputSchema, input)
      inputSummary = safeSummary(definition, { phase: "input", input }, input)
      await logs.append({
        ...metadata,
        status: "started",
        input: inputSummary,
      })
      admitted = true
      const result = await lease(entry, async () => {
        check(
          entry.generation === descriptor.generation && allowed(name),
          "共享工具授权或代次已变化。"
        )
        controller.signal.throwIfAborted()
        return definition.execute(
          input,
          {
            callId,
            source: "mcp",
            traceId: currentTraceId() || randomUUID(),
            actorId: identity.actorId,
            credentialId: identity.credentialId,
          },
          controller.signal
        )
      })
      controller.signal.throwIfAborted()
      check(
        entry.state === "active" &&
          entry.generation === descriptor.generation &&
          allowed(name),
        "共享工具已停止或授权已变化；请核对操作实际结果。"
      )
      check(
        Buffer.byteLength(JSON.stringify(result)) <= 16 * 1024 * 1024 &&
          result &&
          typeof result === "object" &&
          !Array.isArray(result) &&
          (result.isError === undefined ||
            typeof result.isError === "boolean") &&
          (result.structuredContent === undefined ||
            (result.structuredContent !== null &&
              typeof result.structuredContent === "object" &&
              !Array.isArray(result.structuredContent) &&
              jsonValue(result.structuredContent))) &&
          Array.isArray(result.content) &&
          result.content.every(
            (block) =>
              block &&
              typeof block === "object" &&
              (block.type === "text"
                ? typeof block.text === "string"
                : block.type === "image" &&
                  base64Image(block.data) &&
                  typeof block.mimeType === "string" &&
                  /^image\/[a-z0-9.+-]+$/i.test(block.mimeType))
          ),
        "共享工具结果格式或大小无效。"
      )
      await logs.append({
        ...metadata,
        status: result.isError ? "failed" : "succeeded",
        durationMs: Date.now() - started,
        input: inputSummary,
        result: safeSummary(
          definition,
          { phase: "result", input, result },
          result
        ),
        error: result.isError ? "工具返回失败；详细内容仅交给调用方。" : "",
      })
      return result
    } catch (error) {
      await logs.append({
        ...metadata,
        status: controller.signal.aborted
          ? "cancelled"
          : admitted
            ? "failed"
            : "rejected",
        durationMs: Date.now() - started,
        input: inputSummary || valueSummary(input),
        error: controller.signal.aborted
          ? "调用已取消；已等待执行收尾。"
          : admitted
            ? "工具执行失败；日志不保存原始错误内容。"
            : "工具未启用、未授权、代次失效或参数无效。",
      })
      // The authorized caller gets sanitized diagnostics: raw plugin errors may
      // carry absolute paths; the separate persisted log keeps the category only.
      throw new Error(
        controller.signal.aborted
          ? "共享工具调用已取消。"
          : admitted
            ? String(
                publicFailure(error).error ||
                  "共享工具执行失败，请核对实际结果。"
              ).slice(0, 2000)
            : "共享工具不可调用：请刷新目录并核对授权、代次和参数。",
        { cause: error }
      )
    } finally {
      signal?.removeEventListener("abort", abort)
      entry?.sharedCalls.delete(controller)
    }
  }

  return {
    validateSharedTools,
    changed,
    catalog,
    call,
    executeSharedTool,
    subscribe: (listener) => {
      sharedListeners.add(listener)
      return () => sharedListeners.delete(listener)
    },
  }
}
