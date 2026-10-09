import { useMaintenanceSave } from "@/lib/maintenance/maintenance-coordinator"
import { useCallback, useRef, useState } from "react"

import type { ConversationSnapshot } from "@/contracts/rpc.generated"
import { type ConversationService } from "./conversation-service"
import { RpcRequestRejected } from "@/lib/rpc/client"

import {
  clearQueueOperation,
  freezeQueueOperation,
  queueOperationIdentity,
  queueOperationIssueKey,
  queueReceiptMatches,
  restoreQueueOperations,
  saveQueueOperation,
  type QueueOperationRecord,
} from "./queue-operation-recovery"

import {
  feedbackFromError,
  type FeedbackDescription,
} from "@/lib/operation-issue"

import type * as React from "react"
export type ConversationActionIssue = FeedbackDescription & {
  action: "send" | "stop" | "retry" | "reconcile"
  runId?: string
  epoch?: string
}
type ActionKind =
  | ConversationActionIssue["action"]
  | "queue-edit"
  | "queue-remove"
  | "queue-mode"
  | "queue-deliver"
const unknownQueueIssue = (
  record: QueueOperationRecord,
  details?: string
): FeedbackDescription => ({
  code: "result_unknown",
  message:
    record.operation === "conversationQueueRemove"
      ? "尚未确认这条排队消息的移除结果，请先核对原操作。"
      : record.operation === "conversationQueueMode"
        ? `尚未确认${record.mode === "single" ? "逐条" : "全部"}交付设置，请先核对原操作。`
        : "尚未确认这条消息的交付操作是否已采用，请先核对原操作。",
  recovery: "check",
  severity: "warning",
  ...(details ? { details } : {}),
})
const restoredQueueIssues = (records: QueueOperationRecord[]) => {
  const issues: Record<
    string,
    Record<string, FeedbackDescription | undefined>
  > = {}
  for (const record of records)
    (issues[record.sessionId] ??= {})[queueOperationIssueKey(record)] =
      unknownQueueIssue(record)
  return issues
}
/** 只维护这一组状态的所有权，迟到结果仍按原身份核对。 */
export function useQueueRecovery({
  service,
  perform,
  locks,
  current,
}: {
  service: Pick<
    ConversationService,
    "queueReceipt" | "queueRemove" | "queueMode" | "queueDeliver"
  >
  perform: (
    id: string,
    action: () => Promise<ConversationSnapshot>,
    kind?: ActionKind
  ) => Promise<ConversationSnapshot>
  locks: React.RefObject<Set<string>>
  current: React.RefObject<Record<string, ConversationSnapshot>>
}) {
  const [restoredQueue] = useState(restoreQueueOperations)
  const queueRecoveries = useRef(
    new Map(
      restoredQueue.records.map((record) => [
        queueOperationIdentity(record),
        record,
      ])
    )
  )
  useMaintenanceSave(() => {
    for (const record of queueRecoveries.current.values())
      saveQueueOperation(record)
  })
  const [queueRecoveryRecords, setQueueRecoveryRecords] = useState(
    restoredQueue.records
  )
  const queueRecoveryFault = useRef(restoredQueue.error)
  const queueRestoreRequested = useRef(false)
  const [queueRecoveryError, setQueueRecoveryError] = useState(
    restoredQueue.error
  )
  const queueInFlight = useRef(new Set<string>())
  const queueKnownResults = useRef(
    new Map<string, FeedbackDescription | undefined>()
  )
  const queueRecordIssues = useRef(
    new Map<string, FeedbackDescription | undefined>(
      restoredQueue.records.map((record) => [
        queueOperationIdentity(record),
        unknownQueueIssue(record),
      ])
    )
  )
  const [queueRecoveryIssuesByRequest, setQueueRecoveryIssuesByRequest] =
    useState<Record<string, Record<string, FeedbackDescription | undefined>>>(
      () =>
        Object.fromEntries(
          [
            ...new Set(restoredQueue.records.map((record) => record.sessionId)),
          ].map((id) => [
            id,
            Object.fromEntries(
              restoredQueue.records
                .filter((record) => record.sessionId === id)
                .map((record) => [
                  record.operationRequestId,
                  unknownQueueIssue(record),
                ])
            ),
          ])
        )
    )
  const queueRetryAllowed = useRef(new Set<string>())
  const queueReceiptReads = useRef(new Map<string, Promise<void>>())
  const [queueOriginalRetryAllowed, setQueueOriginalRetryAllowed] = useState<
    Record<string, Record<string, boolean>>
  >({})
  const [
    queueOriginalRetryAllowedByRequest,
    setQueueOriginalRetryAllowedByRequest,
  ] = useState<Record<string, Record<string, boolean>>>({})
  const [queueIssues, setQueueIssues] = useState<
    Record<string, Record<string, FeedbackDescription | undefined>>
  >(() => restoredQueueIssues(restoredQueue.records))
  const publishQueueRecovery = useCallback(() => {
    const records = [...queueRecoveries.current.values()]
    setQueueRecoveryRecords((previous) =>
      previous.length === records.length &&
      previous.every((record, index) => record === records[index])
        ? previous
        : records
    )
    const allowed: Record<string, Record<string, boolean>> = {}
    const byRequest: Record<string, Record<string, boolean>> = {}
    const issuesByRequest: Record<
      string,
      Record<string, FeedbackDescription | undefined>
    > = {}
    for (const record of records) {
      const key = queueOperationIssueKey(record)
      const sameObject = records.filter(
        (other) =>
          other.sessionId === record.sessionId &&
          queueOperationIssueKey(other) === key
      )
      ;(allowed[record.sessionId] ??= {})[key] =
        sameObject.length === 1 &&
        queueRetryAllowed.current.has(queueOperationIdentity(record))
      ;(byRequest[record.sessionId] ??= {})[record.operationRequestId] =
        queueRetryAllowed.current.has(queueOperationIdentity(record))
      ;(issuesByRequest[record.sessionId] ??= {})[record.operationRequestId] =
        queueRecordIssues.current.get(queueOperationIdentity(record))
    }
    setQueueOriginalRetryAllowed(allowed)
    setQueueOriginalRetryAllowedByRequest(byRequest)
    setQueueRecoveryIssuesByRequest(issuesByRequest)
  }, [])
  const finishQueueRecovery = useCallback(
    (record: QueueOperationRecord, issue?: FeedbackDescription) => {
      const identity = queueOperationIdentity(record)
      if (queueRecoveries.current.get(identity) !== record) return
      queueRetryAllowed.current.delete(identity)
      queueKnownResults.current.set(identity, issue)
      const key = queueOperationIssueKey(record)
      try {
        clearQueueOperation(record)
        queueRecoveries.current.delete(identity)
        queueKnownResults.current.delete(identity)
        queueRecordIssues.current.delete(identity)
        const other = [...queueRecoveries.current.values()].find(
          (value) =>
            value.sessionId === record.sessionId &&
            queueOperationIssueKey(value) === key
        )
        setQueueIssues((all) => ({
          ...all,
          [record.sessionId]: {
            ...all[record.sessionId],
            [key]: other ? unknownQueueIssue(other) : issue,
          },
        }))
      } catch {
        const cleanupIssue: FeedbackDescription = {
          code: "result_unknown",
          message:
            "队列操作结果已确认，本机恢复标识尚未清理。请重新核对以完成本地清理，不会重复执行。",
          recovery: "check",
          severity: "warning",
        }
        queueRecordIssues.current.set(identity, cleanupIssue)
        setQueueIssues((all) => ({
          ...all,
          [record.sessionId]: {
            ...all[record.sessionId],
            [key]: cleanupIssue,
          },
        }))
      }
      publishQueueRecovery()
    },
    [publishQueueRecovery]
  )
  const inspectQueueReceipts = useCallback(
    (
      id: string,
      signal?: AbortSignal,
      refreshStorage = true
    ): Promise<void> => {
      const existing = queueReceiptReads.current.get(id)
      if (existing) return existing
      const inspection = (async () => {
        signal?.throwIfAborted()
        // Cold restore is already complete. Ordinary polling checks retained
        // receipts without repeatedly scanning every session draft in storage.
        if (refreshStorage) {
          const recovered = restoreQueueOperations()
          queueRecoveryFault.current = recovered.error
          setQueueRecoveryError(recovered.error)
          for (const record of recovered.records) {
            const identity = queueOperationIdentity(record)
            const currentRecord = queueRecoveries.current.get(identity)
            if (
              currentRecord &&
              JSON.stringify(currentRecord) !== JSON.stringify(record)
            ) {
              const error = new Error(
                "队列恢复标识与本机原记录不一致；核对前不会发送新的修改。"
              )
              queueRecoveryFault.current = error
              setQueueRecoveryError(error)
            } else if (!currentRecord) {
              queueRecoveries.current.set(identity, record)
              queueRecordIssues.current.set(identity, unknownQueueIssue(record))
              setQueueIssues((all) => ({
                ...all,
                [record.sessionId]: {
                  ...all[record.sessionId],
                  [queueOperationIssueKey(record)]: unknownQueueIssue(record),
                },
              }))
            }
          }
          publishQueueRecovery()
        }
        for (const record of [...queueRecoveries.current.values()]) {
          if (record.sessionId !== id) continue
          signal?.throwIfAborted()
          const identity = queueOperationIdentity(record)
          if (queueInFlight.current.has(identity)) continue
          if (queueKnownResults.current.has(identity)) {
            finishQueueRecovery(record, queueKnownResults.current.get(identity))
            continue
          }
          try {
            const receipt = await service.queueReceipt(
              id,
              record.operationRequestId,
              signal
            )
            signal?.throwIfAborted()
            if (
              queueRecoveries.current.get(identity) !== record ||
              queueInFlight.current.has(identity)
            )
              continue
            if (!queueReceiptMatches(record, receipt))
              throw new RpcRequestRejected(
                "原队列操作回执与本机标识不一致，请重启服务后重新核对。",
                {
                  code: "request_identity_conflict",
                  summary:
                    "原队列操作回执与本机标识不一致，原操作保留，未发送新的修改。",
                  recovery: "check",
                  severity: "warning",
                }
              )
            if (receipt.state === "committed" || receipt.state === "rejected") {
              const issue =
                receipt.state === "rejected"
                  ? feedbackFromError(
                      { issue: receipt.issue },
                      "原队列操作未被采用，请重新读取后再操作。"
                    )
                  : undefined
              finishQueueRecovery(
                record,
                issue && issue.recovery === "check"
                  ? { ...issue, recovery: "reload" }
                  : issue
              )
              continue
            }
            if (
              receipt.retryOriginalAllowed === true &&
              receipt.operation === undefined
            )
              queueRetryAllowed.current.add(identity)
            else queueRetryAllowed.current.delete(identity)
            const issue = unknownQueueIssue(
              record,
              receipt.retryOriginalAllowed === true &&
                receipt.operation === undefined
                ? "宿主尚未登记原操作。可以显式恢复原操作；恢复使用相同编号、原目标和原版本，不会创建新请求。"
                : "原操作仍待宿主确认。读取回执不会重新执行移除、修改交付设置或交付消息。"
            )
            queueRecordIssues.current.set(identity, issue)
            setQueueIssues((all) => ({
              ...all,
              [id]: {
                ...all[id],
                [queueOperationIssueKey(record)]: issue,
              },
            }))
            publishQueueRecovery()
          } catch (error) {
            if (signal?.aborted) throw error
            if (queueRecoveries.current.get(identity) !== record) continue
            queueRetryAllowed.current.delete(identity)
            const failure = feedbackFromError(
              error,
              "暂时无法核对原队列操作，原标识已保留。"
            )
            const issue: FeedbackDescription = {
              ...unknownQueueIssue(record, failure.message),
              ...(failure.recovery === "restart"
                ? { recovery: "restart" }
                : {}),
            }
            queueRecordIssues.current.set(identity, issue)
            setQueueIssues((all) => ({
              ...all,
              [id]: {
                ...all[id],
                [queueOperationIssueKey(record)]: issue,
              },
            }))
            publishQueueRecovery()
          }
        }
      })()
      queueReceiptReads.current.set(id, inspection)
      void inspection
        .finally(() => {
          if (queueReceiptReads.current.get(id) === inspection)
            queueReceiptReads.current.delete(id)
        })
        .catch(() => {})
      return inspection
    },
    [service, publishQueueRecovery, finishQueueRecovery]
  )
  const assertQueueRecovered = (id: string) => {
    const reason =
      queueRecoveryFault.current?.message ||
      ([...queueRecoveries.current.values()].some(
        (record) => record.sessionId === id
      )
        ? "请先核对原队列操作；当前草稿保留，不会发送新的修改。"
        : undefined)
    if (reason)
      throw new RpcRequestRejected(reason, {
        code: "queue_recovery_pending",
        summary: reason,
        recovery: "reload",
        severity: "warning",
      })
  }
  async function executeQueueOperation(record: QueueOperationRecord) {
    const identity = queueOperationIdentity(record)
    const id = record.sessionId
    const key = queueOperationIssueKey(record)
    if (queueRecoveries.current.get(identity) !== record)
      throw new Error("原队列操作标识已变化，请重新核对。")
    const kind: ActionKind =
      record.operation === "conversationQueueMode"
        ? "queue-mode"
        : record.operation === "conversationQueueRemove"
          ? "queue-remove"
          : "queue-deliver"
    return perform(
      id,
      async () => {
        queueInFlight.current.add(identity)
        queueRetryAllowed.current.delete(identity)
        publishQueueRecovery()
        try {
          const base = {
            sessionId: id,
            operationRequestId: record.operationRequestId,
            revision: record.revision,
          }
          const snapshot =
            record.operation === "conversationQueueMode"
              ? await service.queueMode({ ...base, mode: record.mode! })
              : record.operation === "conversationQueueRemove"
                ? await service.queueRemove({ ...base, itemId: record.itemId! })
                : await service.queueDeliver({
                    ...base,
                    itemId: record.itemId!,
                  })
          if (snapshot.id !== id)
            throw new Error("队列操作返回的会话标识不一致。")
          // RPC success proves adoption of this original queue intention only;
          // it is not proof that Pi accepted input or completed a reply.
          finishQueueRecovery(record)
          return snapshot
        } catch (error) {
          const issue = feedbackFromError(error)
          if (
            error instanceof RpcRequestRejected &&
            issue.code !== "result_unknown"
          )
            finishQueueRecovery(
              record,
              issue.recovery === "check"
                ? { ...issue, recovery: "reload" }
                : issue
            )
          else if (queueRecoveries.current.get(identity) === record) {
            const originalIssue = unknownQueueIssue(record, issue.message)
            queueRecordIssues.current.set(identity, originalIssue)
            setQueueIssues((all) => ({
              ...all,
              [id]: {
                ...all[id],
                [key]: originalIssue,
              },
            }))
            publishQueueRecovery()
          }
          throw error
        } finally {
          queueInFlight.current.delete(identity)
        }
      },
      kind
    )
  }
  async function startQueueOperation(
    id: string,
    operation: QueueOperationRecord["operation"],
    target: { itemId: string } | { mode: "single" | "all" }
  ) {
    assertQueueRecovered(id)
    if (locks.current.has(id)) throw new Error("正在处理此会话的操作，请稍候。")
    const record = freezeQueueOperation({
      sessionId: id,
      operationRequestId: crypto.randomUUID(),
      operation,
      revision: current.current[id]?.queue?.revision ?? 0,
      ...target,
    })
    try {
      saveQueueOperation(record)
    } catch (error) {
      const issue: FeedbackDescription = {
        code: "queue_recovery_storage",
        message:
          "本机无法保存队列操作的恢复标识，本次修改尚未发送。请恢复本地存储后重试。",
        recovery: "reload",
        severity: "warning",
      }
      setQueueIssues((all) => ({
        ...all,
        [id]: { ...all[id], [queueOperationIssueKey(record)]: issue },
      }))
      throw new RpcRequestRejected(issue.message, {
        code: issue.code,
        summary: issue.message,
        recovery: "reload",
        severity: "warning",
        ...(error instanceof Error
          ? { details: "未调用宿主修改接口，原队列保持不变。" }
          : {}),
      })
    }
    queueRecoveries.current.set(queueOperationIdentity(record), record)
    queueRecordIssues.current.set(queueOperationIdentity(record), undefined)
    setQueueIssues((all) => ({
      ...all,
      [id]: { ...all[id], [queueOperationIssueKey(record)]: undefined },
    }))
    publishQueueRecovery()
    return executeQueueOperation(record)
  }
  async function retryQueueOriginal(
    id: string,
    key: string,
    expectedRequestId?: string
  ) {
    const records = [...queueRecoveries.current.values()].filter(
      (record) =>
        record.sessionId === id &&
        queueOperationIssueKey(record) === key &&
        (!expectedRequestId || record.operationRequestId === expectedRequestId)
    )
    const record = records[0]
    if (
      queueRecoveryFault.current ||
      records.length !== 1 ||
      !queueRetryAllowed.current.has(queueOperationIdentity(record)) ||
      queueKnownResults.current.has(queueOperationIdentity(record)) ||
      queueReceiptReads.current.has(id) ||
      locks.current.has(id)
    )
      throw new Error("原队列操作尚不可恢复，请先完成核对。")
    // Re-persist the same frozen metadata before recovery. No new request ID,
    // current revision, edited text or material can enter this original call.
    try {
      saveQueueOperation(record)
    } catch {
      queueRetryAllowed.current.delete(queueOperationIdentity(record))
      const originalIssue = unknownQueueIssue(
        record,
        "本机恢复标识未能保存；恢复尚未发送，请释放本地存储后重新核对。"
      )
      queueRecordIssues.current.set(
        queueOperationIdentity(record),
        originalIssue
      )
      setQueueIssues((all) => ({
        ...all,
        [id]: {
          ...all[id],
          [key]: originalIssue,
        },
      }))
      publishQueueRecovery()
      throw new Error("本机恢复标识未能保存，原操作没有再次发送。")
    }
    return executeQueueOperation(record)
  }
  return {
    queueRestoreRequested,
    queueRecoveryFault,
    inspectQueueReceipts,
    assertQueueRecovered,
    queueIssues,
    queueRecoveryRecords,
    queueRecoveryError,
    queueInFlight,
    queueRecoveryIssuesByRequest,
    queueOriginalRetryAllowed,
    queueOriginalRetryAllowedByRequest,
    retryQueueOriginal,
    startQueueOperation,
  }
}
