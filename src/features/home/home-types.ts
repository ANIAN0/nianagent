import type { ModelPickerCatalog } from "./model-picker"
import type { MaterialReference } from "@/features/models/model-contract.generated"
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
// Display fixtures may omit host fields; RPC preparation supplies the complete
// authority-generated type. UI caches never become another independent DTO.
export type Material = Pick<MaterialReference, "id" | "name" | "kind"> &
  Partial<Omit<MaterialReference, "id" | "name" | "kind">> & {
    /** Client presentation only; host MaterialReference projection excludes it. */
    presentation?: "attachment" | "reference"
    incompatible?: boolean
  }
export type HomeTool = {
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
export type HomeData = {
  materialsEnabled?: boolean
  workspaces: Workspace[]
  conversations: Conversation[]
  models: string[]
  modelLabels?: Record<string, string>
  modelThinking?: Record<string, string[]>
  modelInputs?: Record<string, ("text" | "image")[]>
  modelCatalog?: ModelPickerCatalog
  materials: Material[]
  tools: HomeTool[]
}
export type HomeDraft = {
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
  draft: HomeDraft,
  signal?: AbortSignal,
  originalDraft?: HomeDraft
) => string | HomeSubmitReceipt | Promise<string | HomeSubmitReceipt>
