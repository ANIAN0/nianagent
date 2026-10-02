import type { ModelPickerCatalog } from "./model-picker"
export type Workspace = { id: string; name: string; path: string }
export type ConversationStatus =
  "idle" | "running" | "stopping" | "waiting" | "completed" | "failed"
export type Conversation = {
  id: string
  workspaceId: string
  title: string
  updatedLabel?: string
  message?: string
  status?: ConversationStatus
}
export type Material = {
  id: string
  name: string
  kind: "附件" | "Skill"
  description?: string
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
  workspaces: Workspace[]
  conversations: Conversation[]
  models: string[]
  modelLabels?: Record<string, string>
  modelThinking?: Record<string, string[]>
  modelCatalog?: ModelPickerCatalog
  materials: Material[]
  tools: HomeTool[]
}
export type HomeDraft = {
  sessionId?: string
  workspaceId: string
  text: string
  model: string
  modelLabel?: string
  thinking: string
  materials: Material[]
  session: SessionOptions
}
export type SubmitWork = (
  draft: HomeDraft,
  signal?: AbortSignal
) => string | Promise<string>
