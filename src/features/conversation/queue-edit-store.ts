import type { ComposerDraft } from "@/lib/composer/types"
import type { FeedbackDescription } from "@/lib/operation-issue"

export type QueueEditSubmission = {
  /** Stable clientEditId sent to the host; a shared CAS revision alone is not a receipt. */
  token: string
  draft: ComposerDraft
  revision?: number
  acknowledged?: boolean
}
export type QueueEditRecord = {
  sessionId: string
  id: string
  revision?: number
  draft: ComposerDraft
  originalDraft: ComposerDraft
  originalStatus?: "pending" | "dispatching" | "failed"
  submitted?: QueueEditSubmission
  issue?: FeedbackDescription
}
export type QueueEditReceipt = {
  editBaseRevision?: number
  editRequestId?: string
}
/** An accepted edit remains accepted if its later delivery fails or retires. */
export function matchesQueueEditReceipt(
  submission: QueueEditSubmission | undefined,
  receipt: QueueEditReceipt | undefined
) {
  return (
    !!submission &&
    submission.revision !== undefined &&
    receipt?.editBaseRevision === submission.revision &&
    receipt.editRequestId === submission.token
  )
}
const prefix = "moon.queue.edit.v1."
const retained = new Map<string, QueueEditRecord>()
export type QueueEditOwnerSnapshot = {
  record?: QueueEditRecord
  storageIssue?: FeedbackDescription
}
const snapshots = new Map<string, QueueEditOwnerSnapshot>()
const storageIssues = new Map<string, FeedbackDescription>()
const listeners = new Map<string, Set<() => void>>()
const keyFor = (sessionId: string, id: string) =>
  prefix + JSON.stringify([sessionId, id])
/** Stable snapshots let React subscribe to the persisted editor's actual owner. */
export function getQueueEditOwnerSnapshot(sessionId: string) {
  let snapshot = snapshots.get(sessionId)
  if (!snapshot) {
    snapshot = {
      record: [...retained.values()].find(
        (record) => record.sessionId === sessionId
      ),
      storageIssue: storageIssues.get(sessionId),
    }
    snapshots.set(sessionId, snapshot)
  }
  return snapshot
}
export function subscribeQueueEdits(sessionId: string, listener: () => void) {
  let owned = listeners.get(sessionId)
  if (!owned) {
    owned = new Set()
    listeners.set(sessionId, owned)
  }
  owned.add(listener)
  const subscriptions = owned
  return () => {
    subscriptions.delete(listener)
    if (!subscriptions.size) listeners.delete(sessionId)
  }
}
function publishQueueEdits(sessionId: string) {
  const next = {
    record: [...retained.values()].find(
      (record) => record.sessionId === sessionId
    ),
    storageIssue: storageIssues.get(sessionId),
  }
  const previous = snapshots.get(sessionId)
  if (
    previous?.record === next.record &&
    previous?.storageIssue === next.storageIssue
  )
    return
  snapshots.set(sessionId, next)
  for (const listener of listeners.get(sessionId) ?? []) listener()
}
export function setQueueEditStorageIssue(
  sessionId: string,
  issue?: FeedbackDescription
) {
  if (issue) storageIssues.set(sessionId, issue)
  else storageIssues.delete(sessionId)
  publishQueueEdits(sessionId)
}
/** Catalog owners are ephemeral; no abandoned UI snapshot survives their unmount. */
export function releaseQueueEditOwner(sessionId: string) {
  if ([...retained.values()].some((record) => record.sessionId === sessionId))
    return
  storageIssues.delete(sessionId)
  snapshots.delete(sessionId)
}
function copyDraft(value: ComposerDraft): ComposerDraft {
  return {
    ...value,
    materials: value.materials.map((material) => {
      const copy = { ...material }
      delete copy.thumbnail
      return copy
    }),
  }
}
export function queueEditSignature(draft: ComposerDraft) {
  return JSON.stringify([
    draft.text.trim(),
    draft.materials.map(({ id, type, source, status }) => [
      id,
      type,
      source,
      status,
    ]),
  ])
}
function validDraft(value: unknown): value is ComposerDraft {
  if (!value || typeof value !== "object") return false
  const draft = value as Partial<ComposerDraft>
  return (
    typeof draft.text === "string" &&
    typeof draft.model === "string" &&
    typeof draft.thinking === "string" &&
    typeof draft.workspaceId === "string" &&
    Array.isArray(draft.materials) &&
    draft.materials.every(
      (material) =>
        !!material &&
        typeof material === "object" &&
        typeof material.id === "string" &&
        typeof material.name === "string" &&
        typeof material.kind === "string"
    ) &&
    !!draft.session &&
    Array.isArray(draft.session.toolIds) &&
    ["all", "directory", "none"].includes(draft.session.instructionScope)
  )
}
export function restoreQueueEdits(sessionId: string, persistent = true) {
  let malformed = false
  if (persistent) {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix) || retained.has(key)) continue
      let identity: unknown
      try {
        identity = JSON.parse(key.slice(prefix.length))
      } catch {
        continue
      }
      if (!Array.isArray(identity) || identity[0] !== sessionId) continue
      let value: unknown
      try {
        value = JSON.parse(localStorage.getItem(key) ?? "null")
      } catch {
        malformed = true
        continue
      }
      if (!value || typeof value !== "object") {
        malformed = true
        continue
      }
      const record = value as QueueEditRecord
      if (
        record.sessionId !== sessionId ||
        typeof record.id !== "string" ||
        !validDraft(record.draft) ||
        !validDraft(record.originalDraft) ||
        (record.revision !== undefined &&
          (!Number.isInteger(record.revision) || record.revision < 0))
      ) {
        malformed = true
        continue
      }
      if (
        record.submitted &&
        (typeof record.submitted.token !== "string" ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(record.submitted.token) ||
          !validDraft(record.submitted.draft) ||
          record.submitted.revision !== record.revision)
      ) {
        malformed = true
        continue
      }
      if (key === keyFor(sessionId, record.id)) retained.set(key, record)
    }
  }
  publishQueueEdits(sessionId)
  if (malformed)
    throw new Error("部分排队编辑记录损坏，其他可读取的修改仍然保留。")
  return [...retained.values()]
    .filter((record) => record.sessionId === sessionId)
    .map((record) => structuredClone(record))
}
export function readQueueEdit(sessionId: string, id: string) {
  const record = retained.get(keyFor(sessionId, id))
  return record ? structuredClone(record) : undefined
}
/** Memory is retained before a write so denied/quota writes never discard the editor. */
export function saveQueueEdit(record: QueueEditRecord, persistent = true) {
  const stored = structuredClone({
    ...record,
    draft: copyDraft(record.draft),
    originalDraft: copyDraft(record.originalDraft),
    ...(record.submitted
      ? {
          submitted: {
            ...record.submitted,
            draft: copyDraft(record.submitted.draft),
          },
        }
      : {}),
  })
  const key = keyFor(record.sessionId, record.id)
  retained.set(key, stored)
  publishQueueEdits(record.sessionId)
  if (persistent) localStorage.setItem(key, JSON.stringify(stored))
}
export function clearQueueEdit(
  sessionId: string,
  id: string,
  persistent = true
) {
  const key = keyFor(sessionId, id)
  // A denied remove must remain visible to the owner, rather than resurrect
  // as a supposedly discarded edit after restart.
  if (persistent) localStorage.removeItem(key)
  retained.delete(key)
  publishQueueEdits(sessionId)
}
