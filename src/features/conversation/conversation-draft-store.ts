import type { HomeDraft } from "@/features/home/home-types"
import type { RpcRequests } from "@/features/models/model-contract.generated"

const prefix = "moon.chat.draft.v1."
const requestPrefix = "moon.chat.request.v1."
const homePrefix = "moon.home.draft.v1."
export type PendingSubmission = { signature: string; id: string; draft: HomeDraft } & (
  { kind: "send"; input: Omit<RpcRequests["conversationSend"], "clientRequestId"> } |
  { kind: "retry"; input: Omit<RpcRequests["conversationRetry"], "clientRequestId"> }
)
export function draftSignature(draft: HomeDraft) {
  return JSON.stringify([draft.workspaceId, draft.text.trim(), draft.materials.map((item) => item.id), draft.model, draft.thinking])
}
function storedDraft(draft: HomeDraft): HomeDraft {
  return { ...draft, materials: draft.materials.map((item) => {
    const value = { ...item } as typeof item & { thumbnail?: string }
    delete value.thumbnail
    return value
  }) }
}
export function restoreConversationDrafts() {
  const drafts: Record<string, HomeDraft> = {}
  const requests = new Map<string, PendingSubmission>()
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key || (!key.startsWith(prefix) && !key.startsWith(requestPrefix))) continue
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null")
        const draft = key.startsWith(prefix) ? value : value?.draft
        if (!draft || typeof draft.text !== "string" || !Array.isArray(draft.materials) || typeof draft.model !== "string" || typeof draft.thinking !== "string" || !draft.session || !Array.isArray(draft.session.toolIds)) continue
        if (key.startsWith(prefix)) drafts[key.slice(prefix.length)] = draft
        else if (typeof value.id === "string" && typeof value.signature === "string" && ["send", "retry"].includes(value.kind) && value.input?.sessionId === key.slice(requestPrefix.length)) requests.set(key.slice(requestPrefix.length), value)
      } catch { /* One malformed browser record must not hide other drafts. */ }
    }
  } catch { /* Storage errors are exposed on the next explicit write. */ }
  return { drafts, requests }
}
export function saveConversationDraft(id: string, draft: HomeDraft) {
  localStorage.setItem(prefix + id, JSON.stringify(storedDraft(draft)))
}
export function saveConversationRequest(id: string, value?: PendingSubmission) {
  if (value) localStorage.setItem(requestPrefix + id, JSON.stringify({ ...value, draft: storedDraft(value.draft), input: value.kind === "send" ? { ...value.input, materials: storedDraft(value.draft).materials } : value.input }))
  else localStorage.removeItem(requestPrefix + id)
}
export function restoreHomeDraft(workspaceId: string): Partial<HomeDraft> {
  try { const value = JSON.parse(localStorage.getItem(homePrefix + workspaceId) || "null"); return value && typeof value.text === "string" && Array.isArray(value.materials) ? value : {} }
  catch { return {} }
}
export function saveHomeDraft(draft: HomeDraft) {
  localStorage.setItem(homePrefix + draft.workspaceId, JSON.stringify(storedDraft(draft)))
}
export function clearHomeDraft(workspaceId: string) { localStorage.removeItem(homePrefix + workspaceId) }
export const persistentHomeDraftStore = { read: restoreHomeDraft, write: saveHomeDraft }
export type HomeDraftStore = typeof persistentHomeDraftStore
