import type { HomeDraft, Material } from "./home-types"
import {
  homeDraftSignature,
  type HomeSubmission,
} from "@/features/conversation/conversation-draft-store"
import { sameMaterial } from "@/features/materials/material-service"

export type HomeDraftRecovery = { draft: HomeDraft; merged: boolean }

export function homeDraftRecoveryKey(submission: HomeSubmission) {
  return JSON.stringify([
    submission.sessionId,
    homeDraftSignature(submission.originalDraft ?? submission.draft),
  ])
}

function uniqueMaterials(items: Material[]) {
  return items.filter(
    (item, index, all) =>
      all.findIndex((candidate) => sameMaterial(candidate, item)) === index
  )
}

function joinText(first: string, second: string) {
  if (!first.trim()) return second
  if (!second.trim() || first === second) return first
  return `${first}\n\n${second}`
}

export function followingHomeDraft(submitted: HomeDraft): HomeDraft {
  const following = { ...structuredClone(submitted), text: "", materials: [] }
  delete following.homeRecoveryKey
  delete following.homeTransferId
  return following
}

/** A definitive refusal restores the original and preserves anything written meanwhile. */
export function recoverRejectedHomeDraft(
  submission: HomeSubmission,
  following: HomeDraft
): HomeDraftRecovery {
  const original = submission.originalDraft ?? submission.draft
  const recoveryKey = homeDraftRecoveryKey(submission)
  if (following.homeRecoveryKey === recoveryKey)
    return { draft: structuredClone(following), merged: true }
  const sameOriginal =
    homeDraftSignature(following) === homeDraftSignature(original)
  const merged =
    !sameOriginal && !!(following.text.trim() || following.materials.length)
  return {
    merged,
    draft: {
      ...structuredClone(following),
      sessionId: submission.sessionId,
      workspaceId: original.workspaceId,
      homeRecoveryKey: recoveryKey,
      text: sameOriginal
        ? original.text
        : joinText(original.text, following.text),
      materials: uniqueMaterials([
        ...structuredClone(original.materials),
        ...structuredClone(following.materials),
      ]),
    },
  }
}

/** Preserve another conversation draft while adopting this homepage's next message once. */
export function adoptFollowingHomeDraft(
  submission: HomeSubmission,
  following: HomeDraft,
  existing?: HomeDraft
): HomeDraft {
  if (existing?.homeTransferId === submission.sessionId) return existing
  const original = submission.draft
  const existingIsOriginal =
    !!existing && homeDraftSignature(existing) === homeDraftSignature(original)
  const prior = existing && !existingIsOriginal ? existing : undefined
  return {
    ...structuredClone(following),
    sessionId: submission.sessionId,
    homeTransferId: submission.sessionId,
    text: joinText(prior?.text ?? "", following.text),
    materials: uniqueMaterials([
      ...structuredClone(prior?.materials ?? []),
      ...structuredClone(following.materials),
    ]),
  }
}

/** The original cause keeps its product issue; this metadata prevents a second merge. */
export function withHomeDraftRecovery(
  error: unknown,
  recovery: HomeDraftRecovery
) {
  const failure = new Error(
    error instanceof Error ? error.message : "消息未能开始。",
    { cause: error }
  )
  if (error instanceof Error && error.name === "AbortError")
    failure.name = error.name
  if (error && typeof error === "object" && "issue" in error)
    Object.assign(failure, { issue: error.issue })
  return Object.assign(failure, { homeDraftRecovery: recovery })
}

export function homeDraftRecoveryFromError(
  error: unknown
): HomeDraftRecovery | undefined {
  if (!error || typeof error !== "object" || !("homeDraftRecovery" in error))
    return
  const value = error.homeDraftRecovery as HomeDraftRecovery | undefined
  if (
    value?.draft &&
    typeof value.draft.text === "string" &&
    Array.isArray(value.draft.materials)
  )
    return value
}
