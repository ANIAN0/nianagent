import { profileLocalStorage as localStorage } from "@/lib/rpc/profile-storage"
import { stripMaterialThumbnails } from "@/lib/composer/material-service-port"
import type { ComposerDraft } from "@/lib/composer/types"
import {
  followingHomeDraft,
  homeDraftSignature,
  recoverRejectedHomeDraft,
  type HomeDraftCache,
  type HomeSubmission,
} from "@/lib/submission/home-draft-rules"
import { hasPreparingHomeMaterials } from "./home-submission-lifecycle"

const homePrefix = "moon.home.draft.v1."
const homeSubmissionPrefix = "moon.home.submission.v1."
const homeSessionKey = "moon.home-session.v1"

export type ConversationDraftPort = {
  readStoredDraft: (id: string) => ComposerDraft | undefined
  saveStoredDraft: (id: string, draft: ComposerDraft) => void
}

export function homeSessionId(cwd: string): string {
  try {
    const stored = JSON.parse(
      localStorage.getItem(homeSessionKey) || "{}"
    ) as Record<string, string>
    if (typeof stored[cwd] === "string") return stored[cwd]
    const id = crypto.randomUUID()
    localStorage.setItem(
      homeSessionKey,
      JSON.stringify({ ...stored, [cwd]: id })
    )
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export function consumeHomeSession(
  cwd: string,
  strict = false,
  expectedSessionId?: string
): void {
  try {
    const stored = JSON.parse(
      localStorage.getItem(homeSessionKey) || "{}"
    ) as Record<string, string>
    if (expectedSessionId && stored[cwd] && stored[cwd] !== expectedSessionId)
      return
    delete stored[cwd]
    localStorage.setItem(homeSessionKey, JSON.stringify(stored))
  } catch (error) {
    if (strict) throw error
    /* Storage can be disabled; active draft identity remains in memory. */
  }
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
    JSON.stringify(stripMaterialThumbnails(draft))
  )
}

export function clearHomeDraft(workspaceId: string) {
  localStorage.removeItem(homePrefix + workspaceId)
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
    draft: stripMaterialThumbnails(structuredClone(draft)),
    originalDraft: stripMaterialThumbnails(structuredClone(original)),
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
  const sessionId = crypto.randomUUID()
  const draft = { ...previous.draft, sessionId }
  delete draft.homeRecoveryKey
  delete draft.homeTransferId
  return {
    ...previous,
    // An already reopened HomeComposer owns its raw draft. Remount it from
    // this accepted cache; changing initialDraft alone cannot update that state.
    key: previous.key + 1,
    issue: undefined,
    sessionId,
    recovery: false,
    draft:
      matches || transferred ? { ...draft, text: "", materials: [] } : draft,
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
  editing?: ComposerDraft,
  conversationDrafts?: ConversationDraftPort
) {
  const home = readHomeDraft(submission.draft.workspaceId)
  const current =
    editing?.sessionId === submission.sessionId
      ? editing
      : home.sessionId === submission.sessionId
        ? home
        : (conversationDrafts?.readStoredDraft(submission.sessionId) ?? {})
  const recovery = recoverRejectedHomeDraft(submission, {
    ...followingHomeDraft(submission.draft),
    ...current,
  })
  conversationDrafts?.saveStoredDraft(submission.sessionId, recovery.draft)
  if (!home.sessionId || home.sessionId === submission.sessionId)
    saveHomeDraft(recovery.draft)
  return recovery
}

/** Freeze one handoff snapshot so cleanup retries cannot duplicate the next message. */
export function recordHomeTransfer(
  submission: HomeSubmission,
  editing?: ComposerDraft,
  conversationDrafts?: ConversationDraftPort
): HomeSubmission {
  if (submission.transfer) {
    if (hasPreparingHomeMaterials(submission.transfer.draft))
      throw new Error("下一条草稿的材料尚未准备完成，不能冻结交接副本。")
    return submission
  }
  // A previous edit may remain only in memory after a local write failure. Never
  // replace it with stale storage or clear Home until that exact source is durable.
  const home = readHomeDraft(submission.draft.workspaceId)
  const current =
    editing?.sessionId === submission.sessionId
      ? editing
      : home.sessionId === submission.sessionId
        ? home
        : (conversationDrafts?.readStoredDraft(submission.sessionId) ?? {})
  if (editing?.sessionId === submission.sessionId) {
    conversationDrafts?.saveStoredDraft(submission.sessionId, editing)
    if (!home.sessionId || home.sessionId === submission.sessionId)
      saveHomeDraft(editing)
  }
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
  clear: clearHomeDraft,
}
export type HomeDraftStore = typeof persistentHomeDraftStore
