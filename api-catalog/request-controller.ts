import type {
  ModelOperation,
  WriteReceipt,
  ConversationQueueOperationReceipt,
  RpcRequests,
} from "@/contracts/rpc.generated"
import type { operations } from "../backend/contract.mjs"
import {
  feedbackFromError,
  isOperationIssue,
} from "../src/lib/operation-issue.ts"

export type ResponseState = {
  status: "idle" | "running" | "success" | "error" | "cancelled" | "unknown"
  text: string
  elapsedMs?: number
  startedAt?: string
  issue?: ReturnType<typeof feedbackFromError>
  receiptInput?: {
    operation: WriteReceipt["operation"]
    operationRequestId: string
  }
  authorizationInput?: { id: string }
  queueReceiptInput?: Readonly<RpcRequests["conversationQueueReceiptRead"]>
  /** A different interface was never invoked; only this SID shares its original queue boundary. */
  queueBlockedSessionId?: string
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
  const unresolved = new Map<
    ModelOperation,
    { operation: WriteReceipt["operation"]; operationRequestId: string }
  >()
  const unresolvedAuthorizations = new Map<ModelOperation, string>()
  const unresolvedQueues = new Map<
    ModelOperation,
    NonNullable<ResponseState["queueReceiptInput"]>
  >()
  const queueBlockers = new Map<
    ModelOperation,
    {
      operation: ModelOperation
      input: NonNullable<ResponseState["queueReceiptInput"]>
    }
  >()
  function supportsQueueReceipt(operation: ModelOperation) {
    return (
      (definitions?.[operation] as { queueReceipt?: boolean } | undefined)
        ?.queueReceipt === true
    )
  }
  function writesQueue(operation: ModelOperation) {
    return (
      supportsQueueReceipt(operation) || operation === "conversationQueueEdit"
    )
  }
  function supportsReceipt(operation: ModelOperation) {
    return (
      (definitions?.[operation] as { writeReceipt?: boolean } | undefined)
        ?.writeReceipt === true
    )
  }
  function supportsIdentity(operation: ModelOperation) {
    const schema = definitions?.[operation]?.request as
      { properties?: Record<string, unknown>; required?: string[] } | undefined
    return (
      !!schema?.properties &&
      "operationRequestId" in schema.properties &&
      !schema.required?.includes("operationRequestId")
    )
  }
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
        status:
          unresolved.has(old.operation) ||
          unresolvedQueues.has(old.operation) ||
          unresolvedAuthorizations.has(old.operation)
            ? "unknown"
            : "cancelled",
        receiptInput: unresolved.get(old.operation),
        queueReceiptInput: unresolvedQueues.get(old.operation),
        authorizationInput: unresolvedAuthorizations.has(old.operation)
          ? { id: unresolvedAuthorizations.get(old.operation)! }
          : undefined,
        text: unresolvedQueues.has(old.operation)
          ? "已取消等待；原队列操作是否采用尚未确认，请查询原会话和原请求编号的队列操作回执。"
          : unresolved.has(old.operation)
            ? "已取消等待；原写入是否提交尚未确认，请查询该原请求的写入回执。"
            : unresolvedAuthorizations.has(old.operation)
              ? "已取消等待；授权准备可能已经开始，请查询或取消原授权任务，不要启动另一授权。"
              : "已取消等待。已经开始的任务不保证回滚；请根据接口说明确认最终状态。",
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
      if (
        active?.operation === operation ||
        unresolved.has(operation) ||
        unresolvedQueues.has(operation) ||
        queueBlockers.has(operation) ||
        unresolvedAuthorizations.has(operation)
      )
        return
      update(operation, { response: { status: "idle", text: "" } })
    },
    cancel,
    async run(
      operation: ModelOperation,
      validate: (operation: ModelOperation, input: unknown) => unknown
    ) {
      if (
        active ||
        !snapshot[operation] ||
        unresolved.has(operation) ||
        unresolvedQueues.has(operation) ||
        unresolvedAuthorizations.has(operation)
      )
        return
      let input: unknown
      try {
        input = JSON.parse(snapshot[operation]!.input)
        if (
          supportsIdentity(operation) &&
          input &&
          typeof input === "object" &&
          !Array.isArray(input)
        ) {
          input = {
            ...input,
            operationRequestId:
              (input as { operationRequestId?: string }).operationRequestId ??
              crypto.randomUUID(),
          }
        }
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
      if (writesQueue(operation)) {
        const sessionId = (input as { sessionId: string }).sessionId
        const blocker = [...unresolvedQueues].find(
          ([, original]) => original.sessionId === sessionId
        )
        if (blocker) {
          const [originalOperation, original] = blocker
          queueBlockers.set(operation, {
            operation: originalOperation,
            input: original,
          })
          update(operation, {
            response: {
              status: "unknown",
              queueReceiptInput: original,
              queueBlockedSessionId: sessionId,
              text: "本接口尚未执行。同一会话的原队列操作结果待确认，请先查询下方原队列回执。",
            },
          })
          return
        }
      }
      queueBlockers.delete(operation)
      const request = {
        operation,
        controller: new AbortController(),
        start: now(),
      }
      active = request
      if (supportsQueueReceipt(operation)) {
        const original = input as RpcRequests["conversationQueueReceiptRead"]
        unresolvedQueues.set(
          operation,
          Object.freeze({
            sessionId: original.sessionId,
            operationRequestId: original.operationRequestId,
          })
        )
        update(operation, {
          input: JSON.stringify(input, null, 2),
          dirty: true,
        })
      }
      if (supportsReceipt(operation)) {
        unresolved.set(operation, {
          operation: operation as WriteReceipt["operation"],
          operationRequestId: (input as { operationRequestId: string })
            .operationRequestId,
        })
        update(operation, {
          input: JSON.stringify(input, null, 2),
          dirty: true,
        })
      }
      if (operation === "authStart" && supportsIdentity(operation)) {
        unresolvedAuthorizations.set(
          operation,
          (input as { operationRequestId: string }).operationRequestId
        )
        update(operation, {
          input: JSON.stringify(input, null, 2),
          dirty: true,
        })
      }
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
        unresolved.delete(operation)
        unresolvedQueues.delete(operation)
        unresolvedAuthorizations.delete(operation)
        if (
          operation === "conversationQueueReceiptRead" &&
          result &&
          typeof result === "object"
        ) {
          const receipt = result as ConversationQueueOperationReceipt
          const queried = input as RpcRequests["conversationQueueReceiptRead"]
          if (
            receipt.sessionId === queried.sessionId &&
            receipt.operationRequestId === queried.operationRequestId &&
            (receipt.state === "committed" || receipt.state === "rejected")
          ) {
            for (const [originalOperation, original] of unresolvedQueues) {
              if (
                original.sessionId !== receipt.sessionId ||
                original.operationRequestId !== receipt.operationRequestId ||
                receipt.operation !== originalOperation
              )
                continue
              unresolvedQueues.delete(originalOperation)
              for (const [blockedOperation, blocker] of queueBlockers) {
                if (
                  blocker.operation !== originalOperation ||
                  blocker.input.sessionId !== receipt.sessionId ||
                  blocker.input.operationRequestId !==
                    receipt.operationRequestId
                )
                  continue
                queueBlockers.delete(blockedOperation)
                update(blockedOperation, {
                  response: { status: "idle", text: "" },
                })
              }
              update(originalOperation, {
                response: {
                  status: receipt.state === "committed" ? "success" : "error",
                  text: JSON.stringify(
                    {
                      result:
                        "原队列操作的最终回执；未再次执行。采用交付操作不代表 Pi 已接受输入或回复完成。",
                      receipt,
                    },
                    null,
                    2
                  ),
                  issue: receipt.issue
                    ? feedbackFromError({ issue: receipt.issue })
                    : undefined,
                },
              })
            }
          }
        }
        if (
          operation === "writeReceiptRead" &&
          result &&
          typeof result === "object"
        ) {
          const receipt = result as WriteReceipt
          const original = unresolved.get(receipt.operation)
          if (
            original?.operationRequestId === receipt.operationRequestId &&
            (receipt.state === "committed" || receipt.state === "rejected")
          ) {
            unresolved.delete(receipt.operation)
            update(receipt.operation, {
              response: {
                status: receipt.state === "committed" ? "success" : "error",
                text: JSON.stringify(
                  { result: "原请求的最终回执；未再次执行", receipt },
                  null,
                  2
                ),
                issue: receipt.issue
                  ? feedbackFromError({ issue: receipt.issue })
                  : undefined,
              },
            })
          }
        }
        const originalAuthorization = unresolvedAuthorizations.get("authStart")
        const requestedJob = (input as { id?: string }).id
        if (
          originalAuthorization &&
          originalAuthorization === requestedJob &&
          (operation === "authCancel" || operation === "authPoll")
        ) {
          const job = result as { status?: string; issue?: unknown } | undefined
          const settled =
            operation === "authCancel" ||
            (job?.status &&
              job.status !== "pending" &&
              !(isOperationIssue(job.issue) && job.issue.recovery === "check"))
          if (settled) {
            unresolvedAuthorizations.delete("authStart")
            update("authStart", {
              response: {
                status:
                  operation === "authCancel"
                    ? "success"
                    : job?.status === "cancelled"
                      ? "cancelled"
                      : job?.status === "complete"
                        ? "success"
                        : "error",
                text: JSON.stringify(
                  {
                    result: "原授权任务已核对；未再次启动授权",
                    id: originalAuthorization,
                    ...(operation === "authPoll"
                      ? { job: result }
                      : {
                          endConfirmed: true,
                          note: "原任务已结束；具体授权结果可用authPoll读取。",
                        }),
                  },
                  null,
                  2
                ),
                issue: isOperationIssue(job?.issue)
                  ? feedbackFromError({ issue: job.issue })
                  : undefined,
              },
            })
          }
        }
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
        const feedback = feedbackFromError(error)
        const issue =
          error &&
          typeof error === "object" &&
          "issue" in error &&
          isOperationIssue(error.issue)
            ? error.issue
            : undefined
        if (
          feedback.code !== "result_unknown" &&
          feedback.code !== "cancelled" &&
          feedback.recovery !== "check"
        ) {
          unresolved.delete(operation)
          unresolvedAuthorizations.delete(operation)
        }
        // Only a formal host rejection is definitive about the original queue
        // operation. A generic exception, transport cancellation or read failure
        // cannot release its identity and permit a fresh mutation.
        const definiteQueueRejection =
          error &&
          typeof error === "object" &&
          "name" in error &&
          error.name === "RpcRequestRejected" &&
          feedback.code !== "result_unknown" &&
          feedback.recovery !== "check"
        if (definiteQueueRejection) unresolvedQueues.delete(operation)
        const queueReceiptInput = unresolvedQueues.get(operation)
        update(operation, {
          response: {
            receiptInput: unresolved.get(operation),
            queueReceiptInput,
            authorizationInput: unresolvedAuthorizations.has(operation)
              ? { id: unresolvedAuthorizations.get(operation)! }
              : undefined,
            issue: feedback,
            status:
              queueReceiptInput ||
              feedback.code === "result_unknown" ||
              feedback.recovery === "check"
                ? "unknown"
                : feedback.code === "cancelled"
                  ? "cancelled"
                  : "error",
            text: issue
              ? JSON.stringify({ error: issue.summary, issue }, null, 2)
              : feedback.message,
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
