import "./home.css"
import { type ReactNode } from "react"

import type {
  ComposerData,
  ComposerDraft,
  HomeSubmitReceipt,
  SubmitWork,
  Workspace,
} from "@/lib/composer/types"
import type {
  HomeDraftStore,
  HomeSubmission,
} from "@/features/conversation/conversation-draft-store"

import { type FeedbackDescription } from "@/lib/operation-issue"
export type HomeComposerProps = {
  /** Retained operation owner: finish existing preparations without new interaction or focus. */
  inactive?: boolean
  onMaterialSelectionActivity?: (sessionId: string, active: boolean) => void
  draftStore?: HomeDraftStore
  unconfirmedSessionIds?: string[]
  acceptedSubmissionIds?: string[]
  recoverySubmissionIds?: string[]
  pendingSubmission?: HomeSubmission
  restoredSubmission?: {
    submission: HomeSubmission
    feedback: FeedbackDescription
  }
  onRestorationPersisted?: (sessionId: string, clientRequestId?: string) => void
  submissionIssue?: FeedbackDescription
  submissionFeedback?: ReactNode
  onSubmissionPrepare?: (
    submission: HomeSubmission,
    following: ComposerDraft
  ) => void
  onCheckSubmission?: (
    sessionId: string,
    signal?: AbortSignal
  ) => Promise<HomeSubmitReceipt | void>
  data: Pick<
    ComposerData,
    | "workspaces"
    | "models"
    | "modelLabels"
    | "modelThinking"
    | "modelInputs"
    | "modelCatalog"
    | "materials"
    | "materialsEnabled"
    | "tools"
  >
  initialDraft?: Partial<ComposerDraft>
  onDraftChange?: (draft: ComposerDraft) => void
  onSubmit: SubmitWork
  onWorkspaceAdd?: (workspace: Workspace) => void
  onChooseWorkspace?: (signal: AbortSignal) => Promise<Workspace | null>
  onWorkspaceSelect?: (id: string, signal?: AbortSignal) => Promise<void>
  workspaceLoading?: boolean
  workspaceError?: string
  workspaceIssue?: FeedbackDescription
  onWorkspaceRetry?: (signal?: AbortSignal) => void | Promise<void>
}
