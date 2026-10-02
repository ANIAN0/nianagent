import type { ConversationStatus } from "../home/home-types"
import type { ConversationSession } from "./conversation-types"

export function conversationReadVersion(session: ConversationSession) {
  const last = session.messages.at(-1)
  return last ? `${last.id}:${last.status}:${last.text}` : ""
}

export function conversationStatus(
  session: ConversationSession,
  read: boolean
): ConversationStatus {
  if (session.phase !== "idle") return session.phase
  if (read) return "idle"
  const last = session.messages.at(-1)
  if (last?.role !== "assistant") return "idle"
  if (last.status === "failed") return "failed"
  return last.status === "settled" ? "completed" : "idle"
}
