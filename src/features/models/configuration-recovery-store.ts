import { useSyncExternalStore } from "react"
import {
  receiptOperationNames,
  type WriteReceipt,
} from "./model-contract.generated"
import type { FeedbackDescription } from "@/lib/operation-issue"

export type ConfigurationRecovery = {
  operation: WriteReceipt["operation"] | "authStart"
  operationRequestId: string
  targetId: string
  revision?: number
}
const storageKey = "moon.configuration-recovery.v1"
const operationNames = new Set<string>([...receiptOperationNames, "authStart"])
const listeners = new Set<() => void>()
let initialized = false
let records: ConfigurationRecovery[] = []
let failure: FeedbackDescription | undefined
let state = { records, failure }
const emptyState: typeof state = { records: [], failure: undefined }
// In-memory drafts handle operations created in this process. Only restart
// recovery uses this store; it contains no payload, credential or input text.
const createdHere = new Set<string>()
// Only authoritative terminal outcomes or an explicit local abandon may be
// cleared after storage becomes available. Unconfirmed identities are retained.
const finishedHere = new Set<string>()
const keyOf = (
  value: Pick<ConfigurationRecovery, "operation" | "operationRequestId">
) => `${value.operation}:${value.operationRequestId}`
function storageFailure(): FeedbackDescription {
  return {
    code: "recovery_storage_unavailable",
    severity: "error",
    recovery: "none",
    message:
      "本机恢复记录无法读写。为避免结果未确认后重复提交，暂不能发起新的设置写入；请检查本机存储访问。",
  }
}
function safeRecord(value: unknown): ConfigurationRecovery {
  if (!value || typeof value !== "object")
    throw new Error("Invalid recovery identity")
  const record = value as Record<string, unknown>
  if (
    typeof record.operation !== "string" ||
    !operationNames.has(record.operation) ||
    typeof record.operationRequestId !== "string" ||
    !record.operationRequestId ||
    record.operationRequestId.length > 128 ||
    typeof record.targetId !== "string" ||
    !record.targetId ||
    record.targetId.length > 256 ||
    (record.revision !== undefined &&
      (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0))
  )
    throw new Error("Invalid recovery identity")
  return {
    operation: record.operation as ConfigurationRecovery["operation"],
    operationRequestId: record.operationRequestId,
    targetId: record.targetId,
    ...(record.revision !== undefined
      ? { revision: Number(record.revision) }
      : {}),
  }
}
function read() {
  try {
    const raw = localStorage.getItem(storageKey)
    const saved: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(saved) || saved.length > 128)
      throw new Error("Invalid recovery collection")
    const restored = saved.map(safeRecord)
    if (new Set(restored.map(keyOf)).size !== restored.length)
      throw new Error("Duplicate recovery identity")
    records = restored
    failure = undefined
  } catch {
    failure = storageFailure()
  }
  initialized = true
  state = { records, failure }
}
function publish() {
  state = { records, failure }
  for (const listener of listeners) listener()
}
function snapshot() {
  if (!initialized) read()
  return state
}
function write(next: ConfigurationRecovery[]) {
  if (next.length > 128)
    throw new Error("Unresolved recovery collection is full")
  localStorage.setItem(storageKey, JSON.stringify(next))
  records = next
  failure = undefined
  publish()
}
export function retainConfigurationAttempt(
  value: ConfigurationRecovery,
  demo = false
) {
  if (demo) return
  snapshot()
  const record = safeRecord(value)
  if (records.some((item) => keyOf(item) === keyOf(record))) return
  if (failure) throw { issue: { ...failure, summary: failure.message } }
  const identity = keyOf(record)
  createdHere.add(identity)
  try {
    write([...records, record])
  } catch {
    createdHere.delete(identity)
    failure = storageFailure()
    publish()
    throw { issue: { ...failure, summary: failure.message } }
  }
}
export function finishConfigurationAttempt(
  operation: ConfigurationRecovery["operation"],
  operationRequestId: string,
  demo = false,
  abandoned = false
) {
  if (demo) return
  snapshot()
  const identity = `${operation}:${operationRequestId}`
  finishedHere.add(identity)
  if (failure) {
    failure = {
      ...failure,
      severity: "warning",
      message: abandoned
        ? "本机恢复记录暂不能清除；原请求没有取消或撤销，恢复身份仍保留。"
        : "原请求结果已经确定，但本机恢复记录暂不能清除；恢复身份仍保留，下次仅核对原请求。",
    }
    publish()
    return
  }
  try {
    write(
      records.filter(
        (record) =>
          record.operation !== operation ||
          record.operationRequestId !== operationRequestId
      )
    )
    createdHere.delete(identity)
    finishedHere.delete(identity)
  } catch {
    failure = {
      ...storageFailure(),
      severity: "warning",
      message:
        "原请求的结果已经确定，但本机恢复记录暂不能清除。下次打开仍会核对同一个原请求，不会重复执行。",
    }
    publish()
  }
}
export function recheckConfigurationRecoveryStore() {
  read()
  if (failure) {
    publish()
    return false
  }
  try {
    const next = records.filter((record) => !finishedHere.has(keyOf(record)))
    if (next.length !== records.length) write(next)
    else publish()
    for (const identity of finishedHere) createdHere.delete(identity)
    finishedHere.clear()
    return true
  } catch {
    failure = {
      ...storageFailure(),
      severity: "warning",
      message:
        "本机存储仍不能清理已确认的恢复记录；未确认请求保持原身份，请恢复存储访问后再核对。",
    }
    publish()
    return false
  }
}
export function isRestoredConfigurationAttempt(value: ConfigurationRecovery) {
  return !createdHere.has(keyOf(value))
}
export function useConfigurationRecoveries(demo = false) {
  const all = useSyncExternalStore(
    (listener) => {
      if (demo) return () => {}
      listeners.add(listener)
      const changed = (event: StorageEvent) => {
        if (event.key === storageKey) {
          read()
          publish()
        }
      }
      window.addEventListener("storage", changed)
      return () => {
        listeners.delete(listener)
        window.removeEventListener("storage", changed)
      }
    },
    demo ? () => emptyState : snapshot
  )
  return {
    records: demo ? [] : all.records.filter(isRestoredConfigurationAttempt),
    issue: demo ? undefined : all.failure,
  }
}
