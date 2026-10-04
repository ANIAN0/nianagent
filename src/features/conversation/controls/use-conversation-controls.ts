import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { RpcRequestRejected } from "@/features/models/model-service"
import { feedbackFromError } from "@/lib/operation-issue"
import {
  createConversationControlService,
  type ConversationControlService,
} from "./conversation-control-service"
import type {
  ConversationControlOperation,
  ConversationSnapshot,
} from "@/features/models/model-contract.generated"
import {
  controlFailure,
  controlIsTerminal as terminal,
  controlStorageKey as key,
  restoreControlOperation as restore,
  resolveControlIssue,
  type ConversationControlAction,
  type ConversationControlIssue,
} from "./conversation-control-state"
export type {
  ConversationControlAction,
  ConversationControlIssue,
} from "./conversation-control-state"

export function useConversationControls(
  id: string,
  snapshot?: ConversationSnapshot,
  providedService?: ConversationControlService
) {
  const [service] = useState(
    () => providedService ?? createConversationControlService()
  )
  const [cached, setCached] = useState(() => ({
    sessionId: id,
    operation: restore(id),
  }))
  const [issue, setIssue] = useState<ConversationControlIssue>()
  const [request, setRequest] = useState<{
    sessionId: string
    operationId: string
    action: ConversationControlAction
  }>()
  const currentSession = useRef(id)
  const mounted = useRef(true)
  const locked = useRef(false)
  const cachedOperation = cached.sessionId === id ? cached.operation : undefined
  const received =
    snapshot?.control?.operation?.sessionId === id
      ? snapshot.control.operation
      : undefined
  const operation =
    received &&
    (!cachedOperation ||
      received.createdAt > cachedOperation.createdAt ||
      (received.id === cachedOperation.id &&
        received.updatedAt >= cachedOperation.updatedAt))
      ? received
      : cachedOperation
  const latest = useRef(operation)
  const pending = request?.sessionId === id
  const pendingAction = pending ? request.action : undefined
  const pendingOperationId = pending ? request.operationId : undefined

  if (cached.sessionId !== id) {
    setCached({ sessionId: id, operation: restore(id) })
    setIssue(undefined)
    setRequest(undefined)
  }
  useLayoutEffect(() => {
    if (currentSession.current !== id) locked.current = false
    currentSession.current = id
    latest.current = operation
  }, [id, operation])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const accept = useCallback(
    (value: ConversationControlOperation) => {
      if (
        !mounted.current ||
        currentSession.current !== id ||
        value.sessionId !== id
      )
        return
      setCached({ sessionId: id, operation: value })
      latest.current = value
      try {
        localStorage.setItem(key(id), JSON.stringify(value))
      } catch {
        /* The receipt remains available in memory. */
      }
      return value
    },
    [id]
  )
  const acceptCurrent = useCallback(
    (requestId: string, value: ConversationControlOperation) => {
      const current = latest.current
      if (
        !mounted.current ||
        currentSession.current !== id ||
        !current ||
        current.id !== requestId ||
        value.id !== requestId ||
        value.sessionId !== id
      )
        return
      // A late poll cannot undo a newer receipt or a confirmed terminal result.
      if (
        value.updatedAt < current.updatedAt ||
        (terminal(current) && !terminal(value))
      )
        return current
      return accept(value)
    },
    [accept, id]
  )
  useEffect(() => {
    if (!operation) return
    try {
      localStorage.setItem(key(id), JSON.stringify(operation))
    } catch {
      /* The receipt remains available in memory. */
    }
  }, [id, operation])

  function fail(
    value: ConversationControlOperation,
    action: ConversationControlAction,
    reason: unknown
  ) {
    if (
      !mounted.current ||
      currentSession.current !== id ||
      latest.current?.id !== value.id
    )
      return
    setIssue(controlFailure(value, action, reason))
  }
  function clearFor(
    value: ConversationControlOperation,
    action?: ConversationControlAction
  ) {
    setIssue((current) => resolveControlIssue(current, value, action))
  }
  async function query(
    value: ConversationControlOperation,
    signal?: AbortSignal
  ) {
    const result = await service.read(id, value.id, signal)
    if (signal?.aborted) return
    const accepted = acceptCurrent(
      value.id,
      result ?? {
        ...value,
        status: "failed",
        error: "请求未被接受，可以重新操作。",
      }
    )
    if (accepted) clearFor(accepted, "check")
    return accepted
  }
  async function read() {
    const value = latest.current
    if (!value || locked.current) return
    locked.current = true
    setRequest({ sessionId: id, operationId: value.id, action: "check" })
    try {
      return await query(value)
    } catch (reason) {
      if (
        mounted.current &&
        currentSession.current === id &&
        latest.current?.id === value.id
      )
        setIssue((current) =>
          current?.operationId === value.id &&
          current.action === "cancel" &&
          current.uncertain
            ? {
                ...current,
                ...feedbackFromError(
                  reason,
                  "暂时无法确认取消结果，请稍后再次检查。"
                ),
              }
            : controlFailure(value, "check", reason)
        )
    } finally {
      if (currentSession.current === id && mounted.current) {
        locked.current = false
        setRequest(undefined)
      }
    }
  }

  const operationId = operation?.id
  const operationStatus = operation?.status
  useEffect(() => {
    if (
      !operationId ||
      pending ||
      !["running", "cancelling", "unknown"].includes(operationStatus ?? "")
    )
      return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      const previous = latest.current
      if (!previous || previous.id !== operationId) return
      try {
        const result = await service.read(id, operationId!, controller.signal)
        if (controller.signal.aborted) return
        const accepted = acceptCurrent(
          operationId!,
          result ?? {
            ...previous,
            status: "failed",
            error: "请求未被接受，可以重新操作。",
          }
        )
        if (accepted) {
          setIssue((current) => resolveControlIssue(current, accepted, "check"))
          if (terminal(accepted)) return
        }
      } catch (reason) {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          currentSession.current === id &&
          latest.current?.id === operationId
        ) {
          setIssue((current) =>
            current?.operationId === operationId && current.action === "cancel"
              ? current
              : controlFailure(previous, "check", reason)
          )
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [id, operationId, operationStatus, pending, service, acceptCurrent])

  async function start(
    kind: ConversationControlOperation["kind"],
    extra: Pick<ConversationControlOperation, "focus" | "anchorId">,
    invoke: (operationId: string) => Promise<ConversationControlOperation>,
    onStarted?: (operationId: string) => void
  ) {
    if (locked.current || (latest.current && !terminal(latest.current))) return
    locked.current = true
    const now = new Date().toISOString()
    const receipt: ConversationControlOperation = {
      id: crypto.randomUUID(),
      kind,
      sessionId: id,
      status: "unknown",
      createdAt: now,
      updatedAt: now,
      error: "",
      ...extra,
    }
    setRequest({ sessionId: id, operationId: receipt.id, action: kind })
    setIssue(undefined)
    accept(receipt)
    onStarted?.(receipt.id)
    try {
      return acceptCurrent(receipt.id, await invoke(receipt.id))
    } catch (reason) {
      const current = latest.current
      if (
        !mounted.current ||
        currentSession.current !== id ||
        !current ||
        current.id !== receipt.id
      )
        return
      if (terminal(current)) return current
      if (reason instanceof RpcRequestRejected) {
        const failure = feedbackFromError(reason)
        const rejected = acceptCurrent(receipt.id, {
          ...current,
          status: "failed",
          error: failure.message,
        })
        fail(current, kind, reason)
        return rejected
      }
      fail(current, kind, reason)
      // A lost response never justifies resubmitting an operation.
      try {
        return await query(current)
      } catch {
        return current
      }
    } finally {
      if (currentSession.current === id && mounted.current) {
        locked.current = false
        setRequest(undefined)
      }
    }
  }
  async function compact(
    focus: string,
    onStarted?: (operationId: string) => void
  ) {
    return start(
      "compact",
      { focus },
      (operationId) => service.compact(id, operationId, focus),
      onStarted
    )
  }
  async function fork(entryId: string) {
    return start("fork", { anchorId: entryId }, (operationId) =>
      service.fork(id, operationId, entryId)
    )
  }
  async function cancel() {
    const value = latest.current
    if (
      locked.current ||
      value?.kind !== "compact" ||
      !["running", "cancelling"].includes(value.status)
    )
      return
    locked.current = true
    setRequest({ sessionId: id, operationId: value.id, action: "cancel" })
    try {
      const accepted = acceptCurrent(
        value.id,
        await service.cancel(id, value.id)
      )
      if (accepted) clearFor(accepted, "cancel")
      return accepted
    } catch (reason) {
      fail(value, "cancel", reason)
    } finally {
      if (currentSession.current === id && mounted.current) {
        locked.current = false
        setRequest(undefined)
      }
    }
  }

  const currentIssue =
    issue &&
    operation &&
    issue.operationId === operation.id &&
    issue.kind === operation.kind &&
    !["completed", "cancelled"].includes(operation.status)
      ? issue
      : undefined
  const compactIssue =
    currentIssue?.kind === "compact" ? currentIssue : undefined
  const forkIssue = currentIssue?.kind === "fork" ? currentIssue : undefined
  return {
    operation,
    pending,
    pendingAction,
    pendingOperationId,
    compactIssue,
    forkIssue,
    compactError: compactIssue?.message,
    forkError: forkIssue?.message,
    error: currentIssue?.message ?? "",
    compact,
    cancel,
    fork,
    read,
  }
}
