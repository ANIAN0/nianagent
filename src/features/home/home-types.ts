import type { ModelPickerCatalog } from "./model-picker"
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
export type Material = {
  id: string
  name: string
  kind: "附件" | "Skill"
  description?: string
  type?: "file" | "image" | "skill"
  status?: "preparing" | "ready" | "failed"
  source?: string
  mimeType?: string
  bytes?: number
  error?: string
  thumbnail?: string
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
