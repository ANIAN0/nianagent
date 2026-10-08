import type { FeedbackDescription } from "@/lib/operation-issue"
import type { MaterialReference } from "@/contracts/rpc.generated"
export type Workspace = {
  id: string
  name: string
  path: string
  available?: boolean
  unavailableReason?: string
}
export type ConversationStatus =
  "idle" | "running" | "stopping" | "waiting" | "completed" | "failed"
export type Conversation = {
  unread?: boolean
  revision?: number
  updatedAt?: string
  cwd?: string
  id: string
  workspaceId: string
  title: string
  updatedLabel?: string
  message?: string
  status?: ConversationStatus
}
// 准备状态是明确的判别字段；展示数据不能放宽正式材料的必需身份。
export type Material = Omit<MaterialReference, "status"> &
  ({ status: "preparing" } | { status: "ready" } | { status: "failed" }) & {
    /** Client presentation only; host MaterialReference projection excludes it. */
    presentation?: "attachment" | "reference"
    incompatible?: boolean
  }
export type ModelPickerCatalog = {
  items: { value: string; name: string; connection: string; modelId: string }[]
  status: "loading" | "ready" | "error"
  error?: string
  issue?: FeedbackDescription
  onRetry: () => void
  onOpenSettings: () => void
}
export type ComposerTool = {
  available?: boolean
  unavailableReason?: string
  id: string
  name: string
  description: string
  group: string
  detail: string
  path?: string
}
export type InstructionScope = "all" | "directory" | "none"
export type SessionOptions = {
  toolIds: string[]
  instructionScope: InstructionScope
}
export type ComposerData = {
  materialsEnabled?: boolean
  workspaces: Workspace[]
  conversations: Conversation[]
  models: string[]
  modelLabels?: Record<string, string>
  modelThinking?: Record<string, string[]>
  modelInputs?: Record<string, ("text" | "image")[]>
  modelCatalog?: ModelPickerCatalog
  materials: Material[]
  tools: ComposerTool[]
}
export type ComposerDraft = {
  sessionId?: string
  /** Client-only receipt marker used for a durable, idempotent Home→conversation handoff. */
  homeTransferId?: string
  /** Client-only guard against merging the same refused submission twice on a storage retry. */
  homeRecoveryKey?: string
  workspaceId: string
  text: string
  command?: { name: string; kind: "extension" }
  model: string
  modelLabel?: string
  thinking: string
  materials: Material[]
  session: SessionOptions
}
export type HomeSubmitReceipt = {
  message?: string
  disposition: "conversation"
}
export type SubmitWork = (
  draft: ComposerDraft,
  signal?: AbortSignal,
  originalDraft?: ComposerDraft
) => string | HomeSubmitReceipt | Promise<string | HomeSubmitReceipt>
