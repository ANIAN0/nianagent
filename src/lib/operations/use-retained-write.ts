import { useLayoutEffect, useState, type RefObject } from "react"
import {
  retainConfigurationDraft,
  clearConfigurationDraft,
} from "./configuration-draft-store"
import { useMaintenanceSave } from "@/lib/maintenance/maintenance-coordinator"
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
  function saveCurrent() {
    const attempt = submittedRef.current
    const record = records.get(service)?.get(recordKey)
    if (attempt && record) {
      const next = snapshot(
        attempt,
        (record as R & { issue: FeedbackDescription }).issue
      )
      records.get(service)?.set(recordKey, next)
      retainConfigurationDraft(
        identity(attempt),
        recordKey,
        next,
        service.evidence === "demo"
      )
    }
  }
  // 当前编辑副本同步到原请求 owner；离开页面不会丢掉未知操作的下一份草稿。
  useLayoutEffect(() => {
    if (!hasUnresolved) return
    try {
      saveCurrent()
    } catch {
      /* 维护 flush 会重试并返回实际保存失败。 */
    }
  })
  useMaintenanceSave(saveCurrent)
  function remember(attempt: A, issue: FeedbackDescription) {
    const original = identity(attempt)
    const next = snapshot(attempt, issue)
    retainConfigurationDraft(
      original,
      recordKey,
      next,
      service.evidence === "demo"
    )
    retainConfigurationAttempt(original, service.evidence === "demo")
    let owner = records.get(service)
    if (!owner) {
      owner = new Map()
      records.set(service, owner)
    }
    owner.set(recordKey, next)
    setHasUnresolved(true)
  }
  function clearAttempt() {
    const attempt = submittedRef.current
    if (attempt) {
      const original = identity(attempt)
      clearConfigurationDraft(
        original.operation,
        recordKey,
        original.operationRequestId,
        service.evidence === "demo"
      )
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
