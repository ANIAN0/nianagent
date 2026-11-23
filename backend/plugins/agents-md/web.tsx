import { useEffect, useMemo, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Eye,
  FilePenLine,
  FolderPlus,
  Pencil,
  Plus,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { notifyToast } from "@/components/ui/notification-toast"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReadOnlyPatch } from "@/components/read-only-patch"
import { MarkdownEditor } from "./markdown-editor"
import { callPlugin } from "@/features/plugins/plugin-service"
import type { PluginWebModule } from "@/features/plugins/plugin-api"
import { profileLocalStorage } from "@/lib/rpc/profile-storage"
import type {
  AgentsChooseDirectoryResult,
  AgentsMdStatus,
  AgentsProjectDetail,
  AgentsProjectStatus,
  AgentsProjectSummary,
  AgentsReplacePreview,
  AgentsReplaceResult,
  AgentsSnippet,
} from "./types"

const DEFAULT_PAGE_SIZE = 10
const LAST_PUBLICATION = "agents-md:last-publication"

const PUBLICATION_OUTCOME = {
  pending: "尚未开始",
  created: "已新建",
  replaced: "已覆盖",
  conflict: "目标有变化",
  failed: "写入失败",
  stopped: "已停止",
  unknown: "待核对",
} satisfies Record<AgentsReplaceResult["results"][number]["outcome"], string>

const invoke = async <T,>(
  name: string,
  input: object,
  signal?: AbortSignal
): Promise<T> =>
  (await callPlugin<{ value: T }>("agents-md", name, input, undefined, signal))
    .value

const errorMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : "操作未确认，请重新读取。"

const STATUS_META: Record<
  AgentsProjectStatus,
  { label: string; dotClass: string }
> = {
  synced: { label: "一致", dotClass: "bg-emerald-500" },
  different: { label: "不一致", dotClass: "bg-amber-500" },
  missing: { label: "缺失", dotClass: "bg-muted-foreground/50" },
  unavailable: { label: "不可访问", dotClass: "bg-destructive" },
}

const createId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `snippet-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

export function Page() {
  const [value, setValue] = useState<AgentsMdStatus>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | AgentsProjectStatus>(
    "all"
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])

  // 统一正文编辑弹窗
  const [baseDialogOpen, setBaseDialogOpen] = useState(false)
  const [baseDraft, setBaseDraft] = useState("")

  // 预览合成内容弹窗
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copiedPreview, setCopiedPreview] = useState(false)

  // 附加说明新增/编辑弹窗
  const [snippetDialogOpen, setSnippetDialogOpen] = useState(false)
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null)
  const [snippetName, setSnippetName] = useState("")
  const [snippetContent, setSnippetContent] = useState("")
  const [snippetEnabled, setSnippetEnabled] = useState(true)

  // 添加目录弹窗
  const [addDirOpen, setAddDirOpen] = useState(false)
  const [dirPathInput, setDirPathInput] = useState("")

  // 查看/对比项目弹窗
  const [inspectProject, setInspectProject] =
    useState<AgentsProjectSummary | null>(null)
  const [inspectDetail, setInspectDetail] =
    useState<AgentsProjectDetail | null>(null)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [inspectError, setInspectError] = useState("")
  const [inspectTab, setInspectTab] = useState<"diff" | "full">("diff")

  // 全量替换确认弹窗
  const [replacePreview, setReplacePreview] = useState<
    (AgentsReplacePreview & { revision: number }) | null
  >(null)
  const [lastPublication, setLastPublication] = useState(
    () => profileLocalStorage.getItem(LAST_PUBLICATION) ?? ""
  )
  const [publicationResult, setPublicationResult] =
    useState<AgentsReplaceResult | null>(null)

  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)

  const applyStatus = (next: AgentsMdStatus) => {
    setValue(next)
    const valid = new Set(
      next.projects
        .filter((item) => item.status !== "unavailable")
        .map((item) => item.path)
    )
    setSelectedPaths((prev) => prev.filter((item) => valid.has(item)))
  }

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void invoke<AgentsMdStatus>("status", {}, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) applyStatus(next)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(errorMessage(reason))
      })
    return () => {
      controller.abort()
      lifetime.current = null
    }
  }, [])

  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || busy.current) return
    busy.current = true
    setPending(true)
    setError("")
    try {
      await action(controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorMessage(reason))
    } finally {
      busy.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }

  const refresh = (silent = false) =>
    void run(async (signal) => {
      const next = await invoke<AgentsMdStatus>("status", {}, signal)
      if (!signal.aborted) {
        applyStatus(next)
        if (!silent) notifyToast("已刷新项目状态", { tone: "success" })
      }
    })

  const filteredProjects = useMemo(() => {
    if (!value) return []
    const keyword = query.trim().toLowerCase()
    return value.projects.filter((project) => {
      if (statusFilter !== "all" && project.status !== statusFilter)
        return false
      if (!keyword) return true
      return (
        project.name.toLowerCase().includes(keyword) ||
        project.path.toLowerCase().includes(keyword)
      )
    })
  }, [value, query, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedProjects = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredProjects.slice(start, start + pageSize)
  }, [filteredProjects, currentPage, pageSize])
  const hasActiveFilter = query.trim().length > 0 || statusFilter !== "all"

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths])

  const selectableOnPage = useMemo(
    () => pagedProjects.filter((item) => item.status !== "unavailable"),
    [pagedProjects]
  )

  const allOnPageSelected =
    selectableOnPage.length > 0 &&
    selectableOnPage.every((item) => selectedSet.has(item.path))

  const updatableProjects = useMemo(
    () =>
      (value?.projects || []).filter(
        (item) => item.status === "different" || item.status === "missing"
      ),
    [value]
  )

  const enabledSnippetCount = useMemo(
    () => (value?.snippets || []).filter((item) => item.enabled).length,
    [value]
  )

  const hasComposedContent = Boolean(value?.composedContent.trim())

  const toggleSelectRow = (path: string, checked: boolean) => {
    setSelectedPaths((prev) =>
      checked
        ? prev.includes(path)
          ? prev
          : [...prev, path]
        : prev.filter((item) => item !== path)
    )
  }

  const toggleSelectPage = (checked: boolean) => {
    const pagePaths = selectableOnPage.map((item) => item.path)
    setSelectedPaths((prev) => {
      if (checked) return [...new Set([...prev, ...pagePaths])]
      const remove = new Set(pagePaths)
      return prev.filter((item) => !remove.has(item))
    })
  }

  const openBaseEditor = () => {
    if (!value) return
    setBaseDraft(value.baseContent)
    setBaseDialogOpen(true)
  }

  const saveBaseContent = () => {
    if (!value) return
    void run(async (signal) => {
      const next = await invoke<AgentsMdStatus>(
        "saveBase",
        { revision: value.revision, baseContent: baseDraft },
        signal
      )
      if (!signal.aborted) {
        applyStatus(next)
        setBaseDialogOpen(false)
        notifyToast("统一正文已保存", { tone: "success" })
      }
    })
  }

  const persistSnippets = (nextSnippets: AgentsSnippet[], feedback: string) => {
    if (!value) return
    void run(async (signal) => {
      const next = await invoke<AgentsMdStatus>(
        "saveSnippets",
        { revision: value.revision, snippets: nextSnippets },
        signal
      )
      if (!signal.aborted) {
        applyStatus(next)
        setSnippetDialogOpen(false)
        notifyToast(feedback, { tone: "success" })
      }
    })
  }

  const openAddSnippet = () => {
    setEditingSnippetId(null)
    setSnippetName("")
    setSnippetContent("")
    setSnippetEnabled(true)
    setSnippetDialogOpen(true)
  }

  const openEditSnippet = (snippet: AgentsSnippet) => {
    setEditingSnippetId(snippet.id)
    setSnippetName(snippet.name)
    setSnippetContent(snippet.content)
    setSnippetEnabled(snippet.enabled)
    setSnippetDialogOpen(true)
  }

  const submitSnippet = () => {
    if (!value) return
    const trimmedName = snippetName.trim()
    if (!trimmedName) return
    if (editingSnippetId) {
      const next = value.snippets.map((item) =>
        item.id === editingSnippetId
          ? {
              ...item,
              name: trimmedName,
              content: snippetContent,
              enabled: snippetEnabled,
            }
          : item
      )
      persistSnippets(next, "附加说明已更新")
    } else {
      const next: AgentsSnippet[] = [
        ...value.snippets,
        {
          id: createId(),
          name: trimmedName,
          content: snippetContent,
          enabled: snippetEnabled,
          source: "manual",
        },
      ]
      persistSnippets(next, "附加说明已添加")
    }
  }

  const toggleSnippet = (snippet: AgentsSnippet, enabled: boolean) => {
    if (!value) return
    const next = value.snippets.map((item) =>
      item.id === snippet.id ? { ...item, enabled } : item
    )
    persistSnippets(
      next,
      enabled ? `已开启「${snippet.name}」` : `已关闭「${snippet.name}」`
    )
  }

  const deleteSnippet = (snippet: AgentsSnippet) => {
    if (!value) return
    const next = value.snippets.filter((item) => item.id !== snippet.id)
    persistSnippets(next, `已删除「${snippet.name}」`)
  }

  const submitAddDirectory = () => {
    const trimmed = dirPathInput.trim()
    if (!trimmed) return
    void run(async (signal) => {
      const next = await invoke<AgentsMdStatus>(
        "addDirectory",
        { path: trimmed },
        signal
      )
      if (!signal.aborted) {
        applyStatus(next)
        setDirPathInput("")
        setAddDirOpen(false)
        notifyToast("项目目录已登记", { tone: "success" })
      }
    })
  }

  const pickDirectory = () => {
    void run(async (signal) => {
      const res = await invoke<AgentsChooseDirectoryResult>(
        "chooseDirectory",
        {},
        signal
      )
      if (!signal.aborted) {
        applyStatus(res.status)
        if (!res.cancelled) {
          setAddDirOpen(false)
          notifyToast("项目目录已登记", { tone: "success" })
        }
      }
    })
  }

  const removeCustomDirectory = (project: AgentsProjectSummary) => {
    if (!value) return
    void run(async (signal) => {
      const next = await invoke<AgentsMdStatus>(
        "removeDirectory",
        { revision: value.revision, id: project.id },
        signal
      )
      if (!signal.aborted) {
        applyStatus(next)
        notifyToast(`已移除「${project.name}」`, { tone: "success" })
      }
    })
  }

  const openInspect = (project: AgentsProjectSummary) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted) return
    setInspectProject(project)
    setInspectDetail(null)
    setInspectError("")
    setInspectTab(project.status === "different" ? "diff" : "full")
    setInspectLoading(true)
    void invoke<AgentsProjectDetail>(
      "readProject",
      { path: project.path },
      controller.signal
    )
      .then((detail) => {
        if (!controller.signal.aborted) {
          setInspectDetail(detail)
          setInspectTab(detail.status === "different" ? "diff" : "full")
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setInspectError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setInspectLoading(false)
      })
  }

  const adoptAsBase = (content: string) => {
    if (!value) return
    void run(async (signal) => {
      const next = await invoke<AgentsMdStatus>(
        "saveBase",
        { revision: value.revision, baseContent: content },
        signal
      )
      if (!signal.aborted) {
        applyStatus(next)
        setInspectProject(null)
        notifyToast("已设为统一正文", { tone: "success" })
      }
    })
  }

  const openReplace = (targets: AgentsProjectSummary[]) => {
    if (!value || targets.length === 0) return
    const revision = value.revision
    void run(async (signal) => {
      const next = await invoke<AgentsReplacePreview>(
        "previewReplace",
        {
          revision,
          paths: targets.map((item) => item.path),
        },
        signal
      )
      if (!signal.aborted) setReplacePreview({ ...next, revision })
    })
  }

  const executeReplace = () => {
    if (!replacePreview) return
    const { publicationId, revision, targets } = replacePreview
    void run(async (signal) => {
      profileLocalStorage.setItem(LAST_PUBLICATION, publicationId)
      setLastPublication(publicationId)
      let result: AgentsReplaceResult
      try {
        result = await invoke<AgentsReplaceResult>(
          "replaceProjects",
          {
            publicationId,
            revision,
            paths: targets.map((item) => item.path),
          },
          signal
        )
      } catch (reason) {
        signal.throwIfAborted()
        const known = await invoke<AgentsReplaceResult>(
          "replaceResult",
          { publicationId },
          signal
        ).catch(() => null)
        if (known?.state !== "finished") throw reason
        result = known
      }
      if (signal.aborted) return
      setReplacePreview(null)
      setInspectProject(null)
      setSelectedPaths([])
      const written = result.results.filter(
        ({ outcome }) => outcome === "created" || outcome === "replaced"
      ).length
      if (written === result.results.length) {
        notifyToast(`已发布 ${written} 个项目的 AGENTS.md`, { tone: "success" })
      } else {
        setPublicationResult(result)
      }
      try {
        const next = await invoke<AgentsMdStatus>("status", {}, signal)
        if (!signal.aborted) applyStatus(next)
      } catch (reason) {
        if (!signal.aborted)
          setError(`发布结果已记录，项目列表刷新失败。${errorMessage(reason)}`)
      }
    })
  }

  const showLastPublication = () => {
    void run(async (signal) => {
      const result = await invoke<AgentsReplaceResult>(
        "replaceResult",
        { publicationId: lastPublication },
        signal
      )
      if (!signal.aborted) setPublicationResult(result)
    })
  }

  const copyPreview = async () => {
    if (!value?.composedContent) return
    await navigator.clipboard.writeText(value.composedContent)
    setCopiedPreview(true)
    notifyToast("已复制到剪贴板", { tone: "success" })
    window.setTimeout(() => setCopiedPreview(false), 1600)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-label="AGENTS.md 管理">
      {error && !replacePreview && (
        <Alert>
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!value ? (
        <div
          className="flex flex-col gap-4"
          aria-label="正在读取 AGENTS.md 状态"
        >
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* 卡片一：统一 AGENTS.md */}
          <section
            className="flex flex-col gap-4 rounded-xl border bg-card p-4"
            aria-label="统一 AGENTS.md"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className={
                    hasComposedContent
                      ? "size-2 rounded-full bg-emerald-500"
                      : "size-2 rounded-full bg-muted-foreground/40"
                  }
                />
                <span className="text-sm font-medium">统一 AGENTS.md</span>
                <span className="text-xs text-muted-foreground">
                  {hasComposedContent
                    ? `${value.composedContent.trimEnd().split("\n").length} 行`
                    : "未配置"}
                  {value.snippets.length > 0
                    ? ` · 附加说明 ${enabledSnippetCount}/${value.snippets.length} 开启`
                    : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pending}
                  onClick={openBaseEditor}
                >
                  <FilePenLine className="size-3.5" />
                  编辑正文
                </Button>
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pending || !hasComposedContent}
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye className="size-3.5" />
                  预览最终内容
                </Button>
                <Button
                  className="h-8 text-xs"
                  disabled={
                    pending ||
                    !hasComposedContent ||
                    updatableProjects.length === 0
                  }
                  onClick={() => openReplace(updatableProjects)}
                >
                  <Replace className="size-3.5" />
                  全部替换
                  {updatableProjects.length > 0
                    ? ` (${updatableProjects.length})`
                    : ""}
                </Button>
                {lastPublication && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={showLastPublication}
                  >
                    上次发布结果
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  附加说明
                </span>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={pending}
                  onClick={openAddSnippet}
                >
                  <Plus className="size-3.5" />
                  添加说明
                </Button>
              </div>

              {value.snippets.length === 0 ? (
                <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                  <span>
                    可添加插件或工具使用说明，开启后自动追加到基础正文末尾。
                  </span>
                </div>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {value.snippets.map((snippet) => (
                    <li
                      key={snippet.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground">
                          {snippet.name}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          aria-label={`编辑 ${snippet.name}`}
                          disabled={pending}
                          onClick={() => openEditSnippet(snippet)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          aria-label={`删除 ${snippet.name}`}
                          disabled={pending}
                          onClick={() => deleteSnippet(snippet)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                        <Switch
                          aria-label={`启用 ${snippet.name}`}
                          checked={snippet.enabled}
                          disabled={pending}
                          onCheckedChange={(checked) =>
                            toggleSnippet(snippet, checked)
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 卡片二：项目列表 */}
          <section
            className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            aria-label="项目 AGENTS.md 列表"
          >
            {selectedPaths.length > 0 ? (
              <div className="flex h-8 flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  已选 {selectedPaths.length} 个项目
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={pending}
                    onClick={() => setSelectedPaths([])}
                  >
                    取消选择
                  </Button>
                  <Button
                    className="h-8 text-xs"
                    disabled={pending || !hasComposedContent}
                    onClick={() =>
                      openReplace(
                        value.projects.filter((item) =>
                          selectedSet.has(item.path)
                        )
                      )
                    }
                  >
                    <Replace className="size-3.5" />
                    批量替换 ({selectedPaths.length})
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(1)
                    }}
                    placeholder="搜索项目名称或路径…"
                    className="h-8 pr-7 pl-8 text-xs"
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label="清空搜索"
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setQuery("")
                        setPage(1)
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>

                <Select
                  value={statusFilter}
                  onValueChange={(next) => {
                    setStatusFilter(next as "all" | AgentsProjectStatus)
                    setPage(1)
                  }}
                >
                  <SelectTrigger
                    aria-label="按状态筛选"
                    className="h-8 w-[112px] text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="different">不一致</SelectItem>
                    <SelectItem value="missing">缺失</SelectItem>
                    <SelectItem value="synced">一致</SelectItem>
                    <SelectItem value="unavailable">不可访问</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pending}
                  onClick={() => setAddDirOpen(true)}
                >
                  <FolderPlus className="size-3.5" />
                  添加目录
                </Button>
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pending}
                  onClick={() => refresh()}
                >
                  <RefreshCw className="size-3.5" />
                  刷新
                </Button>
              </div>
            )}

            {value.projects.length === 0 ? (
              <Empty className="border py-8">
                <EmptyHeader>
                  <EmptyTitle>还没有已登记的项目目录</EmptyTitle>
                  <EmptyDescription>
                    在 Moon
                    中选择工作目录后会自动出现在这里，也可以手动添加本地目录。
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setAddDirOpen(true)}
                  >
                    <FolderPlus className="size-3.5" />
                    添加目录
                  </Button>
                </EmptyContent>
              </Empty>
            ) : filteredProjects.length === 0 ? (
              <Empty className="border py-8">
                <EmptyHeader>
                  <EmptyTitle>没有匹配的项目</EmptyTitle>
                  <EmptyDescription>
                    调整搜索关键词或状态筛选条件。
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setQuery("")
                      setStatusFilter("all")
                      setPage(1)
                    }}
                  >
                    重置筛选
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border">
                  <Table className="table-fixed">
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9 w-[40px] px-3 text-center">
                          <Checkbox
                            aria-label="全选当前页"
                            checked={allOnPageSelected}
                            disabled={selectableOnPage.length === 0}
                            onCheckedChange={(checked) =>
                              toggleSelectPage(checked === true)
                            }
                          />
                        </TableHead>
                        <TableHead className="h-9 px-3 text-left text-xs font-semibold text-muted-foreground">
                          项目
                        </TableHead>
                        <TableHead className="h-9 w-[96px] px-3 text-left text-xs font-semibold text-muted-foreground">
                          状态
                        </TableHead>
                        <TableHead className="h-9 w-[148px] px-3 pr-4 text-right text-xs font-semibold text-muted-foreground">
                          操作
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedProjects.map((project) => {
                        const meta = STATUS_META[project.status]
                        const selectable = project.status !== "unavailable"
                        const checked = selectedSet.has(project.path)
                        return (
                          <TableRow key={project.path}>
                            <TableCell
                              className="px-3 py-2.5 text-center"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Checkbox
                                aria-label={`选择 ${project.name}`}
                                checked={checked}
                                disabled={!selectable}
                                onCheckedChange={(state) =>
                                  toggleSelectRow(project.path, state === true)
                                }
                              />
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-left">
                              <div className="min-w-0">
                                <div
                                  title={project.name}
                                  className="truncate text-xs font-medium text-foreground"
                                >
                                  {project.name}
                                </div>
                                <div
                                  title={project.path}
                                  className="truncate font-mono text-[11px] text-muted-foreground"
                                >
                                  {project.path}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-left">
                              <div
                                title={project.unavailableReason || undefined}
                                className="inline-flex items-center gap-1.5 text-xs text-foreground"
                              >
                                <span
                                  aria-hidden="true"
                                  className={`size-1.5 shrink-0 rounded-full ${meta.dotClass}`}
                                />
                                <span>{meta.label}</span>
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 pr-4 text-right">
                              <div className="inline-flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  disabled={
                                    pending || project.status === "unavailable"
                                  }
                                  onClick={() => openInspect(project)}
                                >
                                  {project.status === "different"
                                    ? "对比"
                                    : "查看"}
                                </Button>
                                <Button
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  disabled={
                                    pending ||
                                    !hasComposedContent ||
                                    project.status === "unavailable" ||
                                    project.status === "synced"
                                  }
                                  onClick={() => openReplace([project])}
                                >
                                  替换
                                </Button>
                                {project.source === "custom" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-destructive"
                                    aria-label={`移除 ${project.name}`}
                                    disabled={pending}
                                    onClick={() =>
                                      removeCustomDirectory(project)
                                    }
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div
                  className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground"
                  aria-label="项目列表分页"
                >
                  <span>
                    {hasActiveFilter
                      ? `筛选结果 ${filteredProjects.length} 项（共 ${value.projects.length} 项）`
                      : `共 ${value.projects.length} 项`}
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span>每页</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(next) => {
                          setPageSize(Number(next))
                          setPage(1)
                        }}
                      >
                        <SelectTrigger
                          aria-label="每页显示条数"
                          className="h-7 w-[68px] text-xs"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" align="end">
                          <SelectItem value="10" className="text-xs">
                            10
                          </SelectItem>
                          <SelectItem value="20" className="text-xs">
                            20
                          </SelectItem>
                          <SelectItem value="50" className="text-xs">
                            50
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="tabular-nums">
                      第 {currentPage} / {totalPages} 页
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        aria-label="第一页"
                        disabled={currentPage <= 1}
                        onClick={() => setPage(1)}
                      >
                        <ChevronsLeft className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        aria-label="上一页"
                        disabled={currentPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        aria-label="下一页"
                        disabled={currentPage >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                      >
                        <ChevronRight className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        aria-label="最后一页"
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage(totalPages)}
                      >
                        <ChevronsRight className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* 弹窗 1：编辑统一正文 */}
      <Dialog open={baseDialogOpen} onOpenChange={setBaseDialogOpen}>
        <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-[920px]">
          <DialogHeader>
            <DialogTitle>编辑统一 AGENTS.md 正文</DialogTitle>
            <DialogDescription>
              保存后将与已开启的附加说明拼接，作为各项目全量替换的目标内容。
            </DialogDescription>
          </DialogHeader>
          <MarkdownEditor
            value={baseDraft}
            onChange={setBaseDraft}
            ariaLabel="统一 AGENTS.md 正文编辑器"
            placeholder="# AGENTS.md&#10;&#10;在此编写统一的 Markdown 正文…"
            defaultMode="split"
            minHeightClass="h-[460px]"
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={pending}
              onClick={() => setBaseDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              className="h-8 text-xs"
              disabled={pending}
              onClick={saveBaseContent}
            >
              {pending ? "保存中…" : "保存正文"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弹窗 2：预览最终合成内容 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>最终统一 AGENTS.md 预览</DialogTitle>
            <DialogDescription>
              以下内容由基础正文与已开启的附加说明实时拼接生成。
            </DialogDescription>
          </DialogHeader>
          <pre className="moon-scrollbar min-h-[240px] flex-1 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground select-text">
            {value?.composedContent || ""}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              onClick={() => void copyPreview()}
            >
              {copiedPreview ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copiedPreview ? "已复制" : "复制全文"}
            </Button>
            <Button
              className="h-8 text-xs"
              onClick={() => setPreviewOpen(false)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弹窗 3：添加 / 编辑附加说明 */}
      <Dialog open={snippetDialogOpen} onOpenChange={setSnippetDialogOpen}>
        <DialogContent className="flex max-h-[88dvh] flex-col gap-4 sm:max-w-[820px]">
          <DialogHeader>
            <DialogTitle>
              {editingSnippetId ? "编辑附加说明" : "添加附加说明"}
            </DialogTitle>
            <DialogDescription>
              开启开关后，这段 Markdown 会追加到基础正文末尾。
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                <label
                  htmlFor="agents-snippet-name"
                  className="text-xs font-medium text-foreground"
                >
                  名称
                </label>
                <Input
                  id="agents-snippet-name"
                  value={snippetName}
                  onChange={(event) => setSnippetName(event.target.value)}
                  placeholder="例如：笔记工作台 MCP 使用说明"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-2 self-end pb-1">
                <span className="text-xs text-muted-foreground">立即开启</span>
                <Switch
                  aria-label="立即开启追加"
                  checked={snippetEnabled}
                  onCheckedChange={setSnippetEnabled}
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Markdown 内容
              </span>
              <MarkdownEditor
                value={snippetContent}
                onChange={setSnippetContent}
                ariaLabel="附加说明 Markdown 编辑器"
                placeholder="## 工具使用说明&#10;&#10;在此编写要追加的 Markdown 段落…"
                defaultMode="split"
                minHeightClass="h-[340px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={pending}
              onClick={() => setSnippetDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              className="h-8 text-xs"
              disabled={pending || !snippetName.trim()}
              onClick={submitSnippet}
            >
              {pending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弹窗 4：添加项目目录 */}
      <Dialog open={addDirOpen} onOpenChange={setAddDirOpen}>
        <DialogContent className="flex flex-col gap-4 sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>添加项目目录</DialogTitle>
            <DialogDescription>
              登记本机项目根目录以检查与替换其 AGENTS.md。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              value={dirPathInput}
              onChange={(event) => setDirPathInput(event.target.value)}
              placeholder="输入绝对目录路径，例如 H:\workspace\demo"
              className="h-8 flex-1 font-mono text-xs"
              onKeyDown={(event) => {
                if (event.key === "Enter" && dirPathInput.trim() && !pending) {
                  submitAddDirectory()
                }
              }}
            />
            {isTauri() && (
              <Button
                variant="outline"
                className="h-8 shrink-0 text-xs"
                disabled={pending}
                onClick={pickDirectory}
              >
                浏览…
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              disabled={pending}
              onClick={() => setAddDirOpen(false)}
            >
              取消
            </Button>
            <Button
              className="h-8 text-xs"
              disabled={pending || !dirPathInput.trim()}
              onClick={submitAddDirectory}
            >
              {pending ? "登记中…" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弹窗 5：查看 / 对比项目 AGENTS.md */}
      <Dialog
        open={Boolean(inspectProject)}
        onOpenChange={(open) => {
          if (!open) setInspectProject(null)
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{inspectProject?.name}</DialogTitle>
            <DialogDescription className="truncate font-mono text-xs">
              {inspectProject?.filePath}
            </DialogDescription>
          </DialogHeader>

          {inspectLoading ? (
            <div className="flex flex-col gap-2 py-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : inspectError ? (
            <Alert>
              <AlertTitle>读取失败</AlertTitle>
              <AlertDescription>{inspectError}</AlertDescription>
            </Alert>
          ) : inspectDetail ? (
            inspectDetail.status === "missing" ? (
              <Empty className="border py-8">
                <EmptyHeader>
                  <EmptyTitle>当前目录尚未创建 AGENTS.md</EmptyTitle>
                  <EmptyDescription>
                    可以直接使用当前的统一版本创建该文件。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Tabs
                value={inspectTab}
                onValueChange={(next) => setInspectTab(next as "diff" | "full")}
                className="flex min-h-0 flex-1 flex-col gap-3"
              >
                <TabsList className="w-fit">
                  {inspectDetail.status === "different" && (
                    <TabsTrigger value="diff" className="text-xs">
                      差异对比
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="full" className="text-xs">
                    当前全文
                  </TabsTrigger>
                </TabsList>
                {inspectDetail.status === "different" && (
                  <TabsContent
                    value="diff"
                    className="moon-scrollbar min-h-0 flex-1 overflow-auto"
                  >
                    <ReadOnlyPatch legacyDiff={inspectDetail.diff} />
                  </TabsContent>
                )}
                <TabsContent
                  value="full"
                  className="moon-scrollbar min-h-0 flex-1 overflow-auto"
                >
                  <pre className="rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground select-text">
                    {inspectDetail.content}
                  </pre>
                </TabsContent>
              </Tabs>
            )
          ) : null}

          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 sm:justify-between">
            <div>
              {inspectDetail?.exists && (
                <Button
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={pending}
                  onClick={() => adoptAsBase(inspectDetail.content)}
                >
                  设为统一正文
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-8 text-xs"
                onClick={() => setInspectProject(null)}
              >
                关闭
              </Button>
              {inspectProject &&
                inspectDetail &&
                inspectDetail.status !== "synced" && (
                  <Button
                    className="h-8 text-xs"
                    disabled={pending || !hasComposedContent}
                    onClick={() => openReplace([inspectProject])}
                  >
                    <Replace className="size-3.5" />
                    替换为统一版本
                  </Button>
                )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弹窗 6：全量替换确认 */}
      <AlertDialog
        open={Boolean(replacePreview)}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setReplacePreview(null)
            setError("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认全量替换 {replacePreview?.targets.length || 0} 个项目的
              AGENTS.md？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将发布预览时的统一内容。预览后发生变化的目标会跳过。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {replacePreview && (
            <ul className="moon-scrollbar max-h-48 divide-y overflow-auto rounded-lg border text-xs">
              {replacePreview.targets.map((item) => (
                <li
                  key={item.path}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {item.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                      {item.path}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {item.exists ? "覆盖" : "新建"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                executeReplace()
              }}
            >
              {pending ? "替换中…" : "确认替换"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={Boolean(publicationResult)}
        onOpenChange={(open) => {
          if (!open) setPublicationResult(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AGENTS.md 发布结果</DialogTitle>
            <DialogDescription>
              {publicationResult?.state === "previewed"
                ? "发布尚未开始。"
                : "本次发布的每项目标结果。"}
            </DialogDescription>
          </DialogHeader>
          <ul className="moon-scrollbar max-h-[50vh] min-w-0 divide-y overflow-auto rounded-lg border text-xs">
            {publicationResult?.results.map((item) => (
              <li key={item.path} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {item.name}
                  </span>
                  <span>{PUBLICATION_OUTCOME[item.outcome]}</span>
                </div>
                <span className="font-mono [overflow-wrap:anywhere] text-muted-foreground">
                  {item.path}
                </span>
                {item.reason && <span>{item.reason}</span>}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default {
  id: "agents-md",
  apiVersion: 1,
  ownsConfiguration: true,
  pages: [{ id: "manager", component: () => <Page /> }],
} satisfies PluginWebModule
