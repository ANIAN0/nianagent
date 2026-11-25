export type AgentsSnippet = {
  id: string
  name: string
  content: string
  enabled: boolean
  source: "manual" | "plugin"
}

export type AgentsProjectStatus =
  | "synced"
  | "different"
  | "missing"
  | "unavailable"

export type AgentsProjectSummary = {
  id: string
  name: string
  path: string
  source: "workspace" | "custom"
  status: AgentsProjectStatus
  filePath: string
  updatedAt: string
  lineCount: number
  unavailableReason: string
}

export type AgentsMdStatus = {
  revision: number
  baseContent: string
  composedContent: string
  updatedAt: string
  snippets: AgentsSnippet[]
  projects: AgentsProjectSummary[]
}

export type AgentsProjectDetail = {
  id: string
  name: string
  path: string
  filePath: string
  status: AgentsProjectStatus
  exists: boolean
  content: string
  updatedAt: string
  lineCount: number
  diff: string
}

type AgentsReplaceTarget = { path: string; name: string }

export type AgentsReplacePreview = {
  publicationId: string
  targets: Array<AgentsReplaceTarget & { exists: boolean }>
}

export type AgentsReplaceResult = {
  publicationId: string
  state: "previewed" | "finished"
  results: Array<
    AgentsReplaceTarget & {
      outcome:
        | "pending"
        | "created"
        | "replaced"
        | "conflict"
        | "failed"
        | "stopped"
        | "unknown"
      reason: string
    }
  >
}

export type AgentsChooseDirectoryResult = {
  cancelled: boolean
  addedPath: string
  status: AgentsMdStatus
}
