import type { HomeDraft } from "../home/home-types"

export type MessageAttachment = {
  id: string
  name: string
  kind: "file" | "image"
  url?: string
  content?: string
  bytes?: number
}
export type ConversationToolCall = {
  id: string
  name: string
  source: string
  status: "running" | "success" | "failed" | "stopped" | "not-run"
  input?: string
  result?: string
  exitCode?: number
  durationMs?: number
}
export type ConversationMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  time?: string
  model?: string
  status: "sending" | "streaming" | "settled" | "interrupted" | "failed"
  attachments?: MessageAttachment[]
  thinking?: { text: string; duration?: string }
  tools?: ConversationToolCall[]
  blocks?: ConversationContentBlock[]
}
export type ConversationContentBlock =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "tool"; tool: ConversationToolCall }
  | { id: string; type: "attachments"; attachments: MessageAttachment[] }
export type ConversationQuestion = {
  id: string
  question: string
  header?: string
  detail?: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
}
export type QuestionAnswerDraft = {
  selected: string[]
  custom: string
  skipped: boolean
}
export type QuestionDraft = {
  index: number
  answers: QuestionAnswerDraft[]
  minimized: boolean
}
export type QuestionAnswer = { id: string; selected: string[]; custom?: string }
export type ConversationSession = {
  id: string
  title: string
  workspaceId: string
  messages: ConversationMessage[]
  draft: HomeDraft
  phase: "idle" | "running" | "stopping" | "waiting"
  loadState: "ready" | "loading" | "error"
  error?: string
  connectionMessage?: string
  queue: { id: string; draft: HomeDraft }[]
  questions?: ConversationQuestion[]
  questionDraft?: QuestionDraft
}
