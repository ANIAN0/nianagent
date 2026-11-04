import type {
  Comment,
  Directory,
  PageDetail,
  PageMeta,
  PageStatus,
  Snapshot,
} from "./types"

declare global {
  interface Window {
    /** 由插件宿主在页面资源中注入，仅存在于页面内存。 */
    __moonNotesWorkbenchToken?: string
  }
}

/** token 只进本页面会话存储：刷新与资源重载后自动恢复，新标签页仍需一次性票据。 */
const SESSION_KEY = "moon-notes-workbench-token"
const injected = window.__moonNotesWorkbenchToken || ""
try {
  if (injected) sessionStorage.setItem(SESSION_KEY, injected)
  else if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.removeItem(SESSION_KEY)
} catch {
  /* 隐私模式等存储不可用时退回纯内存 token。 */
}
const token =
  injected ||
  (() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) || ""
    } catch {
      return ""
    }
  })()
const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  const value: unknown = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(
      (value as { error?: string }).error || `请求失败（${response.status}）`
    )
  return value as T
}
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) })

export const api = {
  hasToken: () => token.length > 0,
  state: () => request<Snapshot>("/api/state"),
  page: (id: string) =>
    request<PageDetail>(`/api/page?id=${encodeURIComponent(id)}`),
  createDirectory: (name: string) =>
    post<{ directory: Directory }>("/api/directory", { name }),
  createPage: (directoryId: string, name: string) =>
    post<{ page: PageMeta }>("/api/page", { directoryId, name, title: name }),
  setPageStatus: (pageId: string, status: PageStatus) =>
    post<{ page: PageMeta }>("/api/page/status", { pageId, status }),
  setStateArgs: (
    pageId: string,
    stateId: string,
    args: Record<string, string | number | boolean | null>,
  ) => post<{ page: PageMeta }>("/api/page/args", { pageId, stateId, args }),
  setCommentResolved: (commentId: string, resolved: boolean) =>
    post<{ comment: Comment }>("/api/comment/resolve", {
      commentId,
      resolved,
    }),
  deletePage: (pageId: string) =>
    post<{ deleted: string }>("/api/page/delete", { pageId }),
  deleteDirectory: (directoryId: string) =>
    post<{ deleted: string }>("/api/directory/delete", { directoryId }),
  addComment: (pageId: string, target: string, text: string, parentId = "") =>
    post<{ comment: Comment }>("/api/comment", {
      pageId,
      target,
      text,
      parentId,
    }),
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "请求未完成。"
