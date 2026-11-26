// v2 协作视图 API：宿主通用路由 POST /api/v2/<op>（UI 来源即用户身份 local-user）。
// 写操作必须携带客户端生成的 requestKey（幂等；失败重试不重复提交）。

const previewSidPattern = /^[a-f0-9]{32}$/

export function isNotesPreviewSessionId(sid: unknown): sid is string {
  return typeof sid === "string" && previewSidPattern.test(sid)
}

const request = async <T>(
  operation: string,
  input: object,
  signal?: AbortSignal
): Promise<T> => {
  const response = await fetch(`/api/v2/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
  const value: unknown = await response.json().catch((cause: unknown) => {
    throw new Error(
      `工作台返回了无效数据（HTTP ${response.status}），请检查本机服务后重试。`,
      { cause }
    )
  })
  if (!response.ok)
    throw new Error(
      (value as { error?: string }).error || `请求失败（${response.status}）`
    )
  return value as T
}

/** 客户端请求键：每次待提交操作生成一次并随输入保存，响应丢失后原样重试不重复提交。 */
export const newRequestKey = () => globalThis.crypto.randomUUID()

/** 版本内资源：读取后转换为 blob URL。 */
export const loadAssetUrl = async (
  versionId: string,
  path: string,
  signal?: AbortSignal
): Promise<string> => {
  const response = await fetch(
    `/api/v2/asset?versionId=${encodeURIComponent(versionId)}&path=${encodeURIComponent(path)}`,
    { signal }
  )
  if (!response.ok) throw new Error(`资源读取失败（${response.status}）`)
  return URL.createObjectURL(await response.blob())
}

export type V2Project = { id: string; name: string; archivedAt: string | null }
export type V2Directory = {
  id: string
  projectId: string
  parentId: string | null
  name: string
  archivedAt: string | null
}
export type ConsensusStatus = "discussing" | "pending_confirm" | "agreed"
export type V2Draft = {
  id: string
  kind: string
  title: string
  directoryId: string
  projectId: string
  consensusStatus?: ConsensusStatus
  metadataRevision: number
  reviewRevision: number
  archivedAt: string | null
}
export type V2Page<T> = {
  items: T[]
  complete: boolean
  nextCursor: string | null
}
export type V2Block = {
  index: number
  type: string
  text: string
  html: string
}
export type BoardNode = {
  id: string
  type: "text" | "group"
  x: number
  y: number
  width: number
  height: number
  text: string
  color?: string
}
export type BoardEdge = { id: string; from: string; to: string; label?: string }
export type BoardCanvas = { nodes: BoardNode[]; edges: BoardEdge[] }
export type BoardChange = {
  id: string
  objectType: string
  text: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}
export type BoardDiff = {
  added: BoardChange[]
  removed: BoardChange[]
  contentChanged: BoardChange[]
  connectionChanged: BoardChange[]
  layoutChanged: BoardChange[]
}
export type V2ReadVersion = {
  versionId: string
  sequence: number
  kind: string
  rawMarkdown?: string
  blocks: V2Block[]
  canvas?: BoardCanvas
  manifest?: { routes: Record<string, string> }
  files: string[]
  reviewRevision: number
}
export type V2VersionItem = {
  id: string
  sequence: number
  summary: string | null
  actorId: string
  createdAt: string
}
export type V2Anchor =
  | { kind: "document" }
  | { kind: "unresolved" }
  | { kind: "corrupt" }
  | {
      kind: "markdown"
      block: number
      start: number
      end: number
      quote: string
    }
  | {
      kind: "markdown"
      segments: { block: number; start: number; end: number; quote: string }[]
    }
  | {
      kind: "board"
      objectId: string
      objectType: "node" | "edge" | "group"
      quote: string
    }
  | {
      kind: "ui"
      page: string
      tag: string
      id?: string
      classes?: string
      text?: string
      rect?: Record<string, number>
      viewport?: Record<string, number>
    }
export type V2Thread = {
  id: string
  versionId: string
  authorActor: string
  anchor: V2Anchor
  status: "open" | "resolved"
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  replyCount: number
}
export type V2ThreadFilter = {
  versionId?: string
  status?: string
  authorActor?: string
}
export type V2Reply = {
  id: string
  authorActor: string
  body: string
  relatedVersionId: string | null
  createdAt: string
}
export type V2Compare = {
  left: { versionId: string; sequence: number }
  right: { versionId: string; sequence: number }
  kind: string
  hunks?: {
    type: "same" | "insert" | "delete" | "replace"
    leftStart: number
    leftCount: number
    rightStart: number
    rightCount: number
  }[]
  diff?: BoardDiff
  leftRaw?: string
  rightRaw?: string
}

export const v2Api = {
  syncVersion: async (signal?: AbortSignal): Promise<{ version: number }> => {
    const response = await fetch("/api/sync", {
      signal,
    })
    if (!response.ok)
      throw new Error(`同步基线读取失败（HTTP ${response.status}）。`)
    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== "object" ||
      !("version" in result) ||
      !Number.isSafeInteger(result.version)
    )
      throw new Error("同步基线数据格式无效。")
    return { version: result.version as number }
  },
  waitForChanges: async (
    version: number,
    signal: AbortSignal
  ): Promise<{ version: number }> => {
    const response = await fetch(`/api/sync?version=${version}`, {
      signal,
    })
    if (!response.ok)
      throw new Error(`同步请求失败（HTTP ${response.status}）。`)
    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== "object" ||
      !("version" in result) ||
      !Number.isSafeInteger(result.version)
    )
      throw new Error("工作台同步回执无效。")
    return result as { version: number }
  },
  createProject: (input: { name: string; requestKey: string }) =>
    request("create_project", input),
  createDirectory: (input: {
    projectId: string
    parentId?: string
    name: string
    requestKey: string
  }) => request("create_directory", input),
  listProjects: (
    input: { cursor?: string; archived?: boolean } = {},
    signal?: AbortSignal
  ) =>
    request<V2Page<V2Project>>(
      "list_projects",
      {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.archived ? { archived: true } : {}),
      },
      signal
    ),
  createDraft: (input: {
    directoryId: string
    kind: "markdown" | "board" | "ui"
    title: string
    requestKey: string
  }) =>
    request<{ id: string; kind: string; replayed: boolean }>(
      "create_draft",
      input
    ),
  publishInline: (
    input: {
      draftId: string
      baseSequence: number
      kind: "markdown" | "board"
      markdown?: string
      canvas?: BoardCanvas
      summary?: string
      requestKey: string
    },
    signal?: AbortSignal
  ) =>
    request<{
      versionId: string
      artifactId: string
      sequence: number
      replayed: boolean
      draftId: string
      reviewRevision: number
      projectId: string
      title: string
      openUrl: string
    }>("publish_inline", input, signal),
  updateDraft: (
    input: {
      draftId: string
      title?: string
      directoryId?: string
      archived?: boolean
      consensusStatus?: ConsensusStatus
      metadataRevision?: number
      requestKey: string
    },
    signal?: AbortSignal
  ) =>
    request<{
      id: string
      title: string
      directoryId: string
      consensusStatus?: ConsensusStatus
      archived: boolean
      metadataRevision: number
      replayed: boolean
    }>("update_draft", input, signal),
  deleteDraft: (
    input: { draftId: string; requestKey: string },
    signal?: AbortSignal
  ) =>
    request<{
      draftId: string
      deletedVersions: number
      deletedThreads: number
      replayed: boolean
    }>("delete_draft", input, signal),
  updateProject: (
    input: {
      projectId: string
      name?: string
      archived?: boolean
      requestKey: string
    },
    signal?: AbortSignal
  ) =>
    request<{ id: string; name: string; archived: boolean; replayed: boolean }>(
      "update_project",
      input,
      signal
    ),
  updateDirectory: (
    input: {
      directoryId: string
      parentId?: string | null
      name?: string
      archived?: boolean
      requestKey: string
    },
    signal?: AbortSignal
  ) =>
    request<{
      id: string
      name: string
      parentId: string | null
      archived: boolean
      replayed: boolean
    }>("update_directory", input, signal),
  listDirectories: (
    input: { projectId: string; cursor?: string; archived?: boolean },
    signal?: AbortSignal
  ) =>
    request<V2Page<V2Directory>>(
      "list_directories",
      {
        projectId: input.projectId,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.archived ? { archived: true } : {}),
      },
      signal
    ),
  listDrafts: (
    input: { archived?: boolean; cursor?: string } = {},
    signal?: AbortSignal
  ) => request<V2Page<V2Draft>>("list_drafts", input, signal),
  listVersions: (draftId: string, cursor?: number, signal?: AbortSignal) =>
    request<V2Page<V2VersionItem> & { nextCursor: number | null }>(
      "list_versions",
      { draftId, ...(cursor !== undefined ? { cursor } : {}) },
      signal
    ),
  readVersion: (
    draftId: string,
    versionId: string | undefined,
    signal?: AbortSignal
  ) =>
    request<V2ReadVersion>(
      "read_version",
      { draftId, ...(versionId ? { versionId } : {}) },
      signal
    ),
  listThreads: (
    draftId: string,
    input: V2ThreadFilter & { cursor?: string } = {},
    signal?: AbortSignal
  ) =>
    request<
      V2Page<V2Thread> & { reviewRevision: number; authorActors: string[] }
    >("list_threads", { draftId, ...input }, signal),
  readThread: (threadId: string, replyCursor?: string, signal?: AbortSignal) =>
    request<{ thread: V2Thread; replies: V2Page<V2Reply> }>(
      "read_thread",
      { threadId, ...(replyCursor !== undefined ? { replyCursor } : {}) },
      signal
    ),
  createThread: (
    input: {
      versionId: string
      target: Record<string, unknown>
      body: string
      requestKey: string
    },
    signal?: AbortSignal
  ) =>
    request<{ threadId: string; replyId: string; replayed: boolean }>(
      "create_thread",
      input,
      signal
    ),
  addReply: (
    input: {
      threadId: string
      body: string
      relatedVersionId?: string
      requestKey: string
    },
    signal?: AbortSignal
  ) =>
    request<{ replyId: string; replayed: boolean }>("add_reply", input, signal),
  updateReply: (
    input: { replyId: string; body: string; requestKey: string },
    signal?: AbortSignal
  ) =>
    request<{
      replyId: string
      threadId: string
      body: string
      replayed: boolean
    }>("update_reply", input, signal),
  deleteReply: (
    input: { replyId: string; requestKey: string },
    signal?: AbortSignal
  ) =>
    request<{
      replyId: string
      threadId: string
      threadDeleted: boolean
      replayed: boolean
    }>("delete_reply", input, signal),
  deleteThread: (
    input: { threadId: string; requestKey: string },
    signal?: AbortSignal
  ) =>
    request<{
      threadId: string
      draftId: string
      deletedReplies: number
      replayed: boolean
    }>("delete_thread", input, signal),
  setThreadStatus: (
    threadId: string,
    status: "open" | "resolved",
    requestKey: string,
    signal?: AbortSignal
  ) =>
    request<{
      threadId: string
      status: string
      changed: boolean
      replayed: boolean
    }>("set_thread_status", { threadId, status, requestKey }, signal),
  compare: (
    draftId: string,
    leftVersionId: string,
    rightVersionId: string,
    signal?: AbortSignal
  ) =>
    request<V2Compare>(
      "compare_versions",
      { draftId, leftVersionId, rightVersionId },
      signal
    ),
  openPreview: (versionId: string, signal?: AbortSignal) =>
    request<{ sessionUrl: string; sid: string }>(
      "preview/open",
      { versionId },
      signal
    ),
  /** AC09：释放预览会话（归属校验：sid+versionId）；未知 sid 幂等。 */
  closePreview: (sid: string, versionId: string, signal?: AbortSignal) =>
    request<{ sid: string; released: boolean }>(
      "preview/close",
      { sid, versionId },
      signal
    ),
  /** AC22-二轮：上报运行时元素清单（归属 sid+versionId；宿主缓存供 list_targets 消费）。 */
  previewInventory: (
    input: {
      versionId: string
      sid: string
      page: string
      elements: Record<string, unknown>[]
    },
    signal?: AbortSignal
  ) =>
    request<{ captured: true; page: string; elements: number }>(
      "preview/inventory",
      input,
      signal
    ),
}

export const v2Message = (error: unknown) =>
  error instanceof TypeError && error.message === "Failed to fetch"
    ? "无法连接工作台，请确认 Moon 正在运行后重试。"
    : error instanceof Error
      ? error.message
      : "请求未完成。"
