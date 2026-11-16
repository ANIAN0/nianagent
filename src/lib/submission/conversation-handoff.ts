import type {
  ConversationSnapshot,
  ModelConnection,
  OperationIssue,
} from "@/contracts/rpc.generated"
import type { ComposerDraft } from "@/lib/composer/types"
import type { HomeSubmission } from "./home-draft-rules"

export type HistoryState = "loading" | "ready" | "error"

export type ConversationReceipt = {
  state: "accepted" | "handled" | "rejected" | "unknown"
  snapshot?: ConversationSnapshot
  clientRequestId?: string
  issue?: OperationIssue
}

/** A history read only confirms the original request; another turn is not proof. */
export function inspectConversationReceipt(
  sessionId: string,
  clientRequestId: string | undefined,
  snapshot: ConversationSnapshot
): ConversationReceipt {
  const receipt: ConversationReceipt = {
    state: "unknown",
    snapshot,
    clientRequestId,
  }
  if (snapshot.id !== sessionId || !clientRequestId) return receipt
  if (
    snapshot.queue?.acceptedRequestIds.includes(clientRequestId) ||
    (snapshot.clientRequestId === clientRequestId && snapshot.inputAccepted)
  )
    return { ...receipt, state: "accepted" }
  if (
    snapshot.clientRequestId === clientRequestId &&
    snapshot.inputDisposition === "handled"
  )
    return { ...receipt, state: "handled" }
  // A terminal run (including an older readable history) does not establish
  // rejection of this input. Only the explicit request ledger may do that.
  return receipt
}

export type ConversationHandoffPort = {
  drafts: Record<string, ComposerDraft>
  subscribeInputReceipts: (
    listener: (snapshot: ConversationSnapshot) => void
  ) => () => void
  adoptHomeDraft: (handoff: HomeSubmission, draft: ComposerDraft) => void
  settleHomeReceipt: (id: string, requestId?: string) => void
  currentDraft: (id: string) => ComposerDraft | undefined
  change: (id: string, draft: ComposerDraft) => void
  beginHomeHandoff: (id: string, draft: ComposerDraft) => void
  send: (
    id: string,
    draft: ComposerDraft,
    connections: ModelConnection[],
    signal?: AbortSignal,
    clientRequestId?: string,
    delivery?: "followUp" | "steer",
    preserveFollowing?: boolean,
    onRequestBoundary?: (boundary: "dispatch" | "not-started") => void
  ) => Promise<ConversationSnapshot>
  homeInputReceipt: (
    id: string,
    requestId: string | undefined
  ) => ConversationReceipt | undefined
  inspectReceipt: (
    id: string,
    expected?: string,
    signal?: AbortSignal
  ) => Promise<ConversationReceipt>
  adoptRecoveredDraft: (id: string, draft: ComposerDraft) => void
  endHomeHandoff: (id: string) => void
  submissionDraft: (id: string) => ComposerDraft | undefined
  submissionRequestId: (id: string) => string | undefined
  readStoredDraft: (id: string) => ComposerDraft | undefined
  saveStoredDraft: (id: string, draft: ComposerDraft) => void
}
