import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  createConversationControlService,
  type ConversationControlService,
} from "./conversation-control-service"
import type {
  ConversationControlOperation,
  ConversationSnapshot,
} from "@/features/models/model-contract.generated"

const key = (id: string) => `moon.control.pending.${id}`
function restore(id: string): ConversationControlOperation | undefined {
  try {
    return JSON.parse(localStorage.getItem(key(id)) || "null") || undefined
  } catch {
    return undefined
  }
}
export function useConversationControls(
  id: string,
  snapshot?: ConversationSnapshot,
  providedService?: ConversationControlService
) {
  const [service] = useState(
    () => providedService ?? createConversationControlService()
  )
  const [cachedOperation, setOperation] = useState<
    ConversationControlOperation | undefined
  >(() => restore(id))
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const received = snapshot?.control?.operation
  const operation =
    received &&
    (!cachedOperation ||
      received.createdAt > cachedOperation.createdAt ||
      (received.id === cachedOperation.id &&
        received.updatedAt >= cachedOperation.updatedAt))
      ? received
      : cachedOperation
  const latest = useRef(operation)
  const accept = useCallback(
    (value: ConversationControlOperation) => {
      setOperation(value)
      latest.current = value
      try {
        localStorage.setItem(key(id), JSON.stringify(value))
      } catch {
        /* Receipt remains in memory. */
      }
    },
    [id]
  )
  const acceptCurrent = useCallback(
    (requestId: string, value: ConversationControlOperation) => {
      const current = latest.current
      if (
        !current ||
        current.id !== requestId ||
        value.id !== requestId ||
        value.sessionId !== id
      )
        return
      // Queries may return out of order even for the same operation. Once the
      // host confirmed a terminal receipt, an earlier running receipt is stale.
      if (
        value.updatedAt < current.updatedAt ||
        (["completed", "cancelled", "failed"].includes(current.status) &&
          !["completed", "cancelled", "failed"].includes(value.status))
      )
        return current
      accept(value)
      return value
    },
    [accept, id]
  )
  useEffect(() => {
    if (operation) {
      try {
        localStorage.setItem(key(id), JSON.stringify(operation))
      } catch {
        /* In-memory recovery remains. */
      }
    }
  }, [id, operation])
  useLayoutEffect(() => {
    latest.current = operation
  }, [operation])
  const operationId = operation?.id
  const operationStatus = operation?.status
  async function read() {
    const value = latest.current
    if (!value) return
    try {
      const result = await service.read(id, value.id)
      const accepted = acceptCurrent(
        value.id,
        result ?? {
          ...value,
          status: "failed",
          error: value.error || "请求尚未接受，未开始操作；可以重新操作。",
        }
      )
      if (!accepted) return
      setError("")
      return accepted
    } catch (reason) {
      if (latest.current?.id === value.id)
        setError(reason instanceof Error ? reason.message : String(reason))
    }
  }
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
      try {
        const value = await service.read(id, operationId!, controller.signal)
        if (!controller.signal.aborted) {
          const previous = latest.current
          if (!previous || previous.id !== operationId) return
          const receipt = value ?? {
            ...previous,
            status: "failed" as const,
            error: previous.error || "请求尚未接受，未开始操作；可以重新操作。",
          }
          if (!acceptCurrent(operationId!, receipt)) return
          setError("")
        }
      } catch (reason) {
        if (!controller.signal.aborted && latest.current?.id === operationId)
          setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [id, operationId, operationStatus, pending, service, acceptCurrent])
  async function compact(
    focus: string,
    onStarted?: (operationId: string) => void
  ) {
    if (locked.current) return
    locked.current = true
    setPending(true)
    setError("")
    const now = new Date().toISOString()
    const receipt: ConversationControlOperation = {
      id: crypto.randomUUID(),
      kind: "compact",
      sessionId: id,
      status: "unknown",
      focus,
      createdAt: now,
      updatedAt: now,
      error: "",
    }
    accept(receipt)
    onStarted?.(receipt.id)
    try {
      const result = await service.compact(id, receipt.id, focus)
      return acceptCurrent(receipt.id, result)
    } catch (reason) {
      const current = latest.current
      if (!current || current.id !== receipt.id) return
      if (["completed", "cancelled", "failed"].includes(current.status))
        return current
      setError(reason instanceof Error ? reason.message : String(reason))
      // Preserve original identity until the server confirms its result.
      accept({
        ...current,
        error: reason instanceof Error ? reason.message : String(reason),
      })
      return await read()
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  async function cancel() {
    if (locked.current || !operation) return
    locked.current = true
    setPending(true)
    try {
      if (acceptCurrent(operation.id, await service.cancel(id, operation.id)))
        setError("")
    } catch (reason) {
      if (latest.current?.id === operation.id)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  async function fork(entryId: string) {
    if (locked.current) return
    locked.current = true
    setPending(true)
    setError("")
    const now = new Date().toISOString()
    const receipt: ConversationControlOperation = {
      id: crypto.randomUUID(),
      kind: "fork",
      sessionId: id,
      anchorId: entryId,
      status: "unknown",
      createdAt: now,
      updatedAt: now,
      error: "",
    }
    accept(receipt)
    try {
      const result = await service.fork(id, receipt.id, entryId)
      return acceptCurrent(receipt.id, result)
    } catch (reason) {
      const current = latest.current
      if (!current || current.id !== receipt.id) return
      if (["completed", "cancelled", "failed"].includes(current.status))
        return current
      setError(reason instanceof Error ? reason.message : String(reason))
      accept({
        ...current,
        error: reason instanceof Error ? reason.message : String(reason),
      })
      return await read()
    } finally {
      locked.current = false
      setPending(false)
    }
  }
  return { operation, error, pending, compact, cancel, fork, read }
}
