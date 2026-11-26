"use client"

// 工作台 v2 协作视图（唯一产品入口，Q01/Q02）：
// 项目/目录/草稿导航 → 版本阅读（冻结块投影 + 锚点高亮 + 授权图片）→ 划选评论/整篇评论 →
// 回复与状态 → 版本比较与两版分别评论。未提交评论在切换版本与失败重试时保留。
import { Button } from "@/ui/button"
import { Input } from "@/ui/input"
import { Textarea } from "@/ui/textarea"
import { Badge } from "@/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select"
import {
  MessageSquare,
  ArrowLeft,
  GitCompareArrows,
  PanelLeft,
  Copy,
  FileText,
  Workflow,
  PanelsTopLeft,
  Sun,
  Moon as MoonIcon,
  Pencil,
  Plus,
  Link2,
  Trash2,
  Check,
} from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  loadAssetUrl,
  newRequestKey,
  v2Api,
  v2Message,
  type ConsensusStatus,
  type V2Anchor,
  type V2Block,
  type BoardCanvas,
  type BoardDiff,
  type V2Directory,
  type V2Draft,
  type V2Project,
  type V2Reply,
  type V2Page,
  type V2Thread,
  type V2ThreadFilter,
  type V2VersionItem,
} from "./v2-api"
import {
  kindLabel,
  readerFor,
  type ReaderFocusRequest,
} from "./reader-registry"
import { NavigationSidebar } from "./workspace-sidebar"
import { MarkdownEditor } from "./editors/markdown-editor"
import { BoardEditor } from "./editors/board-editor"
import {
  buildProjectionSpans,
  useMarkdownHighlights,
  markdownReaderStyles,
  pruneStructuralWhitespace,
  projectionOffsetFor,
  renderAssets,
} from "./readers/markdown"
import { BoardReader } from "./readers/board"
import { UiReader } from "./readers/ui"
import { CommentMarkdown } from "./comment-markdown"

const syncLocation = (
  draftId: string,
  versionId: string,
  leftVersionId?: string
) => {
  const params = new URLSearchParams({ draft: draftId, version: versionId })
  if (leftVersionId) params.set("compare", leftVersionId)
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}#v2?${params}`
  )
}

const authorLabel = (actor: string) =>
  actor === "local-user"
    ? "用户"
    : actor === "internal-pi"
      ? "内部 Agent"
      : `Agent ${actor.slice(0, 8)}`

const formatMarkdownLink = (title: string, url: string) =>
  `[${title.replace(/([[\]])/g, "\\$1")}](${url})`

const anchorTitle = (anchor: V2Anchor) => {
  if (anchor.kind === "document") return "整篇评论"
  if (anchor.kind === "unresolved") return "定位不可用"
  if (anchor.kind === "board")
    return `${anchor.objectType === "edge" ? "连线" : anchor.objectType === "group" ? "分组" : "节点"} ${anchor.quote || anchor.objectId.slice(0, 8)}`
  if (anchor.kind === "ui")
    return `${anchor.page} · <${anchor.tag}> ${anchor.text || anchor.id || ""}`
  if (anchor.kind === "corrupt") return "定位快照损坏"
  if ("segments" in anchor)
    return anchor.segments.map((s) => s.quote).join(" … ")
  return anchor.quote
}

/** 待提交评论：body 与 requestKey 绑定保存；切换版本/提交失败不丢弃，重试复用同一 requestKey。 */
type PendingComment = {
  versionId: string
  sequence: number
  target: Record<string, unknown>
  body: string
  requestKey: string
  scope: "reading" | "left" | "right"
}

/** AC18：全量分页收集——导航列表与版本列表必须完整，深链/搜索/选择器不得只看第一页。 */
const collectAll = async <T,>(
  fetchPage: (cursor?: string) => Promise<V2Page<T>>
): Promise<T[]> => {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return items
}

/** AC19：版本列表全量（游标为数字序号）。 */
const collectAllVersions = async (
  draftId: string
): Promise<V2VersionItem[]> => {
  const items: V2VersionItem[] = []
  let cursor: number | undefined
  do {
    const page = await v2Api.listVersions(draftId, cursor)
    items.push(...page.items)
    cursor = typeof page.nextCursor === "number" ? page.nextCursor : undefined
  } while (cursor !== undefined)
  return items
}

type ThreadDetail = {
  replies: V2Reply[]
  complete: boolean
  nextCursor: string | null
}

type CompareSide = {
  versionId: string
  sequence: number
  kind: string
  blocks?: V2Block[]
  canvas?: BoardCanvas
}
type CompareState = { left: CompareSide; right: CompareSide; diff?: BoardDiff }
/** 块级差异行：同/改（成对）/仅左/仅右；成对来自 LCS 空档两侧按序配对（确定性展示，不猜测语义）。 */
type CompareRow = {
  status: "same" | "changed" | "left-only" | "right-only"
  left?: V2Block
  right?: V2Block
}

function blockDiff(left: V2Block[], right: V2Block[]): CompareRow[] {
  const rows: CompareRow[] = []
  const same = (a: V2Block, b: V2Block) =>
    a.type === b.type && a.text === b.text && a.html === b.html
  const lcs: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0)
  )
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      lcs[i][j] = same(left[i], right[j])
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && same(left[i], right[j])) {
      rows.push({ status: "same", left: left[i], right: right[j] })
      i++
      j++
      continue
    }
    const deleteRun: V2Block[] = []
    const insertRun: V2Block[] = []
    while (
      i < left.length &&
      (j >= right.length || lcs[i + 1][j] >= lcs[i][j + 1])
    )
      deleteRun.push(left[i++])
    while (
      j < right.length &&
      (i >= left.length || lcs[i + 1][j] < lcs[i][j + 1])
    )
      insertRun.push(right[j++])
    const paired = Math.min(deleteRun.length, insertRun.length)
    for (let k = 0; k < paired; k++)
      rows.push({ status: "changed", left: deleteRun[k], right: insertRun[k] })
    for (let k = paired; k < deleteRun.length; k++)
      rows.push({ status: "left-only", left: deleteRun[k] })
    for (let k = paired; k < insertRun.length; k++)
      rows.push({ status: "right-only", right: insertRun[k] })
  }
  return rows
}

export function V2Workspace() {
  const [projects, setProjects] = useState<V2Project[]>([])
  const [directories, setDirectories] = useState<V2Directory[]>([])
  const [drafts, setDrafts] = useState<V2Draft[]>([])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<
    "" | "markdown" | "board" | "ui"
  >("")
  const [search, setSearch] = useState("")
  const [versions, setVersions] = useState<V2VersionItem[]>([])
  const [version, setVersion] = useState<{
    versionId: string
    sequence: number
    kind: string
    rawMarkdown?: string
    blocks: V2Block[]
    canvas?: BoardCanvas
    manifest?: { routes: Record<string, string> }
  } | null>(null)
  const [threads, setThreads] = useState<V2Thread[]>([])
  const [threadFilters, setThreadFilters] = useState<V2ThreadFilter>({})
  const [threadAuthors, setThreadAuthors] = useState<string[]>([])
  const threadQuery = useRef<V2ThreadFilter>({})
  const threadQueryRevision = useRef(0)
  const [threadPages, setThreadPages] = useState<{
    complete: boolean
    nextCursor: string | null
  }>({ complete: true, nextCursor: null })
  const [details, setDetails] = useState<Record<string, ThreadDetail>>({})
  const [reviewRevision, setReviewRevision] = useState(0)
  const [compare, setCompare] = useState<CompareState | null>(null)
  const [pending, setPending] = useState<PendingComment | null>(null)
  // AC19：回复草稿携带 requestKey——响应丢失重试复用同键，不重复提交
  const [replyDrafts, setReplyDrafts] = useState<
    Record<string, { body: string; requestKey: string }>
  >({})
  const [archivedDrafts, setArchivedDrafts] = useState<V2Draft[]>([])
  const [compareWith, setCompareWith] = useState<string>("")
  // AC19-二轮：跳转定位目标（白板对象/页面+元素描述）；由 jumpToThread 设置，Reader 消费
  // AC19-七轮：定位请求由父层创建并持有（requestId 身份）；成功/失败/取消均按身份消费，
  // 比较进入、手动换版、换草稿时撤销 pending——阅读器重挂载不会复活已终态请求。
  const [focusRequest, setFocusRequest] = useState<ReaderFocusRequest | null>(
    null
  )
  const [error, setError] = useState("")
  const [copiedReference, setCopiedReference] = useState("")
  const [copiedLink, setCopiedLink] = useState("")
  const [autoNotice, setAutoNotice] = useState("")
  const [selectionConfirm, setSelectionConfirm] = useState<{
    scope: PendingComment["scope"]
    target: Record<string, unknown>
    x: number
    y: number
  } | null>(null)
  const selectionBubbleRef = useRef<HTMLDivElement>(null)
  const autoNoticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const readerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const assetUrlsRef = useRef<string[]>([])
  const navigationRevision = useRef(0)
  const organizationQueryRevision = useRef(0)
  const syncCursor = useRef<number | null>(null)
  useEffect(
    () => () => {
      navigationRevision.current++
      organizationQueryRevision.current++
    },
    []
  )

  const draft =
    [...drafts, ...archivedDrafts].find((item) => item.id === draftId) ?? null
  const draftProject = draft
    ? (projects.find((item) => item.id === draft.projectId) ?? null)
    : null
  const draftDirectory = draft
    ? (directories.find((item) => item.id === draft.directoryId) ?? null)
    : null
  const referenceVersion = compare ? compare.right : version
  const referenceParams =
    draft && referenceVersion
      ? new URLSearchParams({
          draft: draft.id,
          version: referenceVersion.versionId,
          ...(compare ? { compare: compare.left.versionId } : {}),
        })
      : draft
        ? new URLSearchParams({ draft: draft.id })
        : null
  const currentOpenUrl =
    draft && referenceParams
      ? `${window.location.origin}${window.location.pathname}#v2?${referenceParams}`
      : ""
  const markdownLinkText =
    draft && currentOpenUrl
      ? formatMarkdownLink(draft.title, currentOpenUrl)
      : ""
  const referenceText =
    draft && referenceVersion && referenceParams
      ? JSON.stringify(
          {
            projectId: draft.projectId,
            draftId: draft.id,
            title: draft.title,
            versionId: referenceVersion.versionId,
            sequence: referenceVersion.sequence,
            ...(compare ? { compareVersionId: compare.left.versionId } : {}),
            openUrl: currentOpenUrl,
          },
          null,
          2
        )
      : ""
  const flashNotice = useCallback((message: string) => {
    setAutoNotice(message)
    if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current)
    autoNoticeTimer.current = setTimeout(() => setAutoNotice(""), 4000)
  }, [])
  useEffect(
    () => () => {
      if (autoNoticeTimer.current) clearTimeout(autoNoticeTimer.current)
    },
    []
  )
  const [staleNotice, setStaleNotice] = useState(false)
  const [syncIssue, setSyncIssue] = useState("")
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [editingContent, setEditingContent] = useState(false)
  const pendingPublish = useRef<{
    signature: string
    requestKey: string
  } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [createDraftTarget, setCreateDraftTarget] = useState<{
    directoryId: string
    projectId: string
  } | null>(null)
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "dark"
      : "light"
  )
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    document.documentElement.classList.remove("light", "dark")
    document.documentElement.classList.add(next)
    try {
      localStorage.setItem("moon-notes-theme", next)
    } catch {
      /* ignore storage errors */
    }
    setTheme(next)
  }

  const refreshThreads = useCallback(
    async (targetDraftId: string, revision = navigationRevision.current) => {
      const queryRevision = ++threadQueryRevision.current
      const page = await v2Api.listThreads(targetDraftId, threadQuery.current)
      if (
        revision !== navigationRevision.current ||
        queryRevision !== threadQueryRevision.current
      )
        return page.items
      // One owner loads reply details; refreshed rows invalidate their cached text.
      setDetails((previous) => {
        const next = { ...previous }
        for (const item of page.items) delete next[item.id]
        return next
      })
      setThreads(page.items)
      setThreadAuthors(page.authorActors)
      setThreadPages({ complete: page.complete, nextCursor: page.nextCursor })
      setReviewRevision(page.reviewRevision)
      return page.items
    },
    []
  )

  const loadVersion = useCallback(
    async (
      targetDraftId: string,
      versionId?: string,
      revision = ++navigationRevision.current
    ) => {
      setContentLoading(true)
      try {
        const data = await v2Api.readVersion(targetDraftId, versionId)
        if (revision !== navigationRevision.current) return null
        syncLocation(targetDraftId, data.versionId)
        setVersion({
          versionId: data.versionId,
          sequence: data.sequence,
          kind: data.kind,
          rawMarkdown: data.rawMarkdown,
          blocks: data.blocks,
          canvas: data.canvas,
          manifest: data.manifest,
        })
        setStaleNotice(false)
        return data
      } catch (cause) {
        if (revision !== navigationRevision.current) return null
        throw cause
      } finally {
        if (revision === navigationRevision.current) setContentLoading(false)
      }
    },
    []
  )

  const fetchNavigationTree = useCallback(async () => {
    const [projectItems, draftItems, archivedItems] = await Promise.all([
      Promise.all(
        [false, true].map((archived) =>
          collectAll((cursor) => v2Api.listProjects({ cursor, archived }))
        )
      ).then((pages) => pages.flat()),
      collectAll((cursor) => v2Api.listDrafts({ cursor })),
      collectAll((cursor) => v2Api.listDrafts({ cursor, archived: true })),
    ])
    const directoryPages = await Promise.all(
      projectItems.map((project) =>
        Promise.all(
          [false, true].map((archived) =>
            collectAll((cursor) =>
              v2Api.listDirectories({
                projectId: project.id,
                cursor,
                archived,
              })
            )
          )
        ).then((pages) => pages.flat())
      )
    )
    return {
      projects: projectItems,
      drafts: draftItems,
      archivedDrafts: archivedItems,
      directories: directoryPages.flat(),
    }
  }, [])

  // 首次进入：草稿列表 + 深链（openUrl：#v2?draft=&version=&compare=）
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash.replace(/^#v2\??/, "")
    )
    const linkedDraft = params.get("draft")
    const linkedVersion = params.get("version") || undefined
    ;(async () => {
      const organizationRevision = ++organizationQueryRevision.current
      try {
        // 先读取服务端同步基线游标，避免首屏加载完成后长轮询再重复拉取同一份导航数据。
        const baseline = await v2Api.syncVersion().catch(() => null)
        if (baseline) syncCursor.current = baseline.version
        // AC18：项目/草稿/目录全量分页（默认仅未归档）；归档草稿另取一列供恢复浏览与深链解析
        const navigationTree = await fetchNavigationTree()
        if (organizationRevision === organizationQueryRevision.current) {
          setProjects(navigationTree.projects)
          setDrafts(navigationTree.drafts)
          setArchivedDrafts(navigationTree.archivedDrafts)
          setDirectories(navigationTree.directories)
        }
        // 深链精确定位：链接草稿在未归档与归档两列中解析；不存在则显式报错，绝不静默换草稿
        const allDrafts = [
          ...navigationTree.drafts,
          ...navigationTree.archivedDrafts,
        ]
        const linked = linkedDraft
          ? allDrafts.find((item) => item.id === linkedDraft)
          : undefined
        if (linkedDraft && !linked) {
          setError("深链草稿不存在或已删除。")
          setLoading(false)
          return
        }
        // A plain entry opens the workspace home, not an arbitrary stored draft.
        // Explicit links still load their exact version and report missing content.
        const target = linked?.id
        if (!target) {
          setLoading(false)
          return
        }
        setDraftId(target)
        const [versionItems, threadPage] = await Promise.all([
          collectAllVersions(target),
          v2Api.listThreads(target),
        ])
        setVersions(versionItems)
        setThreads(threadPage.items)
        setThreadAuthors(threadPage.authorActors)
        setThreadPages({
          complete: threadPage.complete,
          nextCursor: threadPage.nextCursor,
        })
        setReviewRevision(threadPage.reviewRevision)
        if (versionItems.length > 0)
          await loadVersion(target, linkedVersion ?? versionItems[0]?.id)
        if (linkedVersion && params.get("compare")) {
          const compareResult = await v2Api.compare(
            target,
            params.get("compare")!,
            linkedVersion
          )
          const [leftVersion, rightVersion] = await Promise.all([
            v2Api.readVersion(target, compareResult.left.versionId),
            v2Api.readVersion(target, compareResult.right.versionId),
          ])
          syncLocation(target, linkedVersion, params.get("compare")!)
          setCompare({
            left: {
              versionId: compareResult.left.versionId,
              sequence: compareResult.left.sequence,
              kind: compareResult.kind,
              blocks: leftVersion.blocks,
              canvas: leftVersion.canvas,
            },
            right: {
              versionId: compareResult.right.versionId,
              sequence: compareResult.right.sequence,
              kind: compareResult.kind,
              blocks: rightVersion.blocks,
              canvas: rightVersion.canvas,
            },
            diff: compareResult.diff,
          })
        }
      } catch (err) {
        setError(v2Message(err))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reloadDraft = useCallback(
    async (
      targetDraftId: string,
      versionId?: string,
      comparison?: CompareState | null
    ) => {
      const revision = ++navigationRevision.current
      setError("")
      setContentLoading(true)
      try {
        const [versionItems] = await Promise.all([
          collectAllVersions(targetDraftId),
          refreshThreads(targetDraftId, revision),
        ])
        if (revision !== navigationRevision.current) return
        setVersions(versionItems)
        if (versionItems.length > 0)
          await loadVersion(targetDraftId, versionId, revision)
        else setVersion(null)
        if (comparison && revision === navigationRevision.current)
          syncLocation(
            targetDraftId,
            comparison.right.versionId,
            comparison.left.versionId
          )
        if (revision === navigationRevision.current) setStaleNotice(false)
      } catch (err) {
        if (revision === navigationRevision.current) setError(v2Message(err))
      } finally {
        if (revision === navigationRevision.current) setContentLoading(false)
      }
    },
    [loadVersion, refreshThreads]
  )

  // 线程正文：首屏拉取每条线程的第一页回复
  useEffect(() => {
    const missing = threads.filter((thread) => !details[thread.id])
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await Promise.all(
          missing.map(async (thread) => {
            const detail = await v2Api.readThread(thread.id)
            return [
              thread.id,
              {
                replies: detail.replies.items,
                complete: detail.replies.complete,
                nextCursor: detail.replies.nextCursor,
              },
            ] as const
          })
        )
        if (!cancelled)
          setDetails((prev) => ({ ...prev, ...Object.fromEntries(loaded) }))
      } catch (err) {
        if (!cancelled) setError(v2Message(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [threads]) // eslint-disable-line react-hooks/exhaustive-deps

  // 图片：授权 fetch → blob URL（token 不进入 URL）；阅读区与比较两侧共用
  useEffect(() => {
    const containers = [
      readerRef.current,
      leftRef.current,
      rightRef.current,
    ].filter(Boolean) as HTMLElement[]
    if (containers.length === 0) return
    const images = containers.flatMap((container) =>
      Array.from(
        container.querySelectorAll<HTMLImageElement>("img[data-asset]")
      )
    )
    if (images.length === 0) return
    let cancelled = false
    ;(async () => {
      // 比较模式下图片归属各自侧版本；阅读模式归属当前版本
      const sideOf = (image: HTMLImageElement) =>
        leftRef.current?.contains(image)
          ? compare?.left.versionId
          : rightRef.current?.contains(image)
            ? compare?.right.versionId
            : version?.versionId
      for (const image of images) {
        const path = image.getAttribute("data-asset") ?? ""
        const ownerVersionId = sideOf(image)
        if (!ownerVersionId) continue
        try {
          const url = await loadAssetUrl(ownerVersionId, path)
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          assetUrlsRef.current.push(url)
          image.src = url
          image.removeAttribute("data-asset")
        } catch {
          image.setAttribute("alt", `资源缺失：${path}`)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [version, compare])

  useEffect(
    () => () => {
      for (const url of assetUrlsRef.current.splice(0)) URL.revokeObjectURL(url)
    },
    []
  )

  // AC19-七轮：定位结果按请求身份消费（身份不符/已终态忽略）；失败显式呈现
  const reportFocus = (
    requestId: string,
    outcome: "delivered" | "failed",
    message?: string
  ) => {
    setFocusRequest((prev) => {
      if (!prev || prev.requestId !== requestId || prev.status !== "pending")
        return prev
      if (outcome === "failed" && message) setError(message)
      return { ...prev, status: outcome, message: message ?? prev.message }
    })
  }
  // 取消点：手动换版、换草稿撤销 pending（cancelled 为明确终态）；进入比较的撤销
  // 在 loadCompare 内完成（避免 effect 内同步 setState）

  // 锚点高亮：当前版本线程的持久化快照渲染 <mark>（阅读器内实现）
  const versionThreads = useMemo(
    () => threads.filter((thread) => thread.versionId === version?.versionId),
    [threads, version]
  )

  // 划选评论：从选区反推块与码点范围；跨块生成有序 segments（阅读区与比较两侧共用）
  // 划选评论：从选区经投影 spans 反推块与码点范围；跨块生成有序 segments
  //（阅读区与比较两侧共用；表格块经行/列分隔符映射，不再被排除——AC17-三轮）
  const selectionTarget = (
    container: HTMLElement | null,
    sideBlocks: V2Block[]
  ): Record<string, unknown> | null => {
    const selection = window.getSelection()
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !container
    )
      return null
    if (
      !container.contains(selection.anchorNode) ||
      !container.contains(selection.focusNode)
    )
      return null
    const range = selection.getRangeAt(0)
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>("[data-block]")
    )
    const touched: {
      block: number
      exact: string
      prefix: string
      suffix: string
    }[] = []
    const frozenCps = new Map<number, string[]>()
    for (const element of blocks) {
      if (!range.intersectsNode(element)) continue
      const kind = element.dataset.blockKind ?? "markdown"
      const blockIndex = Number(element.dataset.block)
      const frozen = sideBlocks.find((block) => block.index === blockIndex)
      if (!frozen) return null
      const { spans, text, length } = buildProjectionSpans(element, kind)
      // 投影不变量：重建投影必须与冻结文本逐字一致，不一致显式失败（不猜测）
      if (text !== frozen.text || length !== [...frozen.text].length) {
        setError("该段落内容与冻结投影不一致，无法创建定位评论。")
        return null
      }
      frozenCps.set(blockIndex, [...frozen.text])
      // AC17-四轮：范围与各块求交——端点在本块内取实际偏移，否则取块边界
      //（跨块中间块覆盖全文）；此前以整条 Range 的两端查每块 spans，
      // 跨块时另一端必为 null 而被拒绝。
      const startInside = element.contains(range.startContainer)
      const endInside = element.contains(range.endContainer)
      const startCp = startInside
        ? projectionOffsetFor(spans, range.startContainer, range.startOffset)
        : 0
      const endCp = endInside
        ? projectionOffsetFor(spans, range.endContainer, range.endOffset)
        : length
      if ((startInside && startCp === null) || (endInside && endCp === null)) {
        setError("该段落内容与冻结投影不一致，无法创建定位评论。")
        return null
      }
      const start = Math.min(startCp ?? 0, endCp ?? length)
      const end = Math.max(startCp ?? 0, endCp ?? length)
      if (end <= start) continue
      // 码点单位截取（String.slice 是 UTF-16——emoji 代理对会被截断，AC17-四轮）
      const cps = frozenCps.get(blockIndex) ?? []
      const exact = cps.slice(start, end).join("")
      if (!exact.trim()) continue
      const prefix = cps.slice(Math.max(0, start - 16), start).join("")
      const suffix = cps.slice(end, end + 16).join("")
      touched.push({ block: blockIndex, exact, prefix, suffix })
    }
    if (touched.length === 0) return null
    return touched.length === 1
      ? {
          block: touched[0].block,
          exact: touched[0].exact,
          prefix: touched[0].prefix,
          suffix: touched[0].suffix,
        }
      : { segments: touched }
  }

  const proposeSelectionComment = (scope: PendingComment["scope"]) => {
    const container =
      scope === "reading"
        ? readerRef.current
        : scope === "left"
          ? leftRef.current
          : rightRef.current
    const sideBlocks =
      scope === "left"
        ? (compare?.left.blocks ?? [])
        : scope === "right"
          ? (compare?.right.blocks ?? [])
          : (version?.blocks ?? [])
    const target = selectionTarget(container, sideBlocks)
    if (!target) {
      setSelectionConfirm(null)
      return
    }
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      setSelectionConfirm(null)
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, 72),
      window.innerWidth - 72
    )
    const y = rect.top > 56 ? rect.top - 10 : rect.bottom + 42
    setSelectionConfirm({ scope, target, x, y })
  }

  useEffect(() => {
    if (!selectionConfirm) return
    const onMouseDown = (event: MouseEvent) => {
      if (
        selectionBubbleRef.current &&
        selectionBubbleRef.current.contains(event.target as Node)
      )
        return
      setSelectionConfirm(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectionConfirm(null)
    }
    const onScroll = () => setSelectionConfirm(null)
    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [selectionConfirm])

  const beginComment = (
    scope: PendingComment["scope"],
    overrideTarget?: Record<string, unknown>,
    options?: { versionId?: string }
  ) => {
    const targetVersionId =
      options?.versionId ??
      (scope === "left"
        ? compare?.left.versionId
        : scope === "right"
          ? compare?.right.versionId
          : version?.versionId)
    if (!targetVersionId) return
    const targetSequence =
      scope === "left"
        ? compare?.left.sequence
        : scope === "right"
          ? compare?.right.sequence
          : version?.sequence
    const container =
      scope === "reading"
        ? readerRef.current
        : scope === "left"
          ? leftRef.current
          : rightRef.current
    const sideBlocks =
      scope === "left"
        ? (compare?.left.blocks ?? [])
        : scope === "right"
          ? (compare?.right.blocks ?? [])
          : (version?.blocks ?? [])
    const target = overrideTarget ?? selectionTarget(container, sideBlocks)
    // 无有效选区时静默返回，不打断阅读，也不丢弃已打开的评论输入；整篇评论走显式按钮
    if (!target) return
    // AC19：更换评论目标不丢未提交正文——有输入时先确认
    if (
      pending &&
      pending.body.trim() &&
      (pending.versionId !== targetVersionId ||
        JSON.stringify(pending.target) !== JSON.stringify(target)) &&
      !window.confirm("当前评论尚未提交，更换目标将丢弃输入。确定更换？")
    )
      return
    setError("")
    setPending((prev) =>
      prev &&
      prev.versionId === targetVersionId &&
      JSON.stringify(prev.target) === JSON.stringify(target)
        ? { ...prev, scope }
        : {
            versionId: targetVersionId,
            sequence: targetSequence ?? 0,
            target,
            body: "",
            requestKey: newRequestKey(),
            scope,
          }
    )
  }

  const submitComment = async () => {
    if (!pending || !draftId) return
    const submitted = pending
    const revision = navigationRevision.current
    try {
      await v2Api.createThread({
        versionId: pending.versionId,
        target: pending.target,
        body: pending.body,
        requestKey: pending.requestKey,
      })
      setPending((current) =>
        current?.requestKey === submitted.requestKey ? null : current
      )
      if (revision === navigationRevision.current)
        await reloadDraft(draftId, version?.versionId, compare)
    } catch (err) {
      // 提交失败保留输入与请求键，可原样重试（响应丢失不重复提交）
      setError(v2Message(err))
    }
  }

  const submitReply = async (thread: V2Thread) => {
    const revision = navigationRevision.current
    const draft = replyDrafts[thread.id]
    const body = draft?.body ?? ""
    if (!body.trim()) return
    // AC19：requestKey 随草稿首次输入生成并保留到成功，响应丢失重试同键不重复提交
    const requestKey = draft?.requestKey ?? newRequestKey()
    try {
      await v2Api.addReply({ threadId: thread.id, body, requestKey })
      setReplyDrafts((prev) => {
        if (prev[thread.id]?.requestKey !== requestKey) return prev
        const next = { ...prev }
        delete next[thread.id]
        return next
      })
      const detail = await v2Api.readThread(thread.id)
      if (revision !== navigationRevision.current) return
      setDetails((prev) => ({
        ...prev,
        [thread.id]: {
          replies: detail.replies.items,
          complete: detail.replies.complete,
          nextCursor: detail.replies.nextCursor,
        },
      }))
      if (draftId) await refreshThreads(draftId, revision)
    } catch (err) {
      setError(v2Message(err))
    }
  }

  const toggleStatus = async (thread: V2Thread) => {
    const revision = navigationRevision.current
    try {
      await v2Api.setThreadStatus(
        thread.id,
        thread.status === "open" ? "resolved" : "open",
        newRequestKey()
      )
      if (draftId && revision === navigationRevision.current)
        await refreshThreads(draftId, revision)
    } catch (err) {
      if (revision === navigationRevision.current) setError(v2Message(err))
    }
  }

  const updateReply = async (
    threadId: string,
    replyId: string,
    body: string
  ) => {
    const revision = navigationRevision.current
    try {
      await v2Api.updateReply({
        replyId,
        body,
        requestKey: newRequestKey(),
      })
      const detail = await v2Api.readThread(threadId)
      if (revision !== navigationRevision.current) return
      setDetails((prev) => ({
        ...prev,
        [threadId]: {
          replies: detail.replies.items,
          complete: detail.replies.complete,
          nextCursor: detail.replies.nextCursor,
        },
      }))
      if (draftId) await refreshThreads(draftId, revision)
    } catch (err) {
      if (revision === navigationRevision.current) setError(v2Message(err))
      throw err
    }
  }

  const deleteReply = async (threadId: string, replyId: string) => {
    const revision = navigationRevision.current
    try {
      const result = await v2Api.deleteReply({
        replyId,
        requestKey: newRequestKey(),
      })
      if (revision !== navigationRevision.current) return
      if (result.threadDeleted) {
        setDetails((prev) => {
          const next = { ...prev }
          delete next[threadId]
          return next
        })
      } else {
        const detail = await v2Api.readThread(threadId)
        if (revision !== navigationRevision.current) return
        setDetails((prev) => ({
          ...prev,
          [threadId]: {
            replies: detail.replies.items,
            complete: detail.replies.complete,
            nextCursor: detail.replies.nextCursor,
          },
        }))
      }
      if (draftId) await refreshThreads(draftId, revision)
    } catch (err) {
      if (revision === navigationRevision.current) setError(v2Message(err))
    }
  }

  const deleteThread = async (thread: V2Thread) => {
    const revision = navigationRevision.current
    try {
      await v2Api.deleteThread({
        threadId: thread.id,
        requestKey: newRequestKey(),
      })
      if (revision !== navigationRevision.current) return
      setDetails((prev) => {
        const next = { ...prev }
        delete next[thread.id]
        return next
      })
      if (draftId) await refreshThreads(draftId, revision)
    } catch (err) {
      if (revision === navigationRevision.current) setError(v2Message(err))
    }
  }

  const loadMoreThreads = async () => {
    if (!draftId || threadPages.nextCursor === null) return
    const revision = navigationRevision.current
    const queryRevision = threadQueryRevision.current
    try {
      const page = await v2Api.listThreads(draftId, {
        ...threadQuery.current,
        cursor: threadPages.nextCursor,
      })
      if (
        revision !== navigationRevision.current ||
        queryRevision !== threadQueryRevision.current
      )
        return
      setThreads((prev) => [...prev, ...page.items])
      setThreadPages({ complete: page.complete, nextCursor: page.nextCursor })
    } catch (err) {
      setError(v2Message(err))
    }
  }

  const loadMoreReplies = async (thread: V2Thread) => {
    const current = details[thread.id]
    if (!current || current.nextCursor === null) return
    try {
      const detail = await v2Api.readThread(thread.id, current.nextCursor)
      setDetails((prev) => ({
        ...prev,
        [thread.id]: {
          replies: [...current.replies, ...detail.replies.items],
          complete: detail.replies.complete,
          nextCursor: detail.replies.nextCursor,
        },
      }))
    } catch (err) {
      setError(v2Message(err))
    }
  }

  const reloadNavigation = useCallback(async () => {
    const revision = ++organizationQueryRevision.current
    try {
      const navigationTree = await fetchNavigationTree()
      if (revision !== organizationQueryRevision.current) return
      setProjects(navigationTree.projects)
      setDrafts(navigationTree.drafts)
      setArchivedDrafts(navigationTree.archivedDrafts)
      setDirectories(navigationTree.directories)
    } catch (err) {
      if (revision !== organizationQueryRevision.current) return
      throw err
    }
  }, [fetchNavigationTree])

  const liveStateRef = useRef({
    draftId,
    version,
    versions,
    editingContent,
    compare,
    reviewRevision,
  })
  useEffect(() => {
    liveStateRef.current = {
      draftId,
      version,
      versions,
      editingContent,
      compare,
      reviewRevision,
    }
  })

  // 复用宿主长轮询通知：首屏加载完成后基于服务端基线游标启动；
  // 连接异常由 syncIssue 负责指数退避重连，数据读取错误统一归口到 error，不伪装成断网重试。
  // 阅读最新版时自动无感更新正文、版本与评论；编辑态或查看历史版本时不打断，仅轻提示。
  useEffect(() => {
    if (loading) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryDelay = 2000
    const poll = async () => {
      let result: { version: number }
      try {
        if (syncCursor.current === null) {
          const baseline = await v2Api.syncVersion(controller.signal)
          if (controller.signal.aborted) return
          syncCursor.current = baseline.version
        }
        result = await v2Api.waitForChanges(
          syncCursor.current,
          controller.signal
        )
        if (controller.signal.aborted) return
        setSyncIssue("")
        retryDelay = 2000
      } catch (cause) {
        if (controller.signal.aborted) return
        setSyncIssue(`实时同步已断开：${v2Message(cause)}`)
        const wait = retryDelay
        retryDelay = Math.min(retryDelay * 2, 30000)
        timer = setTimeout(() => void poll(), wait)
        return
      }

      if (result.version !== syncCursor.current) {
        syncCursor.current = result.version
        try {
          await reloadNavigation()
          if (controller.signal.aborted) return
          const snap = liveStateRef.current
          if (snap.draftId) {
            const revision = navigationRevision.current
            const [latestVersions, threadPage] = await Promise.all([
              collectAllVersions(snap.draftId),
              v2Api.listThreads(snap.draftId, threadQuery.current),
            ])
            if (
              controller.signal.aborted ||
              revision !== navigationRevision.current
            )
              return
            setVersions(latestVersions)
            if (threadPage.reviewRevision !== snap.reviewRevision) {
              setDetails((previous) => {
                const next = { ...previous }
                for (const item of threadPage.items) delete next[item.id]
                return next
              })
              setThreads(threadPage.items)
              setThreadAuthors(threadPage.authorActors)
              setThreadPages({
                complete: threadPage.complete,
                nextCursor: threadPage.nextCursor,
              })
              setReviewRevision(threadPage.reviewRevision)
            }
            const newest = latestVersions[0]
            const prevNewest = snap.versions[0]
            const wasViewingLatest =
              !snap.version ||
              !prevNewest ||
              snap.version.versionId === prevNewest.id
            if (newest && newest.id !== snap.version?.versionId) {
              if (!snap.editingContent && !snap.compare && wasViewingLatest) {
                await loadVersion(snap.draftId, newest.id, revision)
                if (
                  !controller.signal.aborted &&
                  revision === navigationRevision.current
                ) {
                  setStaleNotice(false)
                  flashNotice(`已自动更新至 V${newest.sequence}`)
                }
              } else {
                setStaleNotice(true)
              }
            }
          }
        } catch (cause) {
          if (controller.signal.aborted) return
          setError(v2Message(cause))
        }
      }

      if (!controller.signal.aborted) void poll()
    }
    void poll()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [loading, reloadNavigation, loadVersion, flashNotice])

  const patchDraft = useCallback(
    async (
      draftId: string,
      patch: {
        title?: string
        directoryId?: string
        archived?: boolean
        consensusStatus?: ConsensusStatus
        metadataRevision: number
      },
      requestKey: string
    ) => {
      setError("")
      try {
        await v2Api.updateDraft({ draftId, requestKey, ...patch })
        await reloadNavigation()
        return true
      } catch (err) {
        setError(v2Message(err))
        return false
      }
    },
    [reloadNavigation]
  )

  const copyDraftLink = useCallback(
    async (targetDraft: V2Draft) => {
      const url = `${window.location.origin}${window.location.pathname}#v2?draft=${encodeURIComponent(targetDraft.id)}`
      const text = formatMarkdownLink(targetDraft.title, url)
      try {
        await navigator.clipboard.writeText(text)
        flashNotice(`已复制链接：${targetDraft.title}`)
      } catch {
        setError("无法写入剪贴板，请允许浏览器访问剪贴板后重试。")
      }
    },
    [flashNotice]
  )

  const saveInlineVersion = useCallback(
    async (payload: {
      markdown?: string
      canvas?: BoardCanvas
      summary: string
    }) => {
      if (!draft || (draft.kind !== "markdown" && draft.kind !== "board"))
        return
      const revision = navigationRevision.current
      const input = {
        draftId: draft.id,
        baseSequence: version?.sequence ?? 0,
        kind: draft.kind,
        ...(payload.markdown !== undefined
          ? { markdown: payload.markdown }
          : {}),
        ...(payload.canvas !== undefined ? { canvas: payload.canvas } : {}),
        ...(payload.summary ? { summary: payload.summary } : {}),
      }
      const signature = JSON.stringify(input)
      const requestKey =
        pendingPublish.current?.signature === signature
          ? pendingPublish.current.requestKey
          : newRequestKey()
      pendingPublish.current = { signature, requestKey }
      setPublishing(true)
      setError("")
      try {
        const result = await v2Api.publishInline({
          ...input,
          kind: draft.kind,
          requestKey,
        })
        if (revision !== navigationRevision.current) return
        pendingPublish.current = null
        setEditingContent(false)
        const versionItems = await collectAllVersions(draft.id)
        if (revision !== navigationRevision.current) return
        setVersions(versionItems)
        await loadVersion(draft.id, result.versionId, revision)
      } catch (err) {
        if (revision === navigationRevision.current) setError(v2Message(err))
      } finally {
        setPublishing(false)
      }
    },
    [draft, version, loadVersion]
  )

  const selectDraft = useCallback(
    (next: string | null) => {
      // AC19：切换草稿不丢未提交正文——有输入先确认
      if (
        pending?.body.trim() &&
        !window.confirm("当前评论尚未提交，切换草稿将丢弃输入。确定切换？")
      )
        return
      navigationRevision.current++
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}#v2${next ? `?draft=${encodeURIComponent(next)}` : ""}`
      )
      setError("")
      setStaleNotice(false)
      setContentLoading(false)
      setNavigationOpen(false)
      setEditingContent(false)
      setDraftId(next)
      threadQuery.current = {}
      threadQueryRevision.current++
      setThreadFilters({})
      setThreadAuthors([])
      setThreads([])
      setDetails({})
      setVersions([])
      setThreadPages({ complete: true, nextCursor: null })
      setVersion(null)
      setCompare(null)
      setPending(null)
      setSelectionConfirm(null)
      setCompareWith("")
      setFocusRequest(null)
      if (next) void reloadDraft(next)
    },
    [pending, reloadDraft]
  )

  const deleteDraft = useCallback(
    async (targetDraftId: string, requestKey: string) => {
      setError("")
      try {
        await v2Api.deleteDraft({ draftId: targetDraftId, requestKey })
        if (draftId === targetDraftId) selectDraft(null)
        await reloadNavigation()
        flashNotice("草稿已永久删除")
        return true
      } catch (err) {
        setError(v2Message(err))
        return false
      }
    },
    [draftId, selectDraft, reloadNavigation, flashNotice]
  )

  const loadCompare = async (leftVersionId: string, rightVersionId: string) => {
    if (!draftId) return
    const revision = ++navigationRevision.current
    setContentLoading(true)
    threadQuery.current = {}
    setThreadFilters({})
    try {
      setError("")
      // AC19-七轮：进入比较撤销 pending 定位请求（cancelled 为明确终态，返回阅读不复活）
      setFocusRequest((prev) =>
        prev && prev.status === "pending"
          ? {
              ...prev,
              status: "cancelled",
              message: "进入比较，定位请求已撤销。",
            }
          : prev
      )
      const [result, leftVersion, rightVersion] = await Promise.all([
        v2Api.compare(draftId, leftVersionId, rightVersionId),
        v2Api.readVersion(draftId, leftVersionId),
        v2Api.readVersion(draftId, rightVersionId),
        refreshThreads(draftId, revision),
      ])
      if (revision !== navigationRevision.current) return
      syncLocation(draftId, rightVersionId, leftVersionId)
      setCompare({
        left: {
          versionId: result.left.versionId,
          sequence: result.left.sequence,
          kind: result.kind,
          blocks: leftVersion.blocks,
          canvas: leftVersion.canvas,
        },
        right: {
          versionId: result.right.versionId,
          sequence: result.right.sequence,
          kind: result.kind,
          blocks: rightVersion.blocks,
          canvas: rightVersion.canvas,
        },
        diff: result.diff,
      })
    } catch (err) {
      if (revision === navigationRevision.current) setError(v2Message(err))
    } finally {
      if (revision === navigationRevision.current) setContentLoading(false)
    }
  }

  const jumpToThread = async (thread: V2Thread) => {
    const revision = ++navigationRevision.current
    setFocusRequest(null)
    setError("")
    try {
      // AC19：三种不可跳转语义显式提示（unresolved 未配置 / corrupt 损坏），不静默
      if (thread.anchor.kind === "unresolved") {
        setError("该评论没有定位信息，无法跳转。")
        return
      }
      if (thread.anchor.kind === "corrupt") {
        setError("该评论的定位快照已损坏，无法跳转；请维护者检查数据。")
        return
      }
      setCompare(null)
      // AC19-三轮：跨版本校验使用新加载的版本数据（旧 state 在 await 后已过期）
      const anchor = thread.anchor
      const current =
        thread.versionId === version?.versionId
          ? version
          : draftId
            ? await loadVersion(draftId, thread.versionId, revision)
            : null
      if (!current || revision !== navigationRevision.current) return
      if (anchor.kind === "board") {
        // AC19-二轮：白板对象视口定位——先识别对象是否存在，不存在显式呈现
        const canvas = current.canvas
        if (!canvas) return
        const exists =
          canvas.nodes.some((item) => item.id === anchor.objectId) ||
          canvas.edges.some((item) => item.id === anchor.objectId)
        if (!exists) {
          setError("定位对象在该版本画布中不存在，无法定位。")
          return
        }
        setFocusRequest({
          requestId: newRequestKey(),
          versionId: thread.versionId,
          status: "pending",
          target: { objectId: anchor.objectId },
        })
        return
      }
      if (anchor.kind === "ui") {
        // AC19-二轮：UI 元素定位——页面必须在版本路由清单内，缺失显式不可定位
        const routes = current.manifest?.routes ?? {}
        if (anchor.page && !routes[anchor.page]) {
          setError(`目标页面 ${anchor.page} 不在该版本路由清单中，无法定位。`)
          return
        }
        setFocusRequest({
          requestId: newRequestKey(),
          versionId: thread.versionId,
          status: "pending",
          target: {
            page: anchor.page,
            tag: anchor.tag,
            id: anchor.id,
            text: anchor.text,
          },
        })
        return
      }
      const firstBlock =
        anchor.kind === "markdown"
          ? "block" in anchor
            ? anchor.block
            : anchor.segments[0]?.block
          : null
      if (firstBlock !== null && firstBlock !== undefined) {
        requestAnimationFrame(() => {
          if (revision !== navigationRevision.current) return
          readerRef.current
            ?.querySelector(`[data-block="${firstBlock}"]`)
            ?.scrollIntoView({ block: "center" })
        })
      }
    } catch (err) {
      if (revision === navigationRevision.current) setError(v2Message(err))
    }
  }

  if (loading)
    return <p className="p-6 text-sm text-muted-foreground">加载中…</p>

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-card text-foreground lg:flex-row">
      <div className="border-b px-3 py-2 lg:hidden">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={navigationOpen}
          aria-controls="workbench-navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <PanelLeft />
          项目与草稿
        </Button>
      </div>
      <div
        id="workbench-navigation"
        className={`${navigationOpen ? "flex" : "hidden"} max-h-[40vh] shrink-0 lg:flex lg:max-h-none`}
      >
        <NavigationSidebar
          projects={projects}
          directories={directories}
          drafts={drafts}
          archivedDrafts={archivedDrafts}
          draftId={draftId}
          kindFilter={kindFilter}
          search={search}
          onKindFilter={setKindFilter}
          onSearch={setSearch}
          onSelectDraft={selectDraft}
          onPatchDraft={patchDraft}
          onDeleteDraft={deleteDraft}
          onCopyDraftLink={copyDraftLink}
          onRefresh={reloadNavigation}
          onCreateDraft={(directoryId, projectId) =>
            setCreateDraftTarget({ directoryId, projectId })
          }
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <header className="flex min-h-14 flex-wrap items-center gap-2 border-b bg-card px-5 py-2.5">
          <div className="mr-auto flex max-w-md min-w-0 flex-col">
            {draft && (draftProject || draftDirectory) && (
              <span className="truncate text-[11px] leading-tight text-muted-foreground">
                {[draftProject?.name, draftDirectory?.name]
                  .filter(Boolean)
                  .join(" / ")}
              </span>
            )}
            <strong className="truncate text-base leading-tight font-semibold">
              {draft ? draft.title : "工作台"}
            </strong>
          </div>
          {draft && !compare && !editingContent && (
            <Select
              value={draft.consensusStatus ?? "discussing"}
              onValueChange={(nextStatus) => {
                void patchDraft(
                  draft.id,
                  {
                    consensusStatus: nextStatus as ConsensusStatus,
                    metadataRevision: draft.metadataRevision,
                  },
                  newRequestKey()
                )
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="共识状态"
                className="min-w-28"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discussing">讨论中</SelectItem>
                <SelectItem value="pending_confirm">待确认</SelectItem>
                <SelectItem value="agreed">已达成共识</SelectItem>
              </SelectContent>
            </Select>
          )}
          {draft &&
            (draft.kind === "markdown" || draft.kind === "board") &&
            !compare &&
            !contentLoading &&
            !editingContent && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingContent(true)}
              >
                <Pencil data-icon="inline-start" />
                {version ? "编辑" : "开始编写"}
              </Button>
            )}
          {draft && version && !compare && !editingContent && (
            <Select
              value={version.versionId}
              onValueChange={(nextVersionId) => {
                setCompare(null)
                setFocusRequest((prev) =>
                  prev && prev.status === "pending"
                    ? {
                        ...prev,
                        status: "cancelled",
                        message: "手动切换版本，定位请求已撤销。",
                      }
                    : prev
                )
                if (draftId)
                  void loadVersion(draftId, nextVersionId).catch((err) =>
                    setError(v2Message(err))
                  )
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="当前版本"
                className="min-w-28"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    V{item.sequence}
                    {item.summary ? ` · ${item.summary}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {draft &&
            version &&
            versions.length >= 2 &&
            !compare &&
            !editingContent && (
              <>
                <Select
                  value={compareWith || "__none__"}
                  onValueChange={(target) => {
                    const nextTarget = target === "__none__" ? "" : target
                    setCompareWith(nextTarget)
                    if (nextTarget)
                      void loadCompare(nextTarget, version.versionId)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="比较版本"
                    className="min-w-28"
                  >
                    <SelectValue placeholder="对比版本…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">对比版本…</SelectItem>
                    {versions
                      .filter((item) => item.id !== version.versionId)
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          V{item.sequence}
                          {item.summary ? ` · ${item.summary}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void loadCompare(versions[1].id, versions[0].id)
                  }
                >
                  <GitCompareArrows data-icon="inline-start" />
                  比较最近两版
                </Button>
              </>
            )}
          {compare && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCompare(null)
                if (draftId && version) syncLocation(draftId, version.versionId)
              }}
            >
              <ArrowLeft data-icon="inline-start" />
              返回阅读
            </Button>
          )}
          {draft && version && !compare && !editingContent && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => beginComment("reading", { kind: "document" })}
            >
              <MessageSquare data-icon="inline-start" />
              整篇评论
            </Button>
          )}
          {markdownLinkText && (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const revision = navigationRevision.current
                try {
                  await navigator.clipboard.writeText(markdownLinkText)
                  if (revision === navigationRevision.current) {
                    setCopiedLink(markdownLinkText)
                    flashNotice(`已复制链接：${draft?.title ?? ""}`)
                  }
                } catch {
                  if (revision === navigationRevision.current)
                    setError("无法写入剪贴板，请允许浏览器访问剪贴板后重试。")
                }
              }}
            >
              {copiedLink === markdownLinkText ? (
                <Check data-icon="inline-start" />
              ) : (
                <Link2 data-icon="inline-start" />
              )}
              {copiedLink === markdownLinkText ? "已复制链接" : "复制链接"}
            </Button>
          )}
          {referenceText && (
            <Button
              variant="ghost"
              size="sm"
              title="复制供 Agent 使用的结构化引用 JSON"
              onClick={async () => {
                const revision = navigationRevision.current
                try {
                  await navigator.clipboard.writeText(referenceText)
                  if (revision === navigationRevision.current)
                    setCopiedReference(referenceText)
                } catch {
                  if (revision === navigationRevision.current)
                    setError("无法写入剪贴板，请允许浏览器访问剪贴板后重试。")
                }
              }}
            >
              <Copy data-icon="inline-start" />
              {copiedReference === referenceText ? "已复制引用" : "复制引用"}
            </Button>
          )}
          {contentLoading && (
            <span role="status" className="text-xs text-muted-foreground">
              正在读取…
            </span>
          )}
          {autoNotice && (
            <span
              role="status"
              className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400"
            >
              {autoNotice}
            </span>
          )}
          {staleNotice && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                draftId && void reloadDraft(draftId, undefined, compare)
              }
            >
              有新版本，点击刷新
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            title={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <MoonIcon />}
          </Button>
        </header>
        {syncIssue && (
          <p
            role="status"
            className="border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300"
          >
            {syncIssue}；连接恢复后自动同步。
          </p>
        )}
        {error && (
          <div className="flex items-center justify-between border-b bg-destructive/10 px-4 py-1.5 text-sm text-destructive">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError("")}>
              关闭
            </Button>
          </div>
        )}
        {!draft ? (
          <section
            className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-16 text-center"
            aria-label="工作台首页"
          >
            <div
              className="flex items-center gap-6 text-primary"
              aria-hidden="true"
            >
              <FileText className="size-7" />
              <Workflow className="size-7" />
              <PanelsTopLeft className="size-7" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              选择一份草稿，开始审阅
            </h1>
            <p className="max-w-md text-sm leading-7 text-muted-foreground">
              从左侧打开文档、白板或界面。还没有内容？新建项目，让 Agent
              发布准备好的产物。
            </p>
          </section>
        ) : editingContent &&
          draft &&
          (draft.kind === "markdown" || draft.kind === "board") ? (
          draft.kind === "markdown" ? (
            <MarkdownEditor
              key={version?.versionId ?? "empty-md"}
              initialMarkdown={
                version?.rawMarkdown ??
                version?.blocks.map((block) => block.text).join("\n\n") ??
                `# ${draft.title}\n\n`
              }
              saving={publishing}
              onSave={(markdown, summary) =>
                saveInlineVersion({ markdown, summary })
              }
              onCancel={() => setEditingContent(false)}
            />
          ) : (
            <BoardEditor
              key={version?.versionId ?? "empty-board"}
              initialCanvas={
                version?.canvas ?? {
                  nodes: [
                    {
                      id: `node-${crypto.randomUUID().slice(0, 8)}`,
                      type: "text",
                      x: 120,
                      y: 120,
                      width: 240,
                      height: 100,
                      text: draft.title,
                    },
                  ],
                  edges: [],
                }
              }
              saving={publishing}
              onSave={(canvas, summary) =>
                saveInlineVersion({ canvas, summary })
              }
              onCancel={() => setEditingContent(false)}
            />
          )
        ) : compare ? (
          <CompareView
            compare={compare}
            versions={versions}
            rows={
              compare.left.kind === "markdown"
                ? blockDiff(
                    compare.left.blocks ?? [],
                    compare.right.blocks ?? []
                  )
                : []
            }
            leftThreads={threads.filter(
              (thread) => thread.versionId === compare.left.versionId
            )}
            rightThreads={threads.filter(
              (thread) => thread.versionId === compare.right.versionId
            )}
            details={details}
            replyDrafts={replyDrafts}
            leftRef={leftRef}
            rightRef={rightRef}
            onSelect={(scope) => proposeSelectionComment(scope)}
            onCommentDocument={(scope) =>
              beginComment(scope, { kind: "document" })
            }
            onTargetSelect={(scope, target) =>
              beginComment(scope, target, {
                versionId:
                  scope === "left"
                    ? compare.left.versionId
                    : compare.right.versionId,
              })
            }
            onPendingBody={(body) =>
              setPending((prev) =>
                prev
                  ? {
                      ...prev,
                      body,
                      requestKey:
                        prev.body === body ? prev.requestKey : newRequestKey(),
                    }
                  : prev
              )
            }
            onSubmit={submitComment}
            onCancel={() => setPending(null)}
            onReplyDraft={(threadId, body) =>
              setReplyDrafts((prev) => ({
                ...prev,
                // 修改正文代表新请求；原文未变的失败重试沿用原键。
                [threadId]: {
                  body,
                  requestKey:
                    prev[threadId]?.body === body
                      ? prev[threadId].requestKey
                      : newRequestKey(),
                },
              }))
            }
            onReply={submitReply}
            onUpdateReply={updateReply}
            onDeleteReply={deleteReply}
            onDeleteThread={deleteThread}
            onToggle={toggleStatus}
            onJump={jumpToThread}
            pending={pending}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {(() => {
              const Reader = readerFor(draft.kind)
              if (!version)
                return (
                  <div
                    role="status"
                    className="flex flex-1 flex-col items-start gap-3 p-6 text-sm text-muted-foreground"
                  >
                    <p>
                      {contentLoading
                        ? "正在读取版本…"
                        : versions.length
                          ? "版本尚未加载成功。请根据错误提示处理后重新打开。"
                          : "该草稿尚无版本。可直接开始编写，或让 Agent 发布版本。"}
                    </p>
                    {!contentLoading &&
                      versions.length === 0 &&
                      (draft.kind === "markdown" || draft.kind === "board") && (
                        <Button
                          size="sm"
                          onClick={() => setEditingContent(true)}
                        >
                          <Plus data-icon="inline-start" />
                          立即编写首个版本
                        </Button>
                      )}
                  </div>
                )
              if (!Reader)
                return (
                  <p className="flex-1 p-6 text-sm text-muted-foreground">
                    {kindLabel(draft.kind)}阅读器未接入。
                  </p>
                )
              return (
                <Reader
                  version={version}
                  threads={versionThreads}
                  containerRef={readerRef}
                  onSelect={() => proposeSelectionComment("reading")}
                  // AC01：普通阅读模式的白板节点/边与 UI 元素评论接线——目标绑定当前阅读
                  // 版本身份（beginComment 在点击时刻取 version?.versionId 固化到 pending）
                  onTargetSelect={(target) => beginComment("reading", target)}
                  focusRequest={focusRequest}
                  onReport={reportFocus}
                />
              )
            })()}
            <ThreadPanel
              filters={threadFilters}
              authors={threadAuthors}
              onFilters={(filters) => {
                threadQuery.current = filters
                setThreadFilters(filters)
                if (draftId)
                  void refreshThreads(draftId).catch((cause) =>
                    setError(v2Message(cause))
                  )
              }}
              threads={threads}
              details={details}
              versions={versions}
              replyDrafts={replyDrafts}
              pages={threadPages}
              onReplyDraft={(threadId, body) =>
                setReplyDrafts((prev) => ({
                  ...prev,
                  // 修改正文代表新请求；原文未变的失败重试沿用原键。
                  [threadId]: {
                    body,
                    requestKey:
                      prev[threadId]?.body === body
                        ? prev[threadId].requestKey
                        : newRequestKey(),
                  },
                }))
              }
              onReply={submitReply}
              onUpdateReply={updateReply}
              onDeleteReply={deleteReply}
              onDeleteThread={deleteThread}
              onToggle={toggleStatus}
              onJump={jumpToThread}
              onLoadMore={loadMoreThreads}
              onLoadReplies={loadMoreReplies}
            />
          </div>
        )}
        {selectionConfirm && (
          <div
            ref={selectionBubbleRef}
            role="toolbar"
            aria-label="划词操作"
            className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg"
            style={{ left: selectionConfirm.x, top: selectionConfirm.y }}
          >
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-7 px-2.5 text-xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const picked = selectionConfirm
                setSelectionConfirm(null)
                beginComment(picked.scope, picked.target)
              }}
            >
              <MessageSquare className="size-3.5" />
              添加评论
            </Button>
          </div>
        )}
        {pending && !compare && (
          <CommentComposer
            title={
              pending.target.kind === "document"
                ? `整篇评论 · V${pending.sequence}`
                : `定位评论 · V${pending.sequence}`
            }
            pending={pending}
            onBody={(body) =>
              setPending((prev) =>
                prev
                  ? {
                      ...prev,
                      body,
                      requestKey:
                        prev.body === body ? prev.requestKey : newRequestKey(),
                    }
                  : prev
              )
            }
            onSubmit={submitComment}
            onCancel={() => setPending(null)}
          />
        )}
        {createDraftTarget && (
          <CreateDraftDialog
            directoryId={createDraftTarget.directoryId}
            onCreated={async (createdId) => {
              setCreateDraftTarget(null)
              await reloadNavigation()
              selectDraft(createdId)
            }}
            onClose={() => setCreateDraftTarget(null)}
          />
        )}
      </div>
    </div>
  )
}

function CreateDraftDialog({
  directoryId,
  onCreated,
  onClose,
}: {
  directoryId: string
  onCreated: (draftId: string) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState("")
  const [kind, setKind] = useState<"markdown" | "board">("markdown")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const attempt = useRef<{
    title: string
    kind: "markdown" | "board"
    createKey: string
    publishKey: string
    nodeId: string
  } | null>(null)
  const [created, setCreated] = useState(false)

  const submit = async () => {
    if (saving || !title.trim()) return
    setSaving(true)
    setError("")
    try {
      const cleanTitle = title.trim()
      if (
        attempt.current?.title !== cleanTitle ||
        attempt.current.kind !== kind
      ) {
        attempt.current = {
          title: cleanTitle,
          kind,
          createKey: newRequestKey(),
          publishKey: newRequestKey(),
          nodeId: newRequestKey(),
        }
      }
      const { createKey, publishKey, nodeId } = attempt.current
      const draft = await v2Api.createDraft({
        directoryId,
        kind,
        title: cleanTitle,
        requestKey: createKey,
      })
      setCreated(true)
      if (kind === "markdown") {
        await v2Api.publishInline({
          draftId: draft.id,
          baseSequence: 0,
          kind: "markdown",
          markdown: `# ${cleanTitle}\n\n`,
          summary: "初始版本",
          requestKey: publishKey,
        })
      } else {
        await v2Api.publishInline({
          draftId: draft.id,
          baseSequence: 0,
          kind: "board",
          canvas: {
            nodes: [
              {
                id: nodeId,
                type: "text",
                x: 160,
                y: 120,
                width: 240,
                height: 100,
                text: cleanTitle,
              },
            ],
            edges: [],
          },
          summary: "初始画布",
          requestKey: publishKey,
        })
      }
      await onCreated(draft.id)
    } catch (cause) {
      setError(v2Message(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>新建草稿</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                内容类型
              </span>
              <Select
                value={kind}
                disabled={saving || created}
                onValueChange={(value) =>
                  setKind(value as "markdown" | "board")
                }
              >
                <SelectTrigger aria-label="草稿类型" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="markdown">文档（Markdown）</SelectItem>
                  <SelectItem value="board">白板（无限画布）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="create-draft-title"
                className="text-xs font-medium text-muted-foreground"
              >
                标题
              </label>
              <Input
                id="create-draft-title"
                autoFocus
                placeholder="输入草稿标题…"
                value={title}
                maxLength={120}
                disabled={saving || created}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" size="sm" disabled={saving || !title.trim()}>
              {saving ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---- 比较视图（双侧冻结块呈现；块级差异行；两侧均可划选定位评论或整篇评论） ----

function CompareView(props: {
  compare: CompareState
  versions: V2VersionItem[]
  rows: CompareRow[]
  leftThreads: V2Thread[]
  rightThreads: V2Thread[]
  details: Record<string, ThreadDetail>
  replyDrafts: Record<string, { body: string; requestKey: string }>
  leftRef: React.RefObject<HTMLDivElement | null>
  rightRef: React.RefObject<HTMLDivElement | null>
  onSelect: (scope: "left" | "right") => void
  onCommentDocument: (scope: "left" | "right") => void
  onTargetSelect: (
    scope: "left" | "right",
    target: Record<string, unknown>
  ) => void
  onPendingBody: (body: string) => void
  onSubmit: () => Promise<void>
  onCancel: () => void
  onReplyDraft: (threadId: string, body: string) => void
  onReply: (thread: V2Thread) => Promise<void>
  onUpdateReply: (
    threadId: string,
    replyId: string,
    body: string
  ) => Promise<void>
  onDeleteReply: (threadId: string, replyId: string) => Promise<void>
  onDeleteThread: (thread: V2Thread) => Promise<void>
  onToggle: (thread: V2Thread) => Promise<void>
  onJump: (thread: V2Thread) => Promise<void>
  pending: PendingComment | null
}) {
  const { compare, rows } = props
  useMarkdownHighlights(
    props.leftRef,
    compare.left.blocks ?? [],
    props.leftThreads,
    "v2-left-anchor"
  )
  useMarkdownHighlights(
    props.rightRef,
    compare.right.blocks ?? [],
    props.rightThreads,
    "v2-right-anchor"
  )
  const isBoard = compare.left.kind === "board"
  const column = (side: "left" | "right") => {
    const ref = side === "left" ? props.leftRef : props.rightRef
    const threads = side === "left" ? props.leftThreads : props.rightThreads
    return (
      <div className="flex min-w-0 flex-col">
        <div className="mb-1 flex items-center justify-between px-1">
          <p className="text-sm font-semibold">V{compare[side].sequence}</p>
          <Button
            variant="outline"
            size="sm"
            className=""
            onClick={() => props.onCommentDocument(side)}
          >
            整篇评论
          </Button>
        </div>
        <div
          ref={ref}
          className="min-h-0 flex-1 overflow-auto rounded border bg-card p-2"
          onMouseUp={() => props.onSelect(side)}
        >
          {compare.left.kind === "ui" ? (
            <div className="flex h-full min-h-96 flex-col">
              <UiReader
                version={{
                  versionId: compare[side].versionId,
                  sequence: compare[side].sequence,
                  kind: "ui",
                }}
                threads={
                  side === "left" ? props.leftThreads : props.rightThreads
                }
                containerRef={ref}
                onSelect={() => props.onSelect(side)}
                onTargetSelect={(target) => props.onTargetSelect(side, target)}
              />
            </div>
          ) : isBoard ? (
            <div className="flex h-full min-h-72 flex-col">
              <BoardReader
                version={{
                  versionId: compare[side].versionId,
                  sequence: compare[side].sequence,
                  kind: "board",
                  canvas: compare[side].canvas,
                }}
                threads={
                  side === "left" ? props.leftThreads : props.rightThreads
                }
                containerRef={ref}
                onSelect={() => props.onSelect(side)}
                onTargetSelect={(target) => props.onTargetSelect(side, target)}
              />
            </div>
          ) : (
            rows.map((row, index) => {
              const block = side === "left" ? row.left : row.right
              const tone =
                row.status === "changed"
                  ? "bg-amber-500/10"
                  : row.status ===
                      (side === "left" ? "left-only" : "right-only")
                    ? "bg-emerald-500/10"
                    : row.status === "same"
                      ? ""
                      : "bg-destructive/10"
              return (
                <div
                  key={index}
                  className={`rounded px-1 ${tone} ${row.status === "same" ? "" : "my-0.5"}`}
                >
                  {block ? (
                    <div
                      ref={pruneRef}
                      className="v2-block mb-1"
                      data-block={block.index}
                      data-block-kind={block.type}
                      dangerouslySetInnerHTML={{
                        __html: renderAssets(block.html),
                      }}
                    />
                  ) : (
                    <p className="py-2 text-center text-[11px] text-muted-foreground">
                      此版本无对应段落
                    </p>
                  )}
                </div>
              )
            })
          )}
          <style>{markdownReaderStyles}</style>
        </div>
        <div className="mt-1 max-h-40 overflow-auto border-t pt-1">
          {threads.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              本版暂无讨论
            </p>
          ) : (
            threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                detail={props.details[thread.id]}
                versions={props.versions}
                replyDraft={props.replyDrafts[thread.id]?.body ?? ""}
                onReplyDraft={props.onReplyDraft}
                onReply={props.onReply}
                onUpdateReply={props.onUpdateReply}
                onDeleteReply={props.onDeleteReply}
                onDeleteThread={props.onDeleteThread}
                onToggle={props.onToggle}
                showVersion={false}
                onJump={props.onJump}
              />
            ))
          )}
        </div>
      </div>
    )
  }
  // AC17-三轮：比较侧块渲染与阅读器同一结构空白修剪，划选经同一 spans 映射
  const pruneRef = (element: HTMLDivElement | null) => {
    if (element) pruneStructuralWhitespace(element)
  }
  const diffGroups: {
    title: string
    tone: string
    items: NonNullable<CompareState["diff"]>[keyof NonNullable<
      CompareState["diff"]
    >]
  }[] = props.compare.diff
    ? [
        {
          title: "新增",
          tone: "text-emerald-600 dark:text-emerald-400",
          items: props.compare.diff.added,
        },
        {
          title: "删除",
          tone: "text-red-600 dark:text-red-400",
          items: props.compare.diff.removed,
        },
        {
          title: "内容变化",
          tone: "text-amber-600 dark:text-amber-400",
          items: props.compare.diff.contentChanged,
        },
        {
          title: "连接变化",
          tone: "text-sky-600 dark:text-sky-400",
          items: props.compare.diff.connectionChanged,
        },
        {
          title: "布局变化",
          tone: "text-violet-600 dark:text-violet-400",
          items: props.compare.diff.layoutChanged,
        },
      ]
    : []
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2">
        {column("left")}
        {column("right")}
      </div>
      {isBoard && props.compare.diff && (
        <div className="mt-2 max-h-40 overflow-auto rounded border p-2 text-xs">
          {diffGroups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.title} className="mb-1">
                <p className={`font-medium ${group.tone}`}>
                  {group.title}（{group.items.length}）
                </p>
                {group.items.map((item) => (
                  <p key={item.id} className="truncate text-muted-foreground">
                    {item.text}
                    {item.after && item.before ? "（变化详情见两侧画布）" : ""}
                  </p>
                ))}
              </div>
            )
          )}
        </div>
      )}
      {props.pending && (
        <CommentComposer
          title={
            (props.pending.target.kind === "document"
              ? "整篇评论 · V"
              : "定位评论 · V") +
            (props.pending.scope === "left"
              ? compare.left.sequence
              : compare.right.sequence)
          }
          pending={props.pending}
          onBody={props.onPendingBody}
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
        />
      )}
    </div>
  )
}

// ---- 讨论面板 ----

function ThreadPanel(props: {
  filters: V2ThreadFilter
  authors: string[]
  onFilters: (filters: V2ThreadFilter) => void
  threads: V2Thread[]
  details: Record<string, ThreadDetail>
  versions: V2VersionItem[]
  replyDrafts: Record<string, { body: string; requestKey: string }>
  pages: { complete: boolean; nextCursor: string | null }
  onReplyDraft: (threadId: string, body: string) => void
  onReply: (thread: V2Thread) => Promise<void>
  onUpdateReply: (
    threadId: string,
    replyId: string,
    body: string
  ) => Promise<void>
  onDeleteReply: (threadId: string, replyId: string) => Promise<void>
  onDeleteThread: (thread: V2Thread) => Promise<void>
  onToggle: (thread: V2Thread) => Promise<void>
  onJump: (thread: V2Thread) => Promise<void>
  onLoadMore: () => Promise<void>
  onLoadReplies: (thread: V2Thread) => Promise<void>
}) {
  // 筛选在服务端分页之前执行，回复作者与后续页不能被本地过滤遗漏。
  const visible = props.threads
  const open = visible.filter((thread) => thread.status === "open")
  const resolved = visible.filter((thread) => thread.status === "resolved")
  return (
    <aside
      aria-label="讨论"
      className="max-h-[35vh] w-full shrink-0 overflow-auto border-t bg-card p-5 lg:max-h-none lg:w-96 lg:border-t-0 lg:border-l xl:w-[420px]"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4 text-muted-foreground" />
          讨论{" "}
          <span className="text-muted-foreground">{props.threads.length}</span>
        </h2>
        <Select
          value={props.filters.authorActor ?? "__all__"}
          onValueChange={(value) =>
            props.onFilters({
              ...props.filters,
              authorActor: value === "__all__" ? undefined : value,
            })
          }
        >
          <SelectTrigger size="sm" aria-label="讨论作者" className="min-w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部作者</SelectItem>
            {props.authors.map((item) => (
              <SelectItem key={item} value={item}>
                {authorLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Select
          value={props.filters.versionId ?? "__all__"}
          onValueChange={(value) =>
            props.onFilters({
              ...props.filters,
              versionId: value === "__all__" ? undefined : value,
            })
          }
        >
          <SelectTrigger size="sm" aria-label="讨论版本" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部版本</SelectItem>
            {props.versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                V{version.sequence}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={props.filters.status ?? "__all__"}
          onValueChange={(value) =>
            props.onFilters({
              ...props.filters,
              status: value === "__all__" ? undefined : value,
            })
          }
        >
          <SelectTrigger size="sm" aria-label="讨论状态" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">全部状态</SelectItem>
            <SelectItem value="open">未解决</SelectItem>
            <SelectItem value="resolved">已解决</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {props.threads.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {Object.values(props.filters).some(Boolean)
            ? "没有符合筛选条件的讨论。"
            : "划选正文或整篇评论开始讨论。"}
        </p>
      )}
      {open.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          detail={props.details[thread.id]}
          versions={props.versions}
          replyDraft={props.replyDrafts[thread.id]?.body ?? ""}
          onReplyDraft={props.onReplyDraft}
          onReply={props.onReply}
          onUpdateReply={props.onUpdateReply}
          onDeleteReply={props.onDeleteReply}
          onDeleteThread={props.onDeleteThread}
          onToggle={props.onToggle}
          onJump={props.onJump}
        />
      ))}
      {resolved.length > 0 && (
        <details
          className="mt-2"
          open={props.filters.status === "resolved" ? true : undefined}
        >
          <summary className="cursor-pointer text-xs text-muted-foreground">
            已解决（{resolved.length}）
          </summary>
          {resolved.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              detail={props.details[thread.id]}
              versions={props.versions}
              replyDraft={props.replyDrafts[thread.id]?.body ?? ""}
              onReplyDraft={props.onReplyDraft}
              onReply={props.onReply}
              onUpdateReply={props.onUpdateReply}
              onDeleteReply={props.onDeleteReply}
              onDeleteThread={props.onDeleteThread}
              onToggle={props.onToggle}
              onJump={props.onJump}
            />
          ))}
        </details>
      )}
      {!props.pages.complete && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={() => void props.onLoadMore()}
        >
          加载更多讨论
        </Button>
      )}
    </aside>
  )
}

function ThreadCard(props: {
  thread: V2Thread
  detail?: ThreadDetail
  versions: V2VersionItem[]
  replyDraft: string
  showVersion?: boolean
  onReplyDraft: (threadId: string, body: string) => void
  onReply: (thread: V2Thread) => Promise<void>
  onUpdateReply: (
    threadId: string,
    replyId: string,
    body: string
  ) => Promise<void>
  onDeleteReply: (threadId: string, replyId: string) => Promise<void>
  onDeleteThread: (thread: V2Thread) => Promise<void>
  onToggle: (thread: V2Thread) => Promise<void>
  onJump?: (thread: V2Thread) => Promise<void>
  onLoadReplies?: (thread: V2Thread) => Promise<void>
}) {
  const { thread } = props
  const [sending, setSending] = useState(false)
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState("")
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)
  const [deletingThread, setDeletingThread] = useState(false)
  const send = async () => {
    if (sending || !props.replyDraft.trim()) return
    setSending(true)
    try {
      await props.onReply(thread)
    } finally {
      setSending(false)
    }
  }
  const saveEdit = async (replyId: string) => {
    if (busyReplyId || !editingBody.trim()) return
    setBusyReplyId(replyId)
    try {
      await props.onUpdateReply(thread.id, replyId, editingBody)
      setEditingReplyId(null)
      setEditingBody("")
    } finally {
      setBusyReplyId(null)
    }
  }
  const removeReply = async (replyId: string) => {
    if (busyReplyId) return
    if (!window.confirm("确定删除这条评论？")) return
    setBusyReplyId(replyId)
    try {
      await props.onDeleteReply(thread.id, replyId)
      if (editingReplyId === replyId) {
        setEditingReplyId(null)
        setEditingBody("")
      }
    } finally {
      setBusyReplyId(null)
    }
  }
  const removeThread = async () => {
    if (deletingThread) return
    if (!window.confirm("确定删除整条讨论及其全部回复？此操作不可撤销。"))
      return
    setDeletingThread(true)
    try {
      await props.onDeleteThread(thread)
    } finally {
      setDeletingThread(false)
    }
  }
  return (
    <div className="mb-5 border-b border-border/60 pb-5 text-sm last:border-0">
      <div className="group/thread flex items-center justify-between gap-2">
        <span className="font-medium">{authorLabel(thread.authorActor)}</span>
        <div className="flex items-center gap-1.5">
          <Badge
            variant={thread.status === "resolved" ? "secondary" : "outline"}
            className={
              thread.status === "resolved"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }
          >
            {thread.status === "resolved" ? "已解决" : "未解决"}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-60 hover:text-destructive hover:opacity-100"
            aria-label="删除讨论"
            title="删除整条讨论"
            disabled={deletingThread}
            onClick={() => void removeThread()}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <p className="my-3 border-l-2 border-primary/40 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {thread.anchor.kind === "unresolved"
          ? "定位不可用（历史数据）"
          : anchorTitle(thread.anchor)}
      </p>
      {/* AC19-四轮：跳转入口对三类可定位锚点真实开放（普通/比较两侧均有按钮），
          版本标签保留 showVersion 语义；unresolved/corrupt 不可定位无按钮 */}
      {(["markdown", "board", "ui"].includes(thread.anchor.kind) ||
        props.showVersion) && (
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          {props.showVersion && (
            <span>
              版本 V
              {props.versions.find((item) => item.id === thread.versionId)
                ?.sequence ?? "?"}
            </span>
          )}
          {["markdown", "board", "ui"].includes(thread.anchor.kind) && (
            <Button
              variant="outline"
              size="sm"
              className=""
              onClick={() => void props.onJump?.(thread)}
            >
              跳转
            </Button>
          )}
        </div>
      )}
      {(props.detail?.replies ?? []).map((reply) => {
        const isEditing = editingReplyId === reply.id
        const isBusy = busyReplyId === reply.id
        return (
          <div key={reply.id} className="group/reply mt-3 py-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {authorLabel(reply.authorActor)}
              </span>
              {!isEditing && (
                <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover/reply:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="编辑评论"
                    title="编辑"
                    disabled={Boolean(busyReplyId)}
                    onClick={() => {
                      setEditingReplyId(reply.id)
                      setEditingBody(reply.body)
                    }}
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="hover:text-destructive"
                    aria-label="删除评论"
                    title="删除"
                    disabled={Boolean(busyReplyId)}
                    onClick={() => void removeReply(reply.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              )}
            </div>
            {isEditing ? (
              <div className="mt-1.5 flex flex-col gap-2">
                <Textarea
                  autoFocus
                  aria-label="编辑评论内容"
                  className="max-h-56 min-h-20 w-full resize-y text-sm leading-relaxed"
                  disabled={isBusy}
                  value={editingBody}
                  onChange={(event) => setEditingBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (isBusy || event.nativeEvent.isComposing) return
                    if (event.key === "Escape") {
                      event.preventDefault()
                      setEditingReplyId(null)
                      setEditingBody("")
                    }
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey) &&
                      editingBody.trim()
                    ) {
                      event.preventDefault()
                      void saveEdit(reply.id)
                    }
                  }}
                />
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      setEditingReplyId(null)
                      setEditingBody("")
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy || !editingBody.trim()}
                    onClick={() => void saveEdit(reply.id)}
                  >
                    {isBusy ? "保存中…" : "保存"}
                  </Button>
                </div>
              </div>
            ) : (
              <CommentMarkdown content={reply.body} className="mt-1" />
            )}
            {reply.relatedVersionId && (
              <span className="text-xs text-blue-700 dark:text-blue-400">
                关联 V
                {props.versions.find(
                  (item) => item.id === reply.relatedVersionId
                )?.sequence ?? "?"}
              </span>
            )}
          </div>
        )
      })}
      {props.detail && !props.detail.complete && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1"
          onClick={() => void props.onLoadReplies?.(thread)}
        >
          加载更多回复
        </Button>
      )}
      {thread.status === "open" && (
        <div className="mt-4 flex flex-col gap-2">
          <Textarea
            className="max-h-56 min-h-24 w-full resize-y text-sm leading-relaxed"
            aria-label="回复内容"
            placeholder="输入回复，支持 Markdown（Ctrl+Enter 发送）…"
            disabled={sending}
            value={props.replyDraft}
            onChange={(event) =>
              props.onReplyDraft(thread.id, event.target.value)
            }
            onKeyDown={(event) => {
              if (
                sending ||
                event.nativeEvent.isComposing ||
                !props.replyDraft.trim()
              )
                return
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sending}
              onClick={() => void props.onToggle(thread)}
            >
              解决
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={sending || !props.replyDraft.trim()}
              onClick={() => void send()}
            >
              {sending ? "发送中…" : "发送"}
            </Button>
          </div>
        </div>
      )}
      {thread.status === "resolved" && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1"
          onClick={() => void props.onToggle(thread)}
        >
          重开
        </Button>
      )}
    </div>
  )
}

// ---- 评论输入 ----

function CommentComposer(props: {
  title: string
  pending: PendingComment
  onBody: (body: string) => void
  onSubmit: () => Promise<void>
  onCancel: () => void
}) {
  const titleId = useId()
  const quote =
    typeof props.pending.target.exact === "string"
      ? props.pending.target.exact
      : Array.isArray(props.pending.target.segments)
        ? props.pending.target.segments
            .map((segment) =>
              typeof segment.exact === "string" ? segment.exact : ""
            )
            .filter(Boolean)
            .join("\n")
        : typeof props.pending.target.text === "string"
          ? props.pending.target.text
          : ""
  const [submitting, setSubmitting] = useState(false)
  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await props.onSubmit()
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className="fixed bottom-6 left-1/2 z-50 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 rounded-xl border bg-card p-5 shadow-xl"
      onKeyDown={(event) => {
        if (submitting) return
        if (event.key === "Escape") {
          event.preventDefault()
          props.onCancel()
        }
        if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
          !event.nativeEvent.isComposing &&
          props.pending.body.trim()
        ) {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <p id={titleId} className="text-xs font-medium text-muted-foreground">
          {props.title}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={props.onCancel}
        >
          取消
        </Button>
      </div>
      {quote && (
        <blockquote className="mb-3 max-h-20 overflow-auto border-l-2 border-primary/30 pl-3 text-sm whitespace-pre-wrap text-muted-foreground">
          {quote}
        </blockquote>
      )}
      <Textarea
        autoFocus
        className="max-h-64 min-h-28 w-full resize-y text-sm leading-relaxed"
        aria-label="评论内容"
        disabled={submitting}
        placeholder="输入评论内容，支持 Markdown（Ctrl+Enter 提交）…"
        value={props.pending.body}
        onChange={(event) => props.onBody(event.target.value)}
      />
      <div className="mt-3 flex justify-end">
        <Button
          variant="default"
          size="sm"
          disabled={submitting || !props.pending.body.trim()}
          onClick={() => void submit()}
        >
          {submitting ? "提交中…" : "提交"}
        </Button>
      </div>
    </div>
  )
}

// ---- 块渲染辅助 ----
