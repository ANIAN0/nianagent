import type { ModelOperation } from "../src/features/models/model-contract.generated"
import type { operations } from "../backend/contract.mjs"

export type ResponseState = {
  status: "idle" | "running" | "success" | "error" | "cancelled"
  text: string
  elapsedMs?: number
  startedAt?: string
}
export type RequestDraft = {
  input: string
  dirty: boolean
  response: ResponseState
}
type Definitions = Partial<typeof operations>
type Snapshot = Partial<Record<ModelOperation, RequestDraft>>
type Invocation = (
  operation: ModelOperation,
  input: unknown,
  signal: AbortSignal
) => Promise<unknown>

function displayResult(operation: ModelOperation, result: unknown): unknown {
  if (operation === "revealKey")
    return { apiKey: "[敏感值已返回，目录不展示原文]" }
  if (!["mcpList", "mcpSave"].includes(operation)) return result
  const redact = (value: unknown) => {
    if (!value || typeof value !== "object" || !("configuration" in value))
      return value
    const configuration = (value as { configuration: Record<string, unknown> })
      .configuration
    const fields = (entries: unknown) =>
      Array.isArray(entries)
        ? entries.map((entry) => ({
            ...entry,
            value: "[值已隐藏]",
          }))
        : entries
    return {
      ...value,
      configuration: {
        ...configuration,
        env: fields(configuration.env),
        headers: fields(configuration.headers),
      },
    }
  }
  return Array.isArray(result) ? result.map(redact) : redact(result)
}

/** Page-owned, in-memory drafts and a single explicit call lifecycle. No storage or autorun. */
export function createRequestController(invoke: Invocation, now = Date.now) {
  let snapshot: Snapshot = {}
  let definitions: Definitions | undefined
  let active:
    | { operation: ModelOperation; controller: AbortController; start: number }
    | undefined
  const listeners = new Set<() => void>()
  function update(operation: ModelOperation, patch: Partial<RequestDraft>) {
    const previous = snapshot[operation]
    if (!previous) return
    snapshot = { ...snapshot, [operation]: { ...previous, ...patch } }
    for (const listener of listeners) listener()
  }
  function cancel() {
    if (!active) return
    const old = active
    active = undefined
    old.controller.abort()
    update(old.operation, {
      response: {
        status: "cancelled",
        text: "已取消等待。已经提交的修改或已开始的任务不会因此回滚；请通过读取接口确认最终结果。",
        elapsedMs: Math.max(0, now() - old.start),
        startedAt: new Date(old.start).toISOString(),
      },
    })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    initialize(next: Definitions) {
      definitions = { ...definitions, ...next }
      for (const operation of Object.keys(next) as ModelOperation[]) {
        if (!snapshot[operation]) {
          snapshot[operation] = {
            input: JSON.stringify(next[operation]!.example, null, 2),
            dirty: false,
            response: { status: "idle", text: "" },
          }
        }
      }
      snapshot = { ...snapshot }
      for (const listener of listeners) listener()
    },
    setInput(operation: ModelOperation, input: string) {
      if (active?.operation === operation || !definitions) return
      update(operation, {
        input,
        dirty:
          input !== JSON.stringify(definitions[operation]!.example, null, 2),
      })
    },
    restore(operation: ModelOperation) {
      if (active?.operation === operation || !definitions) return
      update(operation, {
        input: JSON.stringify(definitions[operation]!.example, null, 2),
        dirty: false,
      })
    },
    clearResponse(operation: ModelOperation) {
      if (active?.operation === operation) return
      update(operation, { response: { status: "idle", text: "" } })
    },
    cancel,
    async run(
      operation: ModelOperation,
      validate: (operation: ModelOperation, input: unknown) => unknown
    ) {
      if (active || !snapshot[operation]) return
      let input: unknown
      try {
        input = JSON.parse(snapshot[operation]!.input)
        validate(operation, input)
      } catch (error) {
        update(operation, {
          response: {
            status: "error",
            text: error instanceof Error ? error.message : "参数无效。",
          },
        })
        return
      }
      const request = {
        operation,
        controller: new AbortController(),
        start: now(),
      }
      active = request
      update(operation, {
        response: {
          status: "running",
          text: "",
          startedAt: new Date(request.start).toISOString(),
        },
      })
      try {
        const result = await invoke(operation, input, request.controller.signal)
        if (active !== request || request.controller.signal.aborted) return
        update(operation, {
          response: {
            status: "success",
            text: JSON.stringify(displayResult(operation, result), null, 2),
            elapsedMs: Math.max(0, now() - request.start),
            startedAt: new Date(request.start).toISOString(),
          },
        })
      } catch (error) {
        if (active !== request || request.controller.signal.aborted) return
        update(operation, {
          response: {
            status: "error",
            text: error instanceof Error ? error.message : String(error),
            elapsedMs: Math.max(0, now() - request.start),
            startedAt: new Date(request.start).toISOString(),
          },
        })
      } finally {
        if (active === request) active = undefined
      }
    },
    dispose() {
      cancel()
      listeners.clear()
    },
  }
}
