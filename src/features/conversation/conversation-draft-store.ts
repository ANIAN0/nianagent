import type { HomeDraft } from "@/features/home/home-types"
import type { RpcRequests } from "@/features/models/model-contract.generated"

const prefix = "moon.chat.draft.v1."
const requestPrefix = "moon.chat.request.v1."
const homePrefix = "moon.home.draft.v1."
const homeSubmissionPrefix = "moon.home.submission.v1."
export type HomeSubmission = {
  sessionId: string
  cwd?: string
  draft: HomeDraft
  signatures: string[]
}
export type HomeDraftCache = {
  key: number
  workspaceId?: string
  draft?: HomeDraft
}
export type PendingSubmission = {
  signature: string
  id: string
  draft: HomeDraft
} & (
  | {
      kind: "send"
      input: Omit<RpcRequests["conversationSend"], "clientRequestId">
    }
  | {
      kind: "retry"
      input: Omit<RpcRequests["conversationRetry"], "clientRequestId">
    }
)
export function draftSignature(draft: HomeDraft) {
  return JSON.stringify([
    draft.workspaceId,
    draft.text.trim(),
    draft.materials.map((item) => item.id),
    draft.model,
    draft.thinking,
  ])
}
function storedDraft(draft: HomeDraft): HomeDraft {
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
  const drafts: Record<string, HomeDraft> = {}
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
export function saveConversationDraft(id: string, draft: HomeDraft) {
  localStorage.setItem(prefix + id, JSON.stringify(storedDraft(draft)))
}
export function saveConversationRequest(id: string, value?: PendingSubmission) {
  if (value)
    localStorage.setItem(
      requestPrefix + id,
      JSON.stringify({
        ...value,
        draft: storedDraft(value.draft),
        input:
          value.kind === "send"
            ? { ...value.input, materials: storedDraft(value.draft).materials }
            : value.input,
      })
    )
  else localStorage.removeItem(requestPrefix + id)
}
function readHomeDraft(workspaceId: string): Partial<HomeDraft> {
  const value = JSON.parse(
    localStorage.getItem(homePrefix + workspaceId) || "null"
  )
  if (value === null) return {}
  if (typeof value.text !== "string" || !Array.isArray(value.materials))
    throw new Error("无法核对已保存的首页草稿。")
  return value
}
export function restoreHomeDraft(workspaceId: string): Partial<HomeDraft> {
  try {
    return readHomeDraft(workspaceId)
  } catch {
    return {}
  }
}
export function saveHomeDraft(draft: HomeDraft) {
  localStorage.setItem(
    homePrefix + draft.workspaceId,
    JSON.stringify(storedDraft(draft))
  )
}
export function clearHomeDraft(workspaceId: string) {
  localStorage.removeItem(homePrefix + workspaceId)
}
export function homeDraftSignature(draft: HomeDraft) {
  return JSON.stringify([
    draftSignature(draft),
    draft.session.toolIds,
    draft.session.instructionScope,
  ])
}
export function bindHomeDraftIdentity(
  draft: HomeDraft,
  createId: () => string
): HomeDraft {
  return draft.sessionId ? draft : { ...draft, sessionId: createId() }
}
export function createHomeSubmission(
  draft: HomeDraft,
  original = draft
): HomeSubmission {
  if (!draft.sessionId) throw new Error("首页提交缺少会话身份。")
  return {
    sessionId: draft.sessionId,
    draft: storedDraft(draft),
    signatures: [
      ...new Set([homeDraftSignature(draft), homeDraftSignature(original)]),
    ],
  }
}
export function matchesHomeSubmission(
  candidate: Partial<HomeDraft>,
  submission: HomeSubmission
) {
  return (
    typeof candidate.text === "string" &&
    Array.isArray(candidate.materials) &&
    typeof candidate.model === "string" &&
    typeof candidate.thinking === "string" &&
    !!candidate.session &&
    candidate.sessionId === submission.sessionId &&
    submission.signatures.includes(homeDraftSignature(candidate as HomeDraft))
  )
}
export function acceptHomeDraftCache(
  previous: HomeDraftCache,
  submission: HomeSubmission
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
    draft: matches
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
  beforeForget?: () => void
) {
  const current = readHomeDraft(submission.draft.workspaceId)
  const matches = matchesHomeSubmission(current, submission)
  if (matches) {
    try {
      clearHomeDraft(submission.draft.workspaceId)
    } catch {
      // Some storage policies reject removal while allowing a normal update.
      saveHomeDraft({
        ...(current as HomeDraft),
        text: "",
        materials: [],
        sessionId: undefined,
      })
    }
  } else if (current.sessionId === submission.sessionId) {
    // A changed draft belongs to the next homepage session, not the accepted one.
    saveHomeDraft({ ...(current as HomeDraft), sessionId: undefined })
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
