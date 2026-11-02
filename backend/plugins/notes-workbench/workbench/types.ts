export type Directory = { id: string; name: string; createdAt: string }
export type PageStatus = "draft" | "confirmed"
export type PageMeta = {
  id: string
  directoryId: string
  name: string
  title: string
  status: PageStatus
  createdAt: string
  updatedAt: string
  commentCount: number
}
export type PageAuthor = "user" | "agent"
export type Comment = {
  id: string
  pageId: string
  target: string
  text: string
  author: PageAuthor
  createdAt: string
}
export type Snapshot = {
  resourceVersion?: number
  directories: Directory[]
  pages: PageMeta[]
  comments: Comment[]
}
export type PageDetail = {
  page: PageMeta & { source: string }
  comments: Comment[]
}
