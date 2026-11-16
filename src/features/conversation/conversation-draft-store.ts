import { profileLocalStorage as localStorage } from "@/lib/rpc/profile-storage"
import { stripMaterialThumbnails } from "@/lib/composer/material-service-port"
import type { ComposerDraft } from "@/lib/composer/types"
import type { RpcRequests } from "@/contracts/rpc.generated"

const prefix = "moon.chat.draft.v1."
const requestPrefix = "moon.chat.request.v1."
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
  localStorage.setItem(
    prefix + id,
    JSON.stringify(stripMaterialThumbnails(draft))
  )
}

export function saveConversationRequest(id: string, value?: PendingSubmission) {
  if (value)
    localStorage.setItem(
      requestPrefix + id,
      JSON.stringify({
        ...value,
        draft: stripMaterialThumbnails(value.draft),
        // The RPC payload remains its contract-shaped immutable copy. UI-only
        // thumbnail/ownership fields must never be restored into an RPC request.
        input: value.input,
      })
    )
  else localStorage.removeItem(requestPrefix + id)
}
