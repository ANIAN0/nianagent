// 工作台 v2 协作视图（唯一产品入口，Q01/Q02）：
// 项目/目录/草稿导航 → 版本阅读（冻结块投影 + 锚点高亮 + 授权图片）→ 划选评论/整篇评论 →
// 回复与状态 → 版本比较与两版分别评论。未提交评论在切换版本与失败重试时保留。
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { NativeSelect } from "./ui/native-select"
import { Badge } from "./ui/badge"
import {
  MessageSquare,
  ArrowLeft,
  GitCompareArrows,
  PanelLeft,
  Copy,
  FileText,
  Workflow,
  PanelsTopLeft,
} from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  loadAssetUrl,
  newRequestKey,
  v2Api,
  v2Message,
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
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const readerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const assetUrlsRef = useRef<string[]>([])
  const navigationRevision = useRef(0)
  const organizationQueryRevision = useRef(0)
  const syncCursor = useRef(0)
  useEffect(
    () => () => {
      navigationRevision.current++
      organizationQueryRevision.current++
    },
    []
  )

  const draft =
    [...drafts, ...archivedDrafts].find((item) => item.id === draftId) ?? null
  const referenceVersion = compare ? compare.right : version
  const referenceParams =
    draft && referenceVersion
      ? new URLSearchParams({
          draft: draft.id,
          version: referenceVersion.versionId,
          ...(compare ? { compare: compare.left.versionId } : {}),
        })
      : null
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
            openUrl: `${window.location.origin}/#v2?${referenceParams}`,
          },
          null,
          2
        )
      : ""
  const [staleNotice, setStaleNotice] = useState(false)
  const [syncIssue, setSyncIssue] = useState("")
  const [navigationOpen, setNavigationOpen] = useState(false)

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
          blocks: data.blocks,
          canvas: data.canvas,
          manifest: data.manifest,
        })
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
        // AC18：项目/草稿/目录全量分页（默认仅未归档）；归档草稿另取一列供恢复浏览与深链解析
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
          projectItems.map(async (project) =>
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
        if (organizationRevision === organizationQueryRevision.current) {
          setProjects(projectItems)
          setDrafts(draftItems)
          setArchivedDrafts(archivedItems)
          setDirectories(directoryPages.flat())
        }
        // 深链精确定位：链接草稿在未归档与归档两列中解析；不存在则显式报错，绝不静默换草稿
        const allDrafts = [...draftItems, ...archivedItems]
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
      if (revision !== organizationQueryRevision.current) return
      setProjects(projectItems)
      setDrafts(draftItems)
      setArchivedDrafts(archivedItems)
      setDirectories(directoryPages.flat())
    } catch (err) {
      if (revision !== organizationQueryRevision.current) return
      throw err
    }
  }, [])

  // 复用宿主长轮询通知：元数据变更自动进入导航，版本/意见仅提示，不覆盖阅读和输入。
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // The host cursor belongs to this workspace, not the selected draft. Restarting
    // the request on navigation must not re-fetch every unchanged project/directory.
    let since = syncCursor.current
    const poll = async () => {
      try {
        const result = await v2Api.waitForChanges(since, controller.signal)
        if (controller.signal.aborted) return
        setSyncIssue("")
        if (result.version !== since) {
          await reloadNavigation()
          if (controller.signal.aborted) return
          if (draftId) {
            const page = await v2Api.listThreads(draftId)
            if (controller.signal.aborted) return
            if (page.reviewRevision > reviewRevision) setStaleNotice(true)
          }
          since = result.version
          syncCursor.current = since
        }
        if (!controller.signal.aborted) void poll()
      } catch (cause) {
        if (controller.signal.aborted) return
        setSyncIssue(`工作台同步失败：${v2Message(cause)}`)
        timer = setTimeout(() => void poll(), 2000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [draftId, reviewRevision, reloadNavigation])

  const patchDraft = useCallback(
    async (
      draftId: string,
      patch: {
        title?: string
        directoryId?: string
        archived?: boolean
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
      setCompareWith("")
      setFocusRequest(null)
      if (next) void reloadDraft(next)
    },
    [pending, reloadDraft]
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
          onRefresh={reloadNavigation}
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b bg-card px-6 py-3">
          <strong className="mr-auto max-w-72 truncate text-base font-semibold">
            {draft ? draft.title : "工作台"}
          </strong>
          {draft && version && !compare && (
            <NativeSelect
              size="sm"
              aria-label="当前版本"
              className=""
              value={version.versionId}
              onChange={(event) => {
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
                  void loadVersion(draftId, event.target.value).catch((err) =>
                    setError(v2Message(err))
                  )
              }}
            >
              {versions.map((item) => (
                <option key={item.id} value={item.id}>
                  V{item.sequence}
                  {item.summary ? ` · ${item.summary}` : ""}
                </option>
              ))}
            </NativeSelect>
          )}
          {draft && version && versions.length >= 2 && !compare && (
            <>
              <NativeSelect
                size="sm"
                aria-label="比较版本"
                className=""
                value={compareWith}
                onChange={(event) => setCompareWith(event.target.value)}
              >
                <option value="">与当前版本比较…</option>
                {versions
                  .filter((item) => item.id !== version.versionId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      V{item.sequence}
                      {item.summary ? ` · ${item.summary}` : ""}
                    </option>
                  ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                className=""
                disabled={!compareWith}
                onClick={() => {
                  if (compareWith)
                    void loadCompare(compareWith, version.versionId)
                }}
              >
                比较
              </Button>
              <Button
                variant="outline"
                size="sm"
                className=""
                onClick={() => void loadCompare(versions[1].id, versions[0].id)}
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
              className=""
              onClick={() => {
                setCompare(null)
                if (draftId && version) syncLocation(draftId, version.versionId)
              }}
            >
              <ArrowLeft data-icon="inline-start" />
              返回阅读
            </Button>
          )}
          {referenceText && (
            <Button
              variant="outline"
              size="sm"
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
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {staleNotice && (
              <Button
                variant="outline"
                size="sm"
                className=""
                onClick={() =>
                  draftId &&
                  void reloadDraft(draftId, version?.versionId, compare)
                }
              >
                有更新，点击刷新
              </Button>
            )}
            {version && !compare && (
              <Badge variant="secondary">V{version.sequence}</Badge>
            )}
          </span>
        </header>
        {syncIssue && (
          <p
            role="status"
            className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            {syncIssue}；连接恢复后自动同步。
          </p>
        )}
        {error && (
          <div className="flex items-center justify-between border-b bg-red-50 px-4 py-1 text-sm text-red-700">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              className=""
              onClick={() => setError("")}
            >
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
            onSelect={(scope) => beginComment(scope)}
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
                  <p
                    role="status"
                    className="flex-1 p-6 text-sm text-muted-foreground"
                  >
                    {contentLoading
                      ? "正在读取版本…"
                      : versions.length
                        ? "版本尚未加载成功。请根据错误提示处理后重新打开。"
                        : "该草稿尚无版本。Agent 发布后即可阅读与评论。"}
                  </p>
                )
              if (!Reader)
                return (
                  <p className="flex-1 p-6 text-sm text-muted-foreground">
                    {kindLabel(draft.kind)}阅读器未接入。
                  </p>
                )
              return (
                <>
                  <Reader
                    version={version}
                    threads={versionThreads}
                    containerRef={readerRef}
                    onSelect={() => beginComment("reading")}
                    // AC01：普通阅读模式的白板节点/边与 UI 元素评论接线——目标绑定当前阅读
                    // 版本身份（beginComment 在点击时刻取 version?.versionId 固化到 pending）
                    onTargetSelect={(target) => beginComment("reading", target)}
                    focusRequest={focusRequest}
                    onReport={reportFocus}
                  />
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                    <Button
                      variant="outline"
                      size="sm"
                      className=""
                      onClick={() =>
                        beginComment("reading", { kind: "document" })
                      }
                    >
                      <MessageSquare data-icon="inline-start" />
                      整篇评论
                    </Button>
                  </div>
                </>
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
              onToggle={toggleStatus}
              onJump={jumpToThread}
              onLoadMore={loadMoreThreads}
              onLoadReplies={loadMoreReplies}
            />
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
      </div>
    </div>
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
                  ? "bg-amber-50"
                  : row.status ===
                      (side === "left" ? "left-only" : "right-only")
                    ? "bg-emerald-50"
                    : row.status === "same"
                      ? ""
                      : "bg-red-50"
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
                    <p className="py-2 text-center text-[11px] text-neutral-400">
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
            <p className="px-1 text-[11px] text-neutral-400">本版暂无讨论</p>
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
          tone: "text-emerald-700",
          items: props.compare.diff.added,
        },
        {
          title: "删除",
          tone: "text-red-700",
          items: props.compare.diff.removed,
        },
        {
          title: "内容变化",
          tone: "text-amber-700",
          items: props.compare.diff.contentChanged,
        },
        {
          title: "连接变化",
          tone: "text-sky-700",
          items: props.compare.diff.connectionChanged,
        },
        {
          title: "布局变化",
          tone: "text-violet-700",
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
                  <p key={item.id} className="truncate text-neutral-600">
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
      className="max-h-[35vh] w-full shrink-0 overflow-auto border-t bg-card p-5 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l xl:w-88"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4 text-muted-foreground" />
          讨论{" "}
          <span className="text-muted-foreground">{props.threads.length}</span>
        </h2>
        <NativeSelect
          size="sm"
          aria-label="讨论作者"
          className=""
          value={props.filters.authorActor ?? ""}
          onChange={(event) =>
            props.onFilters({
              ...props.filters,
              authorActor: event.target.value || undefined,
            })
          }
        >
          <option value="">全部作者</option>
          {props.authors.map((item) => (
            <option key={item} value={item}>
              {authorLabel(item)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <NativeSelect
          aria-label="讨论版本"
          value={props.filters.versionId ?? ""}
          onChange={(event) =>
            props.onFilters({
              ...props.filters,
              versionId: event.target.value || undefined,
            })
          }
        >
          <option value="">全部版本</option>
          {props.versions.map((version) => (
            <option key={version.id} value={version.id}>
              V{version.sequence}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="讨论状态"
          value={props.filters.status ?? ""}
          onChange={(event) =>
            props.onFilters({
              ...props.filters,
              status: event.target.value || undefined,
            })
          }
        >
          <option value="">全部状态</option>
          <option value="open">未解决</option>
          <option value="resolved">已解决</option>
        </NativeSelect>
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
  onToggle: (thread: V2Thread) => Promise<void>
  onJump?: (thread: V2Thread) => Promise<void>
  onLoadReplies?: (thread: V2Thread) => Promise<void>
}) {
  const { thread } = props
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (sending || !props.replyDraft.trim()) return
    setSending(true)
    try {
      await props.onReply(thread)
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="mb-5 border-b border-border/60 pb-5 text-sm last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{authorLabel(thread.authorActor)}</span>
        <span
          className={
            thread.status === "resolved" ? "text-green-700" : "text-amber-700"
          }
        >
          {thread.status === "resolved" ? "已解决" : "未解决"}
        </span>
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
      {(props.detail?.replies ?? []).map((reply) => (
        <div key={reply.id} className="mt-3 py-1">
          <span className="text-xs text-muted-foreground">
            {authorLabel(reply.authorActor)}
          </span>
          <p className="mt-1 leading-relaxed break-words whitespace-pre-wrap">
            {reply.body}
          </p>
          {reply.relatedVersionId && (
            <span className="text-xs text-blue-700">
              关联 V
              {props.versions.find((item) => item.id === reply.relatedVersionId)
                ?.sequence ?? "?"}
            </span>
          )}
        </div>
      ))}
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
        <div className="mt-4 flex flex-wrap gap-2">
          <Input
            className="min-w-0 flex-1"
            placeholder="回复…"
            disabled={sending}
            value={props.replyDraft}
            onChange={(event) =>
              props.onReplyDraft(thread.id, event.target.value)
            }
          />
          <Button
            variant="outline"
            size="sm"
            disabled={sending || !props.replyDraft.trim()}
            onClick={() => void send()}
          >
            {sending ? "发送中…" : "发送"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className=""
            onClick={() => void props.onToggle(thread)}
          >
            解决
          </Button>
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
      className="fixed bottom-6 left-1/2 z-20 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 rounded-xl border bg-card p-5 shadow-xl"
      onKeyDown={(event) => {
        if (submitting) return
        if (event.key === "Escape") {
          event.preventDefault()
          props.onCancel()
        }
        if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
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
        className="h-20 w-full"
        aria-label="评论内容"
        disabled={submitting}
        placeholder="评论内容…"
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
