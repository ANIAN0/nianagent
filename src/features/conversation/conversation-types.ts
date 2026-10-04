import type { HomeDraft } from "../home/home-types"
import type {
  MaterialReference,
  OperationIssue,
} from "../models/model-contract.generated"

export type MessageAttachment = {
  id: string
  name: string
  kind: "file" | "image"
  url?: string
  content?: string
  bytes?: number
  source?: string
  materialType?: "file" | "image" | "skill"
}
export type ConversationToolCall = {
  id: string
  occurrenceId?: string
  name: string
  source: string
  status: "running" | "success" | "failed" | "stopped" | "not-run"
  input?: string
  result?: string
  exitCode?: number
  durationMs?: number
  target?: {
    kind: "file" | "command"
    path?: string
    requestedPath?: string
    displayPath?: string
    command?: string
    cwd?: string
    line?: number
    lineCount?: number
  }
  resultTruncated?: boolean
  resultLength?: number
  details?: { diff?: string; patch?: string; firstChangedLine?: number }
  presentation?: import("../models/model-contract.generated").ExtensionPresentation
  images?: MaterialReference[]
  artifact?: {
    path: string
    displayPath: string
    operation: "create" | "overwrite" | "write" | "edit"
    materialId?: string
  }
}
export type ConversationMessage = {
  id: string
  userTurnId?: string
  runId?: string
  inputKind?: "continuation"
  continuationOf?: string
  entryId?: string
  historyIndex?: number
  forkable?: boolean
  role: "user" | "assistant"
  text: string
  time?: string
  model?: string
  status: "sending" | "streaming" | "settled" | "interrupted" | "failed"
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted"
  activeBlockId?: string
  issue?: OperationIssue
  attachments?: MessageAttachment[]
  thinking?: { text: string; duration?: string }
  tools?: ConversationToolCall[]
  blocks?: ConversationContentBlock[]
}
export type ConversationContentBlock =
  | { id: string; type: "text"; text: string; phase?: "running" | "settled" }
  | {
      id: string
      type: "thinking"
      text: string
      phase?: "running" | "settled"
    }
  | { id: string; type: "image"; image: MaterialReference }
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
