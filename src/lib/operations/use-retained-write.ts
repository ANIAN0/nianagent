import { useState, type RefObject } from "react"
import type { WriteReceipt } from "@/contracts/rpc.generated"
import type { FeedbackDescription } from "@/lib/operation-issue"
import {
  retainConfigurationAttempt,
  finishConfigurationAttempt,
} from "./configuration-recovery-store"

type Identity = {
  operation: WriteReceipt["operation"]
  operationRequestId: string
  targetId: string
  revision?: number
}

/** 原提交、副本和当前表单各有身份；持久清理成功后才释放内存中的未决 owner。 */
export function useRetainedWrite<
  S extends { evidence?: "demo" },
  A,
  R extends { attempt: A },
>({
  service,
  recordKey,
  records,
  identity,
  snapshot,
  submitted: submittedRef,
}: {
  service: S
  recordKey: string
  records: WeakMap<S, Map<string, R>>
  submitted: RefObject<A | null>
  identity: (attempt: A) => Identity
  snapshot: (attempt: A, issue: FeedbackDescription) => R
}) {
  const retained = records.get(service)?.get(recordKey)
  const [hasUnresolved, setHasUnresolved] = useState(!!retained)
  function remember(attempt: A, issue: FeedbackDescription) {
    retainConfigurationAttempt(identity(attempt), service.evidence === "demo")
    let owner = records.get(service)
    if (!owner) {
      owner = new Map()
      records.set(service, owner)
    }
    owner.set(recordKey, snapshot(attempt, issue))
    setHasUnresolved(true)
  }
  function clearAttempt() {
    const attempt = submittedRef.current
    if (attempt) {
      const original = identity(attempt)
      finishConfigurationAttempt(
        original.operation,
        original.operationRequestId,
        service.evidence === "demo"
      )
    }
    submittedRef.current = null
    records.get(service)?.delete(recordKey)
    setHasUnresolved(false)
  }
  return { hasUnresolved, remember, clearAttempt }
}
