export type Directory = { id: string; name: string; createdAt: string }
export type PageStatus = "draft" | "confirmed"
/** args 值：基础类型加上受限的嵌套对象与数组（规模由后端收敛）。 */
export type ArgValue =
  string | number | boolean | null | { [key: string]: ArgValue } | ArgValue[]
export type PageMeta = {
  id: string
  directoryId: string
  name: string
  title: string
  status: PageStatus
  createdAt: string
  updatedAt: string
  commentCount: number
  meta: DesignMeta | null
  states: PageState[]
}
export type PageAuthor = "user" | "agent"
export type Comment = {
  id: string
  pageId: string
  target: string
  text: string
  author: PageAuthor
  resolved: boolean
  parentId: string
  createdAt: string
}
export type ArgType = {
  name: string
  label: string
  description: string
  control: "boolean" | "number" | "string" | "select" | "color" | "object"
  min: number | null
  max: number | null
  options: string[]
  default?: ArgValue
}
export type StorySection = "normal" | "exception" | "states"
export type PageState = {
  id: string
  name: string
  section: StorySection
  args: Record<string, ArgValue>
  condition: string
  expected: string
  steps: string[]
  knownIssue: string
}
export type DesignMeta = {
  description: string
  boundary: string
  preview: string
  story: {
    goal: string
    preconditions: string[]
    result: string
  } | null
  standards: {
    id: string
    name: string
    rule: string
    reason: string
    check: string
  }[]
  tags: string[]
  viewport: { width: number; height: number } | null
  argTypes: ArgType[]
  relatedOperations: string[]
}
export type Snapshot = {
  resourceVersion?: number
  dataVersion?: number
  directories: Directory[]
  pages: PageMeta[]
  comments: Comment[]
  health?: { reason: string } | null
}
export type PageDetail = {
  page: PageMeta & { source: string }
  comments: Comment[]
}
