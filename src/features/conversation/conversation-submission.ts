import type { HomeDraft } from "@/features/home/home-types"
import { sameMaterial } from "@/features/materials/material-service"
import {
  draftSignature,
  saveConversationDraft,
  saveConversationRequest,
  type PendingSubmission,
} from "./conversation-draft-store"

/** Presentation belongs to the submitted operation, never to the editable next draft. */
export type ConversationSubmissionEchoValue = {
  id: string
  stage?: "prepared" | "sending"
} & (
  | { kind: "send"; draft: HomeDraft; placement?: "transcript" | "queued" }
  | { kind: "retry" }
)

export function conversationSubmissionEcho(
  value?: PendingSubmission
): ConversationSubmissionEchoValue | undefined {
  if (!value || value.stage === "accepted" || value.stage === "rejected")
    return undefined
  const identity = { id: value.id, stage: value.stage }
  return value.kind === "retry"
    ? { ...identity, kind: "retry" }
    : {
        ...identity,
        kind: "send",
        draft: value.draft,
        placement: value.placement,
      }
}

export function followingConversationDraft(original: HomeDraft): HomeDraft {
  return { ...structuredClone(original), text: "", materials: [] }
}

/** The original and following input are durable before crossing the RPC boundary. */
export function prepareConversationSubmission(
  id: string,
  value: PendingSubmission
) {
  const submission = { ...structuredClone(value), stage: "prepared" as const }
  saveConversationRequest(id, submission)
  if (submission.kind === "retry")
    return { submission, draft: submission.draft }
  const draft = followingConversationDraft(submission.draft)
  saveConversationDraft(id, draft)
  submission.followingDraft = true
  saveConversationRequest(id, submission)
  return { submission, draft }
}

export function resolvedConversationDraft(
  id: string,
  submission: PendingSubmission,
  outcome: "accepted" | "rejected",
  editing: HomeDraft = submission.followingDraft
    ? followingConversationDraft(submission.draft)
    : submission.draft
): HomeDraft {
  if (submission.kind === "retry") return editing
  if (outcome === "accepted")
    return !submission.followingDraft &&
      draftSignature(editing) === draftSignature(submission.draft)
      ? followingConversationDraft(editing)
      : editing
  const recoveryKey = JSON.stringify(["chat", id, submission.id])
  if (editing.homeRecoveryKey === recoveryKey) return editing
  const original = submission.draft
  const sameOriginal =
    !submission.followingDraft &&
    draftSignature(editing) === draftSignature(original)
  const text =
    sameOriginal || !editing.text.trim()
      ? original.text
      : !original.text.trim()
        ? editing.text
        : `${original.text}\n\n${editing.text}`
  const materials = [...original.materials, ...editing.materials].filter(
    (item, index, all) =>
      all.findIndex((other) => sameMaterial(item, other)) === index
  )
  return {
    ...editing,
    workspaceId: original.workspaceId,
    text,
    materials,
    homeRecoveryKey: recoveryKey,
  }
}

/** ACK requires this exact current input to survive a restart; keep the receipt on failure. */
export function persistConversationResolution(
  id: string,
  submission: PendingSubmission,
  outcome: "accepted" | "rejected",
  draft: HomeDraft
) {
  saveConversationDraft(id, draft)
  const resolved = { ...submission, stage: outcome }
  saveConversationRequest(id, resolved)
  saveConversationRequest(id)
  return resolved
}
