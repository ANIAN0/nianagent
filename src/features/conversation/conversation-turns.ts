import type {
  ConversationContentBlock,
  ConversationMessage,
} from "./conversation-types"

export interface ProjectedConversationTurn {
  id: string
  user?: ConversationMessage
  messages: ConversationMessage[]
  historyIndex: number
  tail?: ConversationMessage
  response?: string
  continued?: boolean
  /** Same authoritative input/run later produced a complete successful reply. */
  recoveredAttemptIds?: ReadonlySet<string>
}

/** A Pi assistant entry is a step. Only a user input starts a visible turn. */
export function projectConversationTurns(
  messages: readonly ConversationMessage[],
): ProjectedConversationTurn[] {
  const ordered = messages.every(
    (message) => message.historyIndex !== undefined,
  )
    ? [...messages].sort((a, b) => a.historyIndex! - b.historyIndex!)
    : [...messages]
  const turns: ProjectedConversationTurn[] = []
  const continued = new Set(
    ordered.flatMap((message) =>
      message.inputKind === "continuation" && message.continuationOf
        ? [message.continuationOf]
        : [],
    ),
  )
  const byUser = new Map<string, ProjectedConversationTurn>()
  let current: ProjectedConversationTurn | undefined
  ordered.forEach((message, index) => {
    if (message.role === "user") {
      current = {
        id: message.userTurnId || message.id,
        user: message,
        messages: [],
        historyIndex: message.historyIndex ?? index,
      }
      turns.push(current)
      byUser.set(current.id, current)
      byUser.set(message.id, current)
      return
    }
    const turn = message.userTurnId ? byUser.get(message.userTurnId) : current
    if (turn) turn.messages.push(message)
    else {
      current = {
        id: message.userTurnId || `history-${message.id}`,
        messages: [message],
        historyIndex: message.historyIndex ?? index,
      }
      turns.push(current)
      byUser.set(current.id, current)
    }
  })
  return turns.map((turn) => {
    const tail = turn.messages.at(-1)
    const completedRuns = new Set<string>()
    const recoveredAttemptIds = new Set<string>()
    for (let index = turn.messages.length - 1; index >= 0; index -= 1) {
      const message = turn.messages[index]!
      // Legacy/missing identities cannot establish attempt recovery. A later
      // unrelated input, run, or output-limit stop must never erase failure.
      if (!message.runId || message.userTurnId !== turn.id) continue
      if (
        message.status === "settled" &&
        message.stopReason === "stop" &&
        !message.tools?.length &&
        !message.blocks?.some((block) => block.type === "tool")
      )
        completedRuns.add(message.runId)
      else if (
        message.status === "failed" &&
        message.stopReason === "error" &&
        completedRuns.has(message.runId)
      )
        recoveredAttemptIds.add(message.id)
    }
    return {
      ...turn,
      tail,
      response:
        tail && tail.stopReason !== "toolUse" ? messageText(tail) : undefined,
      continued: continued.has(turn.id),
      recoveredAttemptIds,
    }
  })
}

export function messageBlocks(
  message: ConversationMessage,
): ConversationContentBlock[] {
  if (message.blocks?.length) return message.blocks
  // Compatibility is only for existing catalogs/history. New DTO blocks are
  // authoritative and must never prepend the legacy aggregate thinking field.
  return [
    ...(message.thinking?.text
      ? [
          {
            id: `${message.id}:thinking`,
            type: "thinking" as const,
            text: message.thinking.text,
            phase:
              message.status === "streaming" && !message.tools?.length
                ? ("running" as const)
                : ("settled" as const),
          },
        ]
      : []),
    ...(message.tools ?? []).map((tool, index) => ({
      id: tool.occurrenceId || `${message.id}:tool:${index}`,
      type: "tool" as const,
      tool,
    })),
    ...(message.text
      ? [
          {
            id: `${message.id}:text`,
            type: "text" as const,
            text: message.text,
          },
        ]
      : []),
    ...(message.attachments?.length
      ? [
          {
            id: `${message.id}:attachments`,
            type: "attachments" as const,
            attachments: message.attachments,
          },
        ]
      : []),
  ]
}

export function messageText(message: ConversationMessage) {
  return message.blocks?.length
    ? message.blocks
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n\n")
    : message.text
}
