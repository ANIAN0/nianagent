import "./composer.css"

import type { ComposerDraft, Material } from "@/lib/composer/types"

import type { ConversationSubmissionEchoValue } from "../conversation-submission"

import { type FeedbackDescription } from "@/lib/operation-issue"

export type QueueDockProps = {
  pendingSubmission?: Extract<ConversationSubmissionEchoValue, { kind: "send" }>
  pending?: boolean
  unconfirmed?: boolean
  checking?: boolean
  onCheckSubmission?: () => void
  sessionId?: string
  revision?: number
  retiredItems?: {
    id: string
    clientRequestId: string
    status: "delivered" | "removed"
    editBaseRevision?: number
    editRequestId?: string
  }[]
  items: {
    id: string
    draft: ComposerDraft
    status?: "pending" | "dispatching" | "failed"
    error?: string
    delivery?: "followUp" | "steer"
    editBaseRevision?: number
    editRequestId?: string
  }[]
  running: boolean
  stopping?: boolean
  paused?: boolean
  waitingApproval?: boolean
  cwd?: string
  busy?: boolean
  checkPending?: boolean
  issue?: FeedbackDescription
  issues?: Record<string, FeedbackDescription | undefined>
  onCheck?: () => void
  onEdit: (
    id: string,
    text: string,
    materials?: Material[],
    revision?: number,
    clientEditId?: string
  ) => void | Promise<unknown>
  onRemove: (id: string) => void
  onSendNow: (id: string) => void
  /** Resolves only after the destination draft is durable. recoveryKey makes retries idempotent. */
  onRecoverEdit?: (
    text: string,
    materials?: Material[],
    recoveryKey?: string
  ) => void | Promise<unknown>
}
