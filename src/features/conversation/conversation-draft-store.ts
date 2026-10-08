import type { ComposerDraft } from "@/lib/composer/types"
import type { RpcRequests } from "@/contracts/rpc.generated"
import type { FeedbackDescription } from "@/lib/operation-issue"
import {
  followingHomeDraft,
  recoverRejectedHomeDraft,
} from "@/features/home/home-submission-draft"
import { hasPreparingHomeMaterials } from "@/features/home/home-submission-lifecycle"

const prefix = "moon.chat.draft.v1."
const requestPrefix = "moon.chat.request.v1."
const homePrefix = "moon.home.draft.v1."
const homeSubmissionPrefix = "moon.home.submission.v1."
export type HomeSubmission = {
  sessionId: string
  /** Recorded before the first await; receipt inspection never guesses a different request. */
  clientRequestId?: string
  /** Recovery phase is persisted before crossing a side-effect boundary. */
  stage?: "prepared" | "sending" | "rejected" | "accepted"
  cwd?: string
  draft: ComposerDraft
  originalDraft?: ComposerDraft
  /** Versioned separation between the immutable copy and the next editable input. */
  followingDraft?: true
  transfer?: { draft: ComposerDraft; signature: string }
  signatures: string[]
}
export type HomeDraftCache = {
  key: number
  workspaceId?: string
  draft?: ComposerDraft
  issue?: FeedbackDescription
}
export type PendingSubmission = {
  signature: string
  id: string
  draft: ComposerDraft
  stage?: "prepared" | "sending" | "accepted" | "rejected"
  /** Written with the original receipt before a model request can begin. */
  followingDraft?: true
} & (
  | {
      kind: "send"
      /** Frozen at submit time so a late response cannot move the echo to another work. */
      placement?: "transcript" | "queued"
      input: Omit<RpcRequests["conversationSend"], "clientRequestId">
    }
  | {
      kind: "retry"
      input: Omit<RpcRequests["conversationRetry"], "clientRequestId">
    }
)
export function draftSignature(draft: ComposerDraft) {
  return JSON.stringify([
    draft.workspaceId,
    draft.text.trim(),
    draft.materials.map((item) => item.id),
    draft.model,
    draft.thinking,
  ])
}
function storedDraft(draft: ComposerDraft): ComposerDraft {
  return {
    ...draft,
    materials: draft.materials.map((item) => {
      const value = { ...item } as typeof item & { thumbnail?: string }
      delete value.thumbnail
      return value
    }),
  }
}
export function restoreConversationDrafts() {
  const drafts: Record<string, ComposerDraft> = {}
  const requests = new Map<string, PendingSubmission>()
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key || (!key.startsWith(prefix) && !key.startsWith(requestPrefix)))
        continue
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null")
        const draft = key.startsWith(prefix) ? value : value?.draft
        if (
          !draft ||
          typeof draft.text !== "string" ||
          !Array.isArray(draft.materials) ||
          typeof draft.model !== "string" ||
          typeof draft.thinking !== "string" ||
          !draft.session ||
          !Array.isArray(draft.session.toolIds)
        )
          continue
        if (key.startsWith(prefix)) drafts[key.slice(prefix.length)] = draft
        else if (
          typeof value.id === "string" &&
          typeof value.signature === "string" &&
          ["send", "retry"].includes(value.kind) &&
          value.input?.sessionId === key.slice(requestPrefix.length)
        )
          requests.set(key.slice(requestPrefix.length), value)
      } catch {
        /* One malformed browser record must not hide other drafts. */
      }
    }
  } catch {
    /* Storage errors are exposed on the next explicit write. */
  }
  return { drafts, requests }
}
export function saveConversationDraft(id: string, draft: ComposerDraft) {
  localStorage.setItem(prefix + id, JSON.stringify(storedDraft(draft)))
}
export function saveConversationRequest(id: string, value?: PendingSubmission) {
  if (value)
    localStorage.setItem(
      requestPrefix + id,
      JSON.stringify({
        ...value,
        draft: storedDraft(value.draft),
        // The RPC payload remains its contract-shaped immutable copy. UI-only
        // thumbnail/ownership fields must never be restored into an RPC request.
        input: value.input,
      })
    )
  else localStorage.removeItem(requestPrefix + id)
}
function readHomeDraft(workspaceId: string): Partial<ComposerDraft> {
  const value = JSON.parse(
    localStorage.getItem(homePrefix + workspaceId) || "null"
  )
  if (value === null) return {}
  if (typeof value.text !== "string" || !Array.isArray(value.materials))
    throw new Error("无法核对已保存的首页草稿。")
  return value
}
export function restoreHomeDraft(workspaceId: string): Partial<ComposerDraft> {
  try {
    return readHomeDraft(workspaceId)
  } catch {
    return {}
  }
}
export function saveHomeDraft(draft: ComposerDraft) {
  localStorage.setItem(
    homePrefix + draft.workspaceId,
    JSON.stringify(storedDraft(draft))
  )
}
export function clearHomeDraft(workspaceId: string) {
  localStorage.removeItem(homePrefix + workspaceId)
}
export function homeDraftSignature(draft: ComposerDraft) {
  return JSON.stringify([
    draftSignature(draft),
    draft.session.toolIds,
    draft.session.instructionScope,
  ])
}
export function bindHomeDraftIdentity(
  draft: ComposerDraft,
  createId: () => string
): ComposerDraft {
  return draft.sessionId ? draft : { ...draft, sessionId: createId() }
}
export function createHomeSubmission(
  draft: ComposerDraft,
  original = draft
): HomeSubmission {
  if (!draft.sessionId) throw new Error("首页提交缺少会话身份。")
  return {
    sessionId: draft.sessionId,
    stage: "prepared",
    clientRequestId: crypto.randomUUID(),
    draft: storedDraft(structuredClone(draft)),
    originalDraft: storedDraft(structuredClone(original)),
    signatures: [
      ...new Set([homeDraftSignature(draft), homeDraftSignature(original)]),
    ],
  }
}
export function matchesHomeSubmission(
  candidate: Partial<ComposerDraft>,
  submission: HomeSubmission
) {
  return (
    typeof candidate.text === "string" &&
    Array.isArray(candidate.materials) &&
    typeof candidate.model === "string" &&
    typeof candidate.thinking === "string" &&
    !!candidate.session &&
    candidate.sessionId === submission.sessionId &&
    submission.signatures.includes(
      homeDraftSignature(candidate as ComposerDraft)
    )
  )
}
export function acceptHomeDraftCache(
  previous: HomeDraftCache,
  submission: HomeSubmission,
  transferred = false
): HomeDraftCache {
  if (!previous.draft) return previous
  const matches = matchesHomeSubmission(previous.draft, submission)
  if (!matches && previous.draft.sessionId !== submission.sessionId)
    return previous
  return {
    ...previous,
    // An already reopened HomeComposer owns its raw draft. Remount it from
    // this accepted cache; changing initialDraft alone cannot update that state.
    key: previous.key + 1,
    issue: undefined,
    draft:
      matches || transferred
        ? { ...previous.draft, text: "", materials: [], sessionId: undefined }
        : { ...previous.draft, sessionId: undefined },
  }
}
export function saveHomeSubmission(submission: HomeSubmission) {
  localStorage.setItem(
    homeSubmissionPrefix + submission.sessionId,
    JSON.stringify(submission)
  )
}
/** No model request may start until both the original copy and next draft are durable. */
export function prepareHomeSubmission(
  submission: HomeSubmission,
  following: ComposerDraft
) {
  saveHomeDraft(submission.originalDraft ?? submission.draft)
  saveHomeSubmission(submission)
  try {
    saveHomeDraft(following)
  } catch (error) {
    // Never discard the only immutable copy if restoring the original also fails.
    saveHomeDraft(submission.originalDraft ?? submission.draft)
    removeHomeSubmission(submission.sessionId)
    throw error
  }
}

export function recoverRejectedHomeSubmission(
  submission: HomeSubmission,
  editing?: ComposerDraft
) {
  const current = editing ?? readHomeDraft(submission.draft.workspaceId)
  const recovery = recoverRejectedHomeDraft(submission, {
    ...followingHomeDraft(submission.draft),
    ...current,
  })
  saveHomeDraft(recovery.draft)
  return recovery
}

/** Freeze one handoff snapshot so cleanup retries cannot duplicate the next message. */
export function recordHomeTransfer(
  submission: HomeSubmission,
  editing?: ComposerDraft
): HomeSubmission {
  if (submission.transfer) {
    if (hasPreparingHomeMaterials(submission.transfer.draft))
      throw new Error("下一条草稿的材料尚未准备完成，不能冻结交接副本。")
    return submission
  }
  // A previous edit may remain only in memory after a local write failure. Never
  // replace it with stale storage or clear Home until that exact source is durable.
  if (editing) saveHomeDraft(editing)
  const current = editing ?? readHomeDraft(submission.draft.workspaceId)
  const draft = matchesHomeSubmission(current, submission)
    ? followingHomeDraft(submission.draft)
    : { ...followingHomeDraft(submission.draft), ...current }
  if (hasPreparingHomeMaterials(draft))
    throw new Error("下一条草稿的材料尚未准备完成，不能冻结交接副本。")
  const updated = {
    ...submission,
    stage: "accepted" as const,
    transfer: { draft, signature: homeDraftSignature(draft) },
  }
  saveHomeSubmission(updated)
  return updated
}
export function restoreHomeSubmissions(): Record<string, HomeSubmission> {
  const submissions: Record<string, HomeSubmission> = {}
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(homeSubmissionPrefix)) continue
      try {
        const value = JSON.parse(
          localStorage.getItem(key) ?? "null"
        ) as HomeSubmission | null
        if (
          value?.sessionId === key.slice(homeSubmissionPrefix.length) &&
          Array.isArray(value.signatures) &&
          value.signatures.every(
            (signature) => typeof signature === "string"
          ) &&
          value.draft?.workspaceId &&
          matchesHomeSubmission(value.draft, value)
        )
          submissions[value.sessionId] = value
      } catch {
        /* One invalid record must not hide another workspace's pending input. */
      }
    }
  } catch {
    /* A write must succeed before a new submission can reach the backend. */
  }
  return submissions
}
export function removeHomeSubmission(sessionId: string) {
  localStorage.removeItem(homeSubmissionPrefix + sessionId)
}
/** Remove the durable submission last, so a failed cleanup can be reconciled after restart. */
export function finishHomeSubmission(
  submission: HomeSubmission,
  beforeForget?: () => void,
  transferred = false
) {
  const current = readHomeDraft(submission.draft.workspaceId)
  const matches = matchesHomeSubmission(current, submission)
  const transferredCurrent =
    transferred &&
    !!submission.transfer &&
    current.sessionId === submission.sessionId &&
    typeof current.text === "string" &&
    Array.isArray(current.materials) &&
    homeDraftSignature(current as ComposerDraft) ===
      submission.transfer.signature
  if (matches || transferredCurrent) {
    try {
      clearHomeDraft(submission.draft.workspaceId)
    } catch {
      // Some storage policies reject removal while allowing a normal update.
      saveHomeDraft({
        ...(current as ComposerDraft),
        text: "",
        materials: [],
        sessionId: undefined,
      })
    }
  } else if (current.sessionId === submission.sessionId) {
    // A changed draft belongs to the next homepage session, not the accepted one.
    saveHomeDraft({ ...(current as ComposerDraft), sessionId: undefined })
  }
  beforeForget?.()
  removeHomeSubmission(submission.sessionId)
  return matches
}
export const persistentHomeDraftStore = {
  read: restoreHomeDraft,
  write: saveHomeDraft,
}
export type HomeDraftStore = typeof persistentHomeDraftStore
