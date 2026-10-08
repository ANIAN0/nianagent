import type { ConversationQueueOperationReceipt } from "@/contracts/rpc.generated"

/** Only immutable routing metadata is retained; message content never enters this store. */
export type QueueOperationRecord = Readonly<{
  sessionId: string
  operationRequestId: string
  operation: NonNullable<ConversationQueueOperationReceipt["operation"]>
  revision: number
  itemId?: string
  mode?: "single" | "all"
}>

export type QueueOperationStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>
const prefix = "moon.queue.operation.v1."
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9_-]{1,128}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value)

/** Project explicitly; passing a draft, headers or credentials cannot persist them. */
export function freezeQueueOperation(value: unknown): QueueOperationRecord {
  if (!value || typeof value !== "object")
    throw new Error("队列操作的恢复标识无效。")
  const input = value as Record<string, unknown>
  if (
    !validId(input.sessionId) ||
    !validId(input.operationRequestId) ||
    typeof input.revision !== "number" ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    ![
      "conversationQueueRemove",
      "conversationQueueMode",
      "conversationQueueDeliver",
    ].includes(String(input.operation)) ||
    (input.operation === "conversationQueueMode"
      ? !["single", "all"].includes(String(input.mode))
      : !validId(input.itemId))
  )
    throw new Error("队列操作的恢复标识无效。")
  return Object.freeze({
    sessionId: input.sessionId,
    operationRequestId: input.operationRequestId,
    operation: input.operation as QueueOperationRecord["operation"],
    revision: input.revision as number,
    ...(input.operation === "conversationQueueMode"
      ? { mode: input.mode as "single" | "all" }
      : { itemId: input.itemId as string }),
  })
}

export const queueOperationIdentity = (
  record: Pick<QueueOperationRecord, "sessionId" | "operationRequestId">
) => JSON.stringify([record.sessionId, record.operationRequestId])
export const queueOperationIssueKey = (record: QueueOperationRecord) =>
  record.operation === "conversationQueueMode"
    ? "mode"
    : `${record.operation === "conversationQueueRemove" ? "queue-remove" : "queue-deliver"}:${record.itemId}`
const storageKey = (record: QueueOperationRecord) =>
  prefix + queueOperationIdentity(record)
const browserStorage = () =>
  typeof localStorage === "undefined" ? undefined : localStorage

/** A current queue snapshot is never evidence about this original operation. */
export function queueReceiptMatches(
  record: QueueOperationRecord,
  receipt: ConversationQueueOperationReceipt
) {
  if (
    receipt.sessionId !== record.sessionId ||
    receipt.operationRequestId !== record.operationRequestId ||
    !["committed", "rejected", "unknown"].includes(receipt.state)
  )
    return false
  if (receipt.state === "unknown" && receipt.operation === undefined)
    return (
      receipt.baseRevision === undefined &&
      receipt.itemId === undefined &&
      receipt.mode === undefined
    )
  return (
    receipt.operation === record.operation &&
    receipt.baseRevision === record.revision &&
    (record.operation === "conversationQueueMode"
      ? receipt.mode === record.mode && receipt.itemId === undefined
      : receipt.itemId === record.itemId && receipt.mode === undefined)
  )
}

export function saveQueueOperation(
  value: unknown,
  storage: QueueOperationStorage | undefined = browserStorage()
) {
  const record = freezeQueueOperation(value)
  if (!storage)
    throw new Error("本机无法保存队列操作的恢复记录，本次操作尚未发送。")
  const previous = storage.getItem(storageKey(record))
  if (
    previous !== null &&
    JSON.stringify(freezeQueueOperation(JSON.parse(previous))) !==
      JSON.stringify(record)
  )
    throw new Error("队列操作的原恢复标识已变化，本次操作尚未发送。")
  storage.setItem(storageKey(record), JSON.stringify(record))
  return record
}

export function restoreQueueOperations(
  suppliedStorage?: QueueOperationStorage
) {
  const records: QueueOperationRecord[] = []
  let error: Error | undefined
  try {
    const storage = suppliedStorage ?? browserStorage()
    if (!storage) return { records, error }
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (!key?.startsWith(prefix)) continue
      try {
        const record = freezeQueueOperation(
          JSON.parse(storage.getItem(key) ?? "null")
        )
        if (storageKey(record) !== key)
          throw new Error("队列操作的恢复标识不匹配。")
        records.push(record)
      } catch {
        error = new Error(
          "队列操作的本机恢复记录损坏，原记录保留；核对完成前不会发送新的队列修改。"
        )
      }
    }
  } catch {
    error = new Error(
      "暂时无法读取队列操作的本机恢复记录；核对完成前不会发送新的队列修改。"
    )
  }
  return { records, error }
}

/** Late cleanup cannot delete a different operation, revision or target. */
export function clearQueueOperation(
  record: QueueOperationRecord,
  storage: QueueOperationStorage | undefined = browserStorage()
) {
  if (!storage) throw new Error("本机无法清理已确认的队列操作恢复记录。")
  const key = storageKey(record)
  const stored = storage.getItem(key)
  if (stored === null) return
  const current = freezeQueueOperation(JSON.parse(stored))
  if (JSON.stringify(current) !== JSON.stringify(record))
    throw new Error("队列操作的恢复记录已变化，未清理其他操作。")
  storage.removeItem(key)
}
